import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteProfileRepository} from '../src/data/repositories/SqliteProfileRepository';
import {startingVatChoice} from '../src/domain/accountVat';
import {emptyLoadDraft,validateLoadDraft,type LoadDraft} from '../src/domain/loads';
import {buildLoadDocumentHtml} from '../src/services/documentTemplates';
import {buildLoadEscPos} from '../src/services/escpos';

/**
 * The VAT choice on a load: No VAT is the start; Universal uses the Company Settings rate; Own % uses a typed rate. The rate and amount are
 * saved on the load, and the receipt shows VAT lines only when the load has VAT.
 */
class TestDatabase{
  readonly raw=new DatabaseSync(':memory:');
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
  async withTransactionAsync(action:()=>Promise<void>){this.raw.exec('BEGIN');try{await action();this.raw.exec('COMMIT');}catch(cause){this.raw.exec('ROLLBACK');throw cause;}}
  close(){this.raw.close();}
}
const draft:LoadDraft={
  ...emptyLoadDraft,recordDate:'2026-08-25',customerId:'customer_1',destinationAddress:'Beirut site',itemId:'item_1',driverId:'driver_1',truckId:'truck_1',driverName:'Ali Driver',truckPlate:'B123',
  quantityMethod:'weighbridge',emptyWeightKg:'10000',fullWeightKg:'30000',conversionId:'conversion_kg_ton',unitPriceUsd:'50',notes:'',driverSignaturePaths:[],
};

