import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {SqliteStockRepository} from '../src/data/repositories/SqliteStockRepository';
import {emptyQuarryPurchaseDraft,type QuarryPurchaseDraft} from '../src/domain/quarry';
import {changedCorrectionLines,correctionLines,correctionTotals,formatCorrectionDate,localDateOf,quarryCorrectionDraft,supplierLocked} from '../src/domain/supplierCorrection';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-525. The Supplier Load correction page ("tap a line to correct it") and the audited Date correction. The page is a
 * different way of editing the same correction form, so every rule, audit entry and payment lock is checked to be unchanged.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-19T09:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('dromex','DROMEX S.A.R.L',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('mat','Materials','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES
      ('cement','mat','Cement bags','unit_piece',1,1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const quarry=new SqliteQuarryRepository(db as never);
  const stock=new SqliteStockRepository(db as never);
  const draft=(extra:Partial<QuarryPurchaseDraft>={}):QuarryPurchaseDraft=>({...emptyQuarryPurchaseDraft,recordDate:'2026-09-08',supplierId:'dromex',projectId:'road',itemId:'cement',unitId:'unit_piece',quantityCubicMetres:'100',deliveryMethod:'supplier',supplierTruckPlate:'778899',supplierTicketNumber:'4471',...extra});
  return {db,quarry,stock,draft};
}

describe('Date correction (repository)',()=>{
  it('corrects the date with a reason, keeps the number and the time of day, and audits the old and new date',async()=>{
    const {db,quarry,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    const saved=await quarry.correctPurchase(load.id,{...quarryCorrectionDraft(load),recordDate:'2026-09-05',correctionReason:'The ticket is dated 5 September'});
    expect(saved.purchaseNumber).toBe(load.purchaseNumber);
    expect(localDateOf(saved.confirmedAt)).toBe('2026-09-05');
    const before=new Date(load.confirmedAt),after=new Date(saved.confirmedAt);
    expect([after.getHours(),after.getMinutes(),after.getSeconds()]).toEqual([before.getHours(),before.getMinutes(),before.getSeconds()]);
    expect(saved.correctionHistory.at(-1)).toMatchObject({reason:'The ticket is dated 5 September',changes:[{field:'Date',originalValue:'2026-09-08',newValue:'2026-09-05'}]});
    expect((db.raw.prepare('SELECT confirmed_at FROM quarry_purchases WHERE id=?').get(load.id) as {confirmed_at:string}).confirmed_at).toBe(saved.confirmedAt);
  });
  it('records the date together with other changed fields in one correction',async()=>{
    const {quarry,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    const saved=await quarry.correctPurchase(load.id,{...quarryCorrectionDraft(load),recordDate:'2026-09-06',quantityCubicMetres:'120',correctionReason:'Date and count were wrong'});
    expect(saved.correctionHistory.at(-1)!.changes.map(change=>change.field).sort()).toEqual(['Date','Quantity']);
    expect(saved.quantityCubicMetres).toBe(120);
  });
  it('treats a form made straight from the load as no change, even close to midnight',async()=>{
    const {quarry,draft}=await setup();
    vi.setSystemTime(new Date('2026-10-19T00:20:00'));
    const load=await quarry.confirmPurchase(draft());
    expect(quarryCorrectionDraft(load).recordDate).toBe('2026-09-08');
    await expect(quarry.correctPurchase(load.id,{...quarryCorrectionDraft(load),correctionReason:'nothing'})).rejects.toThrow('No information was changed.');
  });
  it('keeps the rules of a new load: not in the future and inside the project dates',async()=>{
    const {quarry,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    await expect(quarry.correctPurchase(load.id,{...quarryCorrectionDraft(load),recordDate:'2026-10-20',correctionReason:'x'})).rejects.toThrow('Record date must be today or a valid past date.');
    await expect(quarry.correctPurchase(load.id,{...quarryCorrectionDraft(load),recordDate:'2026-07-01',correctionReason:'x'})).rejects.toThrow('within the selected project dates');
    expect(localDateOf((await quarry.listPurchases()).find(value=>value.id===load.id)!.confirmedAt)).toBe('2026-09-08');
  });
  it('still requires the reason',async()=>{
    const {quarry,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    await expect(quarry.correctPurchase(load.id,{...quarryCorrectionDraft(load),recordDate:'2026-09-05',correctionReason:'  '})).rejects.toThrow('Correction reason is required.');
  });
  it('blocks a date change while the load is in an active Stock batch, but not other corrections',async()=>{
    const {quarry,stock,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    await stock.recordBatchesFromLoads([load.id]);
    await expect(quarry.correctPurchase(load.id,{...quarryCorrectionDraft(load),recordDate:'2026-09-05',correctionReason:'x'})).rejects.toThrow(/is in Stock as .*Cancel that Stock batch first to change its date/);
    const notes=await quarry.correctPurchase(load.id,{...quarryCorrectionDraft(load),notes:'Checked',correctionReason:'Added a note'});
    expect(notes.notes).toBe('Checked');
    expect(localDateOf(notes.confirmedAt)).toBe('2026-09-08');
  });
  it('lets a cancelled load be reactivated with a corrected date',async()=>{
    const {quarry,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    const cancelled=await quarry.cancelPurchase(load.id,'Entered by mistake');
    const saved=await quarry.reactivatePurchase(load.id,{...quarryCorrectionDraft(cancelled),recordDate:'2026-09-07',correctionReason:'Wrong day, now fixed'});
    expect(saved.status).toBe('Active');
    expect(localDateOf(saved.confirmedAt)).toBe('2026-09-07');
  });
});

describe('the lines of the correction page (pure)',()=>{
  it('reads every line from the saved load in plain words',async()=>{
    const {quarry,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    const lines=correctionLines(quarryCorrectionDraft(load),await quarry.getSetup());
    expect(lines.map(line=>line.label)).toEqual(['Date','Supplier','Delivered to','Item','Quantity','Pieces','Delivery','Ticket / invoice','Price','Notes']);
    const by=Object.fromEntries(lines.map(line=>[line.key,line.value]));
    expect(by).toMatchObject({date:'8 Sep 2026',supplier:'DROMEX S.A.R.L',place:'Project · Mountain Road',item:'Cement bags',quantity:'100 pc',pieces:'Not recorded',delivery:'Supplier delivering · 778899',ticket:'4471',price:'Unpriced',notes:'None'});
  });
  it('marks only the changed lines, with the old and the new text, and counts them',async()=>{
    const {quarry,draft}=await setup();
    const load=await quarry.confirmPurchase(draft());
    const setupData=await quarry.getSetup(),base=quarryCorrectionDraft(load);
    expect(changedCorrectionLines(base,base,setupData)).toEqual([]);
    const next={...base,recordDate:'2026-09-05',quantityCubicMetres:'125',unitPriceUsd:'7',notes:'Checked'};
    const changes=changedCorrectionLines(base,next,setupData);
    expect(changes.map(change=>change.key)).toEqual(['date','quantity','price','notes']);
    expect(changes[0]).toMatchObject({was:'8 Sep 2026',now:'5 Sep 2026',sheet:'date'});
    expect(changes[1]).toMatchObject({was:'100 pc',now:'125 pc'});
    expect(changes[2]).toMatchObject({was:'Unpriced',now:'$7.00 per pc · No VAT'});
  });
  it('typing the old value again undoes a change, and spacing or a comma does not count',async()=>{
    const {quarry,draft}=await setup();
    const load=await quarry.confirmPurchase(draft({unitPriceUsd:'6.50'}));
    const setupData=await quarry.getSetup(),base=quarryCorrectionDraft(load);
    expect(changedCorrectionLines(base,{...base,unitPriceUsd:'6,5',notes:'  '},setupData)).toEqual([]);
    expect(changedCorrectionLines(base,{...base,quantityCubicMetres:'100.0'},setupData)).toEqual([]);
  });
  it('shows the total from the form as it stands, Unpriced when there is no price',async()=>{
    const {quarry,draft}=await setup();
    const load=await quarry.confirmPurchase(draft({unitPriceUsd:'6.50'}));
    const setupData=await quarry.getSetup(),base=quarryCorrectionDraft(load);
    expect(correctionTotals(base,setupData).total).toBe(650);
    expect(correctionTotals({...base,unitPriceUsd:'7'},setupData).total).toBe(700);
    expect(correctionTotals({...base,unitPriceUsd:''},setupData).total).toBeNull();
  });
  it('formats the date and locks the supplier only for a load with payments',()=>{
    expect(formatCorrectionDate('2026-10-24')).toBe('24 Oct 2026');
    expect(formatCorrectionDate('not a date')).toBe('not a date');
    for(const status of ['Partially Paid','Paid','Overpaid'] as const)expect(supplierLocked({paymentStatus:status})).toBe(true);
    for(const status of ['Unpriced','No Payment Due','Unpaid'] as const)expect(supplierLocked({paymentStatus:status})).toBe(false);
  });
});

describe('the correction page (static checks)',()=>{
  const page=readFileSync('src/ui/components/SupplierLoadCorrectionPage.tsx','utf8');
  const screen=readFileSync('src/ui/screens/QuarryPurchasesScreen.tsx','utf8');
  it('is a list where each line opens its own sheet, then one review that asks for the reason',()=>{
    for(const text of ['Tap Edit on a line to correct it.','Review changes','Reactivate this load','Correction reason *','Reactivation reason *','Save correction','Save and Reactivate','Leave without saving?','Cancel this load','Correction history','Same delivery note','Steel details','Documents'])expect(page).toContain(text);
    for(const sheet of ["'date'","'supplier'","'place'","'item'","'quantity'","'delivery'","'ticket'","'price'","'notes'"])expect(page).toContain(sheet);
  });
  it('shows a changed line as the old value crossed out beside the new one, with no extra tag',()=>{
    expect(page).toContain("textDecorationLine: 'line-through'");
    expect(page).not.toContain('CHANGED');
  });
  it('puts the date first and applies the date rules inside its sheet',()=>{
    expect(page.indexOf("'date'")).toBeGreaterThan(-1);
    expect(page).toContain('<DatePickerField variant="open" label="Record date *"');
    expect(page).toContain('maxDate={project?.endDate ?? todayIso()}');
    expect(page).toContain('disabled={sheetIssues.length > 0}');
  });
  it('keeps the cancel rules: its own screen, a required reason, a confirmation, and not offered for a cancelled load',()=>{
    expect(page).toContain('Cancelling is audited. It is blocked until every active payment linked to this load is cancelled.');
    expect(page).toContain('Enter a cancellation reason first.');
    expect(page).toContain('{!cancelled ? (');
    expect(screen).toContain("Alert.alert('Cancel this supplier load?'");
    expect(screen).toContain('function cancelPurchase(cancelReason:string)');
  });
  it('is wired in place of the old two-card form and saves through the same repository calls',()=>{
    expect(screen).toContain('<SupplierLoadCorrectionPage');
    expect(screen).toContain('repository.correctPurchase(selected.id,correction)');
    expect(screen).toContain('repository.reactivatePurchase(selected.id,correction)');
    expect(screen).toContain('setCorrection(quarryCorrectionDraft(purchase))');
    for(const gone of ['Save Full Correction','Full correction and audit','Cancel Supplier Load</Text>'])expect(screen).not.toContain(gone);
  });
});
