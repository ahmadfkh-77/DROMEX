import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {startingVatChoice} from '../src/domain/accountVat';
import type {FuelDeliveryDraft} from '../src/domain/fuel';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * The VAT choice on a fuel purchase: No VAT is the start, Universal uses the Company Settings rate, Own % uses a typed rate. A saved purchase
 * keeps its VAT, a correction keeps it unless the owner changes it, and a supplier account's VAT is where a new purchase starts.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-16T09:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT OR REPLACE INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1100,'${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('plain','Plain Fuel',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,vat_mode,created_at,updated_at) VALUES ('taxed','Taxed Fuel',1,'universal','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,vat_mode,vat_rate_basis_points,created_at,updated_at) VALUES ('own','Own Rate Fuel',1,'custom',500,'${SEED_TIME}','${SEED_TIME}');
  `);
  const repository=new SqliteFuelRepository(db as never);
  const draft=(extra:Partial<FuelDeliveryDraft>={}):FuelDeliveryDraft=>({recordDate:'2026-10-12',litres:'1000',supplierId:'plain',ticketNumber:'T-1',pricePerLitreUsd:'1.43550',updateCurrentPrice:false,notes:'',...extra});
  return {db,repository,draft};
}
const movement=async(repository:SqliteFuelRepository,id:string)=>(await repository.getOverview()).movements.find(value=>value.id===id)!;

describe('the VAT choice on a fuel purchase',()=>{
  it('adds no VAT unless chosen: with no choice or with No VAT the total equals the subtotal',async()=>{
    const {repository,draft}=await setup();
    const plain=await repository.recordDelivery(draft());
    expect(await movement(repository,plain.id)).toMatchObject({subtotalUsd:1435.5,vatRatePercent:0,vatAmountUsd:0,finalTotalUsd:1435.5});
    const none=await repository.recordDelivery(draft({vat:{mode:'none',ratePercent:'9'}}));
    expect(await movement(repository,none.id)).toMatchObject({vatRatePercent:0,vatAmountUsd:0,finalTotalUsd:1435.5});
  });
  it('Universal uses the Company Settings rate and Own % uses the typed rate, from the exact five-decimal price',async()=>{
    const {repository,draft}=await setup();
    const universal=await repository.recordDelivery(draft({vat:{mode:'universal',ratePercent:''}}));
    expect(await movement(repository,universal.id)).toMatchObject({pricePerLitreUsd:1.4355,subtotalUsd:1435.5,vatRatePercent:11,vatAmountUsd:157.91,finalTotalUsd:1593.41});
    const own=await repository.recordDelivery(draft({vat:{mode:'custom',ratePercent:'5'}}));
    expect(await movement(repository,own.id)).toMatchObject({vatRatePercent:5,vatAmountUsd:71.78,finalTotalUsd:1507.28});
  });
  it('rejects a bad own rate and keeps an unpriced purchase free of VAT',async()=>{
    const {repository,draft}=await setup();
    await expect(repository.recordDelivery(draft({vat:{mode:'custom',ratePercent:'150'}}))).rejects.toThrow('0 to 100');
    const unpriced=await repository.recordDelivery(draft({pricePerLitreUsd:'',supplierId:'',vat:{mode:'universal',ratePercent:''}}));
    expect(await movement(repository,unpriced.id)).toMatchObject({finalTotalUsd:null,vatAmountUsd:null,subtotalUsd:null});
  });
  it('gives each supplier\'s account VAT to the form, so a new purchase starts from it',async()=>{
    const {repository}=await setup();
    const suppliers=(await repository.getSetup()).suppliers;
    expect(startingVatChoice(suppliers.find(value=>value.id==='plain')?.vat)).toEqual({mode:'none',ratePercent:''});
    expect(startingVatChoice(suppliers.find(value=>value.id==='taxed')?.vat)).toEqual({mode:'universal',ratePercent:''});
    expect(startingVatChoice(suppliers.find(value=>value.id==='own')?.vat)).toEqual({mode:'custom',ratePercent:'5'});
  });
  it('keeps the VAT a purchase was saved with when the Company rate changes, and when it is corrected without a VAT choice',async()=>{
    const {db,repository,draft}=await setup();
    const taxed=await repository.recordDelivery(draft({vat:{mode:'universal',ratePercent:''}}));
    db.raw.exec("UPDATE tax_settings SET vat_rate_basis_points=1800 WHERE id='tax'");
    expect(await movement(repository,taxed.id)).toMatchObject({vatRatePercent:11,finalTotalUsd:1593.41});
    const {updateCurrentPrice:_ignored,vat:_vat,...rest}=draft({litres:'2000'});
    await repository.correctDelivery(taxed.id,{...rest,correctionReason:'Counted again'});
    expect(await movement(repository,taxed.id)).toMatchObject({litres:2000,subtotalUsd:2871,vatRatePercent:11,vatAmountUsd:315.81,finalTotalUsd:3186.81});
  });
  it('changes the VAT on a correction only when the owner chooses, with the change in the history',async()=>{
    const {repository,draft}=await setup();
    const taxed=await repository.recordDelivery(draft({vat:{mode:'universal',ratePercent:''}}));
    const {updateCurrentPrice:_ignored,vat:_vat,...rest}=draft();
    const corrected=await repository.correctDelivery(taxed.id,{...rest,vat:{mode:'none',ratePercent:''},correctionReason:'Supplier is exempt'});
    expect(corrected).toMatchObject({vatRatePercent:0,vatAmountUsd:0,finalTotalUsd:1435.5});
    const last=corrected.correctionHistory.at(-1)!;
    expect(last.reason).toBe('Supplier is exempt');
    expect(last.changes.map(change=>change.field)).toEqual(expect.arrayContaining(['VAT','Total']));
    expect(last.changes.find(change=>change.field==='VAT')).toMatchObject({originalValue:'11%',newValue:'0%'});
  });
  it('shows the VAT choice on the purchase and correction forms, starting from the supplier',()=>{
    const screen=require('node:fs').readFileSync('src/ui/screens/FuelTrackingScreen.tsx','utf8') as string;
    expect(screen).toContain('<VatChoiceControl value={delivery.vat??noVatChoice}');
    expect(screen).toContain('vat:startingVatChoice(setup.suppliers.find(supplier=>supplier.id===v)?.vat)');
    expect(screen).toContain('<VatChoiceControl value={correction.delivery.vat??noVatChoice}');
    expect(screen).toContain('vat:choiceForRate(selected.vatRatePercent,setup.vatRatePercent)');
    expect(screen).toContain('VAT is added only if you choose it below.');
    expect(screen).not.toContain('Supplier purchase totals include the current');
  });
});