describe('the VAT choice on a load',()=>{
  const databases:TestDatabase[]=[];
  afterEach(()=>{for(const database of databases.splice(0))database.close();});
  async function setup(){
    const database=new TestDatabase();databases.push(database);
    await migrateDatabase(database as never);
    const now='2026-08-01T00:00:00.000Z';
    database.raw.exec(`
      INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX Test Co','${now}');
      INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1000,'${now}');
      INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer_1','company','Road Works Ltd',0,1,'${now}','${now}');
      INSERT INTO categories (id,name,is_active,created_at,updated_at) VALUES ('category_1','Produced',1,'${now}','${now}');
      INSERT INTO catalog_items (id,category_id,name,loads_enabled,is_active,created_at,updated_at) VALUES ('item_1','category_1','Asphalt',1,1,'${now}','${now}');
      INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at) VALUES ('driver_1','Ali Driver',1,'${now}','${now}');
      INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck_1','B123',1,'${now}','${now}');
    `);
    return {database,repository:new SqliteLoadRepository(database as never),profiles:new SqliteProfileRepository(database as never)};
  }

  it('adds no VAT unless chosen: a load without a choice, or with No VAT, has 0% and its total equals its subtotal',async()=>{
    const {repository}=await setup();
    const plain=await repository.confirmLoad(draft);
    expect(plain).toMatchObject({subtotalUsd:1000,vatRatePercent:0,vatAmountUsd:0,finalTotalUsd:1000});
    const none=await repository.confirmLoad({...draft,vat:{mode:'none',ratePercent:'9'}});
    expect(none).toMatchObject({vatRatePercent:0,vatAmountUsd:0,finalTotalUsd:1000});
    const legacy=await repository.confirmLoad({...draft,vat:undefined as never});
    expect(legacy).toMatchObject({vatRatePercent:0,finalTotalUsd:1000});
  });
  it('Universal uses the Company Settings rate and Own % uses the typed rate',async()=>{
    const {repository}=await setup();
    expect(await repository.confirmLoad({...draft,vat:{mode:'universal',ratePercent:''}})).toMatchObject({subtotalUsd:1000,vatRatePercent:10,vatAmountUsd:100,finalTotalUsd:1100});
    expect(await repository.confirmLoad({...draft,vat:{mode:'custom',ratePercent:'5'}})).toMatchObject({vatRatePercent:5,vatAmountUsd:50,finalTotalUsd:1050});
    expect(await repository.confirmLoad({...draft,vat:{mode:'custom',ratePercent:'7,5'}})).toMatchObject({vatRatePercent:7.5,vatAmountUsd:75,finalTotalUsd:1075});
  });
  it('keeps a load unpriced whatever the VAT choice',async()=>{
    const {repository}=await setup();
    const unpriced=await repository.confirmLoad({...draft,unitPriceUsd:'',vat:{mode:'universal',ratePercent:''}});
    expect(unpriced).toMatchObject({unitPriceUsd:null,subtotalUsd:null,vatRatePercent:null,vatAmountUsd:null,finalTotalUsd:null});
  });
  it('rejects a bad own rate, in the form check and when saving',async()=>{
    const {repository}=await setup();
    const options=await repository.getSetupOptions();
    for(const bad of ['','abc','101','-1'])expect(validateLoadDraft({...draft,vat:{mode:'custom',ratePercent:bad}},options).join(' ')).toContain('VAT rate');
    expect(validateLoadDraft({...draft,vat:{mode:'universal',ratePercent:''}},options).join(' ')).not.toContain('VAT');
    await expect(repository.confirmLoad({...draft,vat:{mode:'custom',ratePercent:'150'}})).rejects.toThrow('0 to 100');
    expect(await repository.listLoads()).toHaveLength(0);
  });
  it('keeps the VAT a load was saved with when the Company rate or the customer account changes later',async()=>{
    const {database,repository,profiles}=await setup();
    const taxed=await repository.confirmLoad({...draft,vat:{mode:'universal',ratePercent:''}});
    const plain=await repository.confirmLoad(draft);
    database.raw.exec("UPDATE tax_settings SET vat_rate_basis_points=1800 WHERE id='tax'");
    await profiles.setCustomerVat('customer_1',{mode:'universal',ratePercent:''});
    const loads=await repository.listLoads();
    expect(loads.find(load=>load.id===taxed.id)).toMatchObject({vatRatePercent:10,vatAmountUsd:100,finalTotalUsd:1100});
    expect(loads.find(load=>load.id===plain.id)).toMatchObject({vatRatePercent:0,finalTotalUsd:1000});
    const options=await repository.getSetupOptions();
    expect(options.companySettings.vatRatePercent).toBe(18);
    const customer=options.customers.find(value=>value.id==='customer_1')!;
    expect(startingVatChoice(customer.vat)).toEqual({mode:'universal',ratePercent:''});
  });
  it('starts a new load from the customer account, No VAT for every existing customer',async()=>{
    const {repository,profiles}=await setup();
    const options=await repository.getSetupOptions();
    expect(startingVatChoice(options.customers.find(value=>value.id==='customer_1')!.vat)).toEqual({mode:'none',ratePercent:''});
    await profiles.setCustomerVat('customer_1',{mode:'custom',ratePercent:'5'});
    const next=await repository.getSetupOptions();
    expect(startingVatChoice(next.customers.find(value=>value.id==='customer_1')!.vat)).toEqual({mode:'custom',ratePercent:'5'});
  });
  it('shows the VAT lines on the receipt and the printout only for a load that has VAT',async()=>{
    const {repository}=await setup();
    const taxed=await repository.confirmLoad({...draft,vat:{mode:'universal',ratePercent:''}});
    const plain=await repository.confirmLoad(draft);
    for(const paper of ['58','80'] as const){
      const withVat=buildLoadDocumentHtml(taxed,'receipt',paper),without=buildLoadDocumentHtml(plain,'receipt',paper);
      expect(withVat).toContain('VAT rate');expect(withVat).toContain('VAT amount');expect(without).not.toContain('VAT rate');expect(without).not.toContain('VAT amount');
      expect(without).toContain('Subtotal');expect(without).toContain('Final total');
      const printWith=buildLoadEscPos(taxed,'receipt',paper).toString('latin1'),printWithout=buildLoadEscPos(plain,'receipt',paper).toString('latin1');
      expect(printWith).toContain('VAT rate');expect(printWithout).not.toContain('VAT rate');expect(printWithout).toContain('Final total');
    }
  });
  it('shows the VAT choice under the price on Make Receipt and the VAT figure only when VAT is on',()=>{
    const screen=require('node:fs').readFileSync('src/ui/screens/MakeReceiptScreen.tsx','utf8') as string;
    expect(screen).toContain('<VatChoiceControl value={draft.vat}');expect(screen).toContain('No VAT is added unless you choose it.');
    expect(screen).toContain('{vatRate > 0 ? <MetricCard label={`VAT ${vatRate}%`}');
    expect(screen).toContain('startingVatChoice(options?.customers.find');
  });
});
