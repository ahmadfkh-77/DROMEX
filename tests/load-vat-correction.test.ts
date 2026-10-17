import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {correctionBaseline,correctionChanges,correctionLocks,correctionVatRate,validateLoadCorrection} from '../src/domain/loadCorrection';
import {emptyLoadDraft,type ConfirmedLoad,type LoadDraft} from '../src/domain/loads';

/**
 * Changing the VAT of a saved load through the correction path: a load keeps the VAT it was saved with unless the correction chooses another,
 * the change needs the reason and is kept in the history with the original, and it is locked while the load has active payments.
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

describe('VAT on a saved load',()=>{
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
    const repository=new SqliteLoadRepository(database as never);
    const plain=await repository.confirmLoad(draft);
    const taxed=await repository.confirmLoad({...draft,vat:{mode:'universal',ratePercent:''}});
    const correct=(load:ConfirmedLoad,extra:Record<string,unknown>)=>repository.correctLoad(load.id,{...correctionBaseline(load),correctionReason:'Customer asked for a VAT invoice',...extra} as never);
    return {database,repository,plain,taxed,correct};
  }

  it('adds VAT to a saved No VAT load when the correction chooses Universal, and keeps the original in the history',async()=>{
    const {database,plain,correct}=await setup();
    expect(plain).toMatchObject({vatRatePercent:0,vatAmountUsd:0,finalTotalUsd:1000});
    const corrected=await correct(plain,{vat:{mode:'universal',ratePercent:''}});
    expect(corrected).toMatchObject({subtotalUsd:1000,vatRatePercent:10,vatAmountUsd:100,finalTotalUsd:1100});
    const entry=corrected.correctionHistory.at(-1)!;
    expect(entry.reason).toBe('Customer asked for a VAT invoice');
    expect(entry.changes.find(change=>change.field==='VAT')).toMatchObject({originalValue:'No VAT',newValue:'10%'});
    const saved=database.raw.prepare('SELECT snapshot_json FROM load_versions WHERE load_id=? ORDER BY version').all(plain.id) as {snapshot_json:string}[];
    expect(saved).toHaveLength(1);expect(saved[0]!.snapshot_json).toContain('"vat_rate_basis_points":0');
  });
  it('applies an own rate, and takes VAT off with No VAT',async()=>{
    const {taxed,plain,correct}=await setup();
    expect(await correct(plain,{vat:{mode:'custom',ratePercent:'5'}})).toMatchObject({vatRatePercent:5,vatAmountUsd:50,finalTotalUsd:1050});
    const off=await correct(taxed,{vat:{mode:'none',ratePercent:''}});
    expect(off).toMatchObject({vatRatePercent:0,vatAmountUsd:0,finalTotalUsd:1000});
    expect(off.correctionHistory.at(-1)!.changes.find(change=>change.field==='VAT')).toMatchObject({originalValue:'10%',newValue:'No VAT'});
  });
  it('keeps the VAT a load was saved with when the correction does not choose one, even after the Company rate changes',async()=>{
    const {database,taxed,correct}=await setup();
    database.raw.exec("UPDATE tax_settings SET vat_rate_basis_points=1800 WHERE id='tax'");
    const corrected=await correct(taxed,{notes:'Gate 2',correctionReason:'Note added'});
    expect(corrected).toMatchObject({vatRatePercent:10,vatAmountUsd:100,finalTotalUsd:1100});
    expect(corrected.correctionHistory.at(-1)!.changes.map(change=>change.field)).not.toContain('VAT');
  });
  it('recalculates the VAT when the price or quantity is corrected without choosing VAT',async()=>{
    const {taxed,correct}=await setup();
    const corrected=await correct(taxed,{unitPriceUsd:'60.00',correctionReason:'Price agreed'});
    expect(corrected).toMatchObject({subtotalUsd:1200,vatRatePercent:10,vatAmountUsd:120,finalTotalUsd:1320});
  });
  it('rejects a bad own rate and saves nothing',async()=>{
    const {repository,plain,correct}=await setup();
    await expect(correct(plain,{vat:{mode:'custom',ratePercent:'150'}})).rejects.toThrow('VAT rate');
    expect((await repository.listLoads()).find(load=>load.id===plain.id)).toMatchObject({vatRatePercent:0,finalTotalUsd:1000});
  });
  it('locks the VAT while the load has active payments',async()=>{
    const {database,repository,plain,correct}=await setup();
    database.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at) VALUES ('pay_1','load','${plain.id}',50000,'2026-08-26','Active','2026-08-26T00:00:00Z')`);
    await expect(correct(plain,{vat:{mode:'universal',ratePercent:''}})).rejects.toThrow('VAT cannot change while this load has active payments');
    const unchanged=await correct(plain,{notes:'Gate 2',correctionReason:'Note added'});
    expect(unchanged).toMatchObject({vatRatePercent:0,finalTotalUsd:1000});
    expect((await repository.listLoads()).find(load=>load.id===plain.id)?.notes).toBe('Gate 2');
  });
  it('is described by pure rules: the chosen rate, the lock, and the change lines',async()=>{
    const {repository,plain,taxed}=await setup();
    const options=await repository.getSetupOptions();
    expect(correctionVatRate(plain,correctionBaseline(plain),10)).toBe(0);
    expect(correctionVatRate(taxed,correctionBaseline(taxed),18)).toBe(10);
    expect(correctionVatRate(plain,{...correctionBaseline(plain),vat:{mode:'universal',ratePercent:''}},18)).toBe(18);
    expect(correctionVatRate(plain,{...correctionBaseline(plain),vat:{mode:'custom',ratePercent:'7,5'}},18)).toBe(7.5);
    expect(()=>correctionVatRate(plain,{...correctionBaseline(plain),vat:{mode:'custom',ratePercent:'x'}},18)).toThrow('0 to 100');
    expect(correctionLocks(0).vat).toBe(false);expect(correctionLocks(100).vat).toBe(true);
    const form={...correctionBaseline(plain),vat:{mode:'universal' as const,ratePercent:''}};
    expect(correctionChanges(plain,form,options).filter(row=>row.field==='VAT')).toEqual([{field:'VAT',originalValue:'No VAT',newValue:'10%'}]);
    expect(correctionChanges(plain,correctionBaseline(plain),options).map(row=>row.field)).not.toContain('VAT');
    expect(validateLoadCorrection(plain,{...form,vat:{mode:'custom',ratePercent:'150'}},options,0).join(' ')).toContain('VAT rate');
    expect(validateLoadCorrection(plain,form,options,0)).toEqual([]);
    expect(validateLoadCorrection(plain,form,options,5000).join(' ')).toContain('VAT cannot change');
  });
  it('shows the VAT choice on the correction form, under the price, locked with payments',()=>{
    const screen=require('node:fs').readFileSync('src/ui/components/LoadCorrectionForm.tsx','utf8') as string;
    expect(screen).toContain('<VatChoiceControl label=""');expect(screen).toContain("{locks.vat?<Locked label=\"VAT\" value={vatLabel}/>");
    expect(screen).toContain("{vatRate>0?<MetricCard label={`VAT ${vatRate}%`}");expect(screen).toContain('Changing VAT needs the correction reason below.');
  });
});
