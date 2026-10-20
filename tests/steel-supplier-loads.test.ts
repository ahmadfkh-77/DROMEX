import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteBusinessReportRepository} from '../src/data/repositories/SqliteBusinessReportRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {emptyQuarryPurchaseDraft,summarizeSupplierDeliveries,validateQuarryPurchase,type QuarryPurchaseDraft} from '../src/domain/quarry';
import {buildSupplierDeliveriesPdf} from '../src/domain/supplierDeliveriesPdf';
import {categorySummaries,piecesText} from '../src/domain/supplierSteel';
import {sheetsForBusinessReport} from '../src/services/businessWorkbook';
import {buildSupplierDeliveriesHtml} from '../src/services/supplierDeliveriesTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Steel on Supplier Loads, Step 1. The weight is the quantity (typed, saved exactly as typed) and the pieces sit beside it.
 * Every diameter is its own item and its own Supplier Load; the loads of one delivery note share a delivery group id.
 * Totals are per item and one total for all items together, in kg; pieces never join a weight; cancelled loads never count.
 */
const databases:SqliteTestDatabase[]=[];
const folders:string[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('hadid','Al Hadid Steel Trading',1,'${SEED_TIME}','${SEED_TIME}'),('other','Other Steel Co',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('steel','Steel','${SEED_TIME}','${SEED_TIME}'),('agg','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,created_at,updated_at) VALUES
      ('rebar12','steel','Rebar 12 mm','unit_kg',1,'${SEED_TIME}','${SEED_TIME}'),('rebar10','steel','Rebar 10 mm','unit_kg',1,'${SEED_TIME}','${SEED_TIME}'),
      ('pipe','steel','Steel pipe','unit_piece',1,'${SEED_TIME}','${SEED_TIME}'),('gravel','agg','Gravel 3/4','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const quarry=new SqliteQuarryRepository(db as never);
  const draft=(extra:Partial<QuarryPurchaseDraft>={}):QuarryPurchaseDraft=>({...emptyQuarryPurchaseDraft,recordDate:'2026-10-10',supplierId:'hadid',projectId:'road',itemId:'rebar12',unitId:'unit_kg',quantityCubicMetres:'270',pieces:'50',deliveryMethod:'supplier',supplierTruckPlate:'778899',supplierTicketNumber:'0117',...extra});
  return {db,quarry,draft};
}
/** The delivery note 0117: 12 mm and 10 mm rebar (weights typed) and one pipe with no weight. */
async function note0117(quarry:SqliteQuarryRepository,draft:(extra?:Partial<QuarryPurchaseDraft>)=>QuarryPurchaseDraft){
  return quarry.confirmDelivery([draft(),draft({itemId:'rebar10',quantityCubicMetres:'190'}),draft({itemId:'pipe',unitId:'unit_piece',quantityCubicMetres:'1',pieces:''})]);
}

describe('manual entry',()=>{
  it('saves the weight exactly as typed, with pieces beside it',async()=>{
    const {db,quarry,draft}=await setup();
    const saved=await quarry.confirmPurchase(draft({quantityCubicMetres:'266.3'}));
    expect(saved).toMatchObject({itemName:'Rebar 12 mm',unitSymbol:'kg',quantityCubicMetres:266.3,pieces:50,deliveryGroupId:null,paymentStatus:'Unpriced'});
    expect(db.raw.prepare('SELECT quantity_cubic_metres q,pieces FROM quarry_purchases WHERE id=?').get(saved.id)).toEqual({q:266.3,pieces:50});
  });
  it('treats pieces as optional, and rejects anything that is not a whole number above zero',async()=>{
    const {quarry,draft}=await setup();
    expect((await quarry.confirmPurchase(draft({pieces:''}))).pieces).toBeNull();
    expect((await quarry.confirmPurchase(draft({pieces:undefined}))).pieces).toBeNull();
    const data=await quarry.getSetup();
    for(const bad of ['0','-3','2.5','abc','1e3'])expect(validateQuarryPurchase(draft({pieces:bad}),data)).toContain('Pieces must be a whole number greater than zero, or left blank.');
    expect(validateQuarryPurchase(draft({pieces:'50'}),data)).toEqual([]);
  });
  it('saves each item of a delivery note as its own load, linked by one delivery group id',async()=>{
    const {db,quarry,draft}=await setup();
    const saved=await note0117(quarry,draft);
    expect(saved.map(load=>[load.itemName,load.quantityCubicMetres,load.unitSymbol,load.pieces])).toEqual([['Rebar 12 mm',270,'kg',50],['Rebar 10 mm',190,'kg',50],['Steel pipe',1,'pc',null]]);
    const groups=new Set(saved.map(load=>load.deliveryGroupId));
    expect(groups.size).toBe(1);expect([...groups][0]).toMatch(/^delivery_/);
    expect(new Set(saved.map(load=>load.purchaseNumber)).size).toBe(3);
    expect(saved.every(load=>load.supplierTicketNumber==='0117'&&load.paymentStatus==='Unpriced')).toBe(true);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM quarry_purchases WHERE delivery_group_id IS NOT NULL').get()).toEqual({n:3});
    expect((await quarry.confirmDelivery([draft()]))[0]!.deliveryGroupId).toBeNull();
  });
  it('saves all items or none: a bad second item leaves nothing behind and no number is used',async()=>{
    const {db,quarry,draft}=await setup();
    await expect(quarry.confirmDelivery([draft(),draft({itemId:'rebar10',quantityCubicMetres:'0'})])).rejects.toThrow('Item 2: Quantity must be greater than zero.');
    expect(db.raw.prepare('SELECT COUNT(*) n FROM quarry_purchases').get()).toEqual({n:0});
    await expect(quarry.confirmDelivery([])).rejects.toThrow('Add at least one item.');
  });
  it('corrects the pieces with a reason and keeps the history; the weight is not recalculated',async()=>{
    const {quarry,draft}=await setup();
    const saved=await quarry.confirmPurchase(draft());
    const corrected=await quarry.correctPurchase(saved.id,{...draft(),pieces:'48',recordDate:'2026-10-10',correctionReason:'Counted again at the gate'});
    expect(corrected).toMatchObject({pieces:48,quantityCubicMetres:270});
    expect(corrected.correctionHistory[0]!.changes).toEqual([{field:'Pieces',originalValue:'50',newValue:'48'}]);
    await expect(quarry.correctPurchase(saved.id,{...draft(),pieces:'48',correctionReason:'x'})).rejects.toThrow('No information was changed.');
  });
});

describe('totals per item and all together',()=>{
  it('adds each item, then one steel total in kg, without adding pieces to kg or the pipe to the weight',async()=>{
    const {quarry,draft}=await setup();
    await quarry.confirmPurchase(draft({recordDate:'2026-10-03',quantityCubicMetres:'540',pieces:'100',supplierTicketNumber:'0112'}));
    await note0117(quarry,draft);
    const [category,...rest]=categorySummaries(await quarry.listPurchases());
    expect(rest).toEqual([]);
    expect(category).toMatchObject({categoryName:'Steel',pieces:200,loadCount:4});
    expect(category!.items.map(item=>[item.itemName,item.unitSymbol,item.quantity,item.pieces,item.loads])).toEqual([['Rebar 10 mm','kg',190,50,1],['Rebar 12 mm','kg',810,150,2],['Steel pipe','pc',1,0,1]]);
    expect(category!.totals.map(total=>[total.unitSymbol,total.quantity,total.loads])).toEqual([['kg',1000,3],['pc',1,1]]);
    expect(piecesText(150)).toBe('150 pcs');expect(piecesText(1)).toBe('1 pc');expect(piecesText(null)).toBe('');
  });
  it('shows the pieces on the supplier summary of each item',async()=>{
    const {quarry,draft}=await setup();
    await note0117(quarry,draft);
    const [summary]=summarizeSupplierDeliveries(await quarry.listPurchases());
    expect(summary!.materialTotals.map(total=>[total.itemName,total.quantity,total.pieces])).toEqual([['Rebar 10 mm',190,50],['Rebar 12 mm',270,50],['Steel pipe',1,0]]);
  });
  it('leaves a cancelled load out of every total',async()=>{
    const {quarry,draft}=await setup();
    const [first]=await note0117(quarry,draft);
    await quarry.cancelPurchase(first!.id,'Wrong delivery note');
    const [category]=categorySummaries(await quarry.listPurchases());
    expect(category!.totals[0]).toEqual({unitId:'unit_kg',unitSymbol:'kg',quantity:190,loads:1});
    expect(category!.pieces).toBe(50);
  });
  it('never adds kg to tons: an item in tons has its own total',async()=>{
    const {quarry,draft}=await setup();
    await quarry.confirmPurchase(draft());
    await quarry.confirmPurchase(draft({itemId:'rebar10',unitId:'unit_ton',quantityCubicMetres:'2',pieces:'40'}));
    const [category]=categorySummaries(await quarry.listPurchases());
    expect(category!.totals.map(total=>[total.unitSymbol,total.quantity])).toEqual([['kg',270],['t',2]]);
  });
  it('shows a summary only for a category whose loads carry pieces, so old loads and other categories are unchanged',async()=>{
    const {quarry,draft}=await setup();
    await quarry.confirmPurchase(draft({itemId:'gravel',unitId:'unit_ton',quantityCubicMetres:'22',pieces:''}));
    expect(categorySummaries(await quarry.listPurchases())).toEqual([]);
  });
});

describe('the supplier PDF',()=>{
  const generatedAt='2026-10-12T16:30:00';
  async function pdf(filters:Partial<Parameters<typeof buildSupplierDeliveriesPdf>[0]['filters']>={},supplierId='hadid',name='Al Hadid Steel Trading'){
    const {quarry,draft}=await setup();
    await quarry.confirmPurchase(draft({recordDate:'2026-10-03',quantityCubicMetres:'540',pieces:'100',supplierTicketNumber:'0112'}));
    const delivery=await note0117(quarry,draft);
    await quarry.confirmPurchase(draft({supplierId:'other',itemId:'rebar10',quantityCubicMetres:'999',pieces:'7'}));
    await quarry.confirmPurchase(draft({itemId:'gravel',unitId:'unit_ton',quantityCubicMetres:'22',pieces:'',supplierTicketNumber:'T-1'}));
    await quarry.cancelPurchase(delivery[2]!.id,'Pipe was not delivered');
    const report=buildSupplierDeliveriesPdf({supplierId,supplierName:name,purchases:await quarry.listPurchases(),filters:{includePrices:false,includeDiesel:false,...filters},generatedAt});
    return {report,html:buildSupplierDeliveriesHtml({companyName:'DROMEX S.A.R.L.',logo:null,contactLine:'Beirut, Lebanon',report}).replace(/\s+/g,' ')};
  }
  it('adds a Pieces column and one summary block with each item and the total of all items in kg',async()=>{
    const {report,html}=await pdf();
    expect(report.hasPieces).toBe(true);
    expect(html).toContain('<th>Ticket</th><th class="num">Pieces</th><th class="num">Quantity</th><th>Status</th>');
    expect(html).toContain('Steel</bdi> summary · quantity added per unit');
    expect(html).toContain('<tr class="total-row"><td>Total <bdi dir="auto">Steel</bdi>, all items</td><td class="num">3</td><td class="num">200 pcs</td><td class="num">1000 kg</td></tr>');
    expect(html).toContain('<td><bdi dir="auto">Rebar 12 mm</bdi></td><td class="num">2</td><td class="num">150 pcs</td><td class="num">810 kg</td>');
    expect(html).toContain('<td class="indent"><bdi dir="auto">Rebar 10 mm</bdi></td><td>kg</td><td class="num">1</td><td class="num">50 pcs</td><td class="num">190 kg</td>');
    expect(html).toContain('Rebar 10 mm</bdi> · 50 pcs</td><td class="num">1</td><td class="num">190 kg</td>');
    expect(report.categories).toHaveLength(1);
  });
  it('lists only this supplier\'s steel, never another supplier\'s, and leaves out the cancelled pipe and other categories from the steel total',async()=>{
    const {report,html}=await pdf();
    expect(html).not.toContain('999 kg');
    expect(html).not.toContain('Steel pipe');
    expect(report.categories[0]!.totals).toEqual([{quantityText:'1000 kg',loadCount:3}]);
    const other=await pdf({},'other','Other Steel Co');
    expect(other.report.categories[0]!.totals).toEqual([{quantityText:'999 kg',loadCount:1}]);
    expect(other.html).not.toContain('810 kg');
  });
  it('respects the date range',async()=>{
    const {report,html}=await pdf({fromDate:'2026-10-04',toDate:'2026-10-12'});
    expect(report.categories[0]!.totals).toEqual([{quantityText:'460 kg',loadCount:2}]);
    expect(report.categories[0]!.piecesText).toBe('100 pcs');
    expect(html).not.toContain('540 kg');
  });
  it('is unchanged when no load carries pieces: no Pieces column and no summary',async()=>{
    const {quarry,draft}=await setup();
    await quarry.confirmPurchase(draft({itemId:'gravel',unitId:'unit_ton',quantityCubicMetres:'22',pieces:''}));
    const report=buildSupplierDeliveriesPdf({supplierId:'hadid',supplierName:'Al Hadid Steel Trading',purchases:await quarry.listPurchases(),filters:{includePrices:false,includeDiesel:false},generatedAt});
    const html=buildSupplierDeliveriesHtml({companyName:'DROMEX S.A.R.L.',logo:null,contactLine:null,report});
    expect(report.hasPieces).toBe(false);expect(report.categories).toEqual([]);
    expect(html).not.toContain('Pieces');expect(html).not.toContain('summary ·');
  });
  it('keeps the price columns aligned with a Pieces column and says Unpriced, never zero',async()=>{
    const {html}=await pdf({includePrices:true});
    expect(html).toContain('<th>Ticket</th><th class="num">Pieces</th><th class="num">Quantity</th><th class="num">Price</th><th class="num">Total</th><th>Status</th>');
    expect(html).toContain('Unpriced');
    expect(html.match(/<col style="width:\d+%"\/>/g)).not.toBeNull();
  });
});

describe('the Excel export',()=>{
  it('adds Category, Pieces and Delivery Group ID to the supplier loads and a Category Totals sheet in kg',async()=>{
    const {db,quarry,draft}=await setup();
    await note0117(quarry,draft);
    const data=await new SqliteBusinessReportRepository(db as never).getReportData();
    const row=data.quarryPurchases.find(value=>value.Item==='Rebar 12 mm')!;
    expect(row).toMatchObject({Category:'Steel',Quantity:270,Unit:'kg',Pieces:50});
    expect(String(row['Delivery Group ID'])).toMatch(/^delivery_/);
    const sheet=sheetsForBusinessReport('quarry',data).find(value=>value.name==='Category Totals')!;
    expect(sheet.rows.map(value=>[value.Level,value.Item,value.Unit,value.Loads,value.Pieces,value['Total Quantity']])).toEqual([
      ['Item','Rebar 10 mm','kg',1,50,190],['Item','Rebar 12 mm','kg',1,50,270],['Item','Steel pipe','pc',1,null,1],
      ['Total, all items',null,'kg',2,100,460],['Total, all items',null,'pc',1,null,1],
    ]);
  });
  it('has no Category Totals sheet when nothing carries pieces',async()=>{
    const {db,quarry,draft}=await setup();
    await quarry.confirmPurchase(draft({itemId:'gravel',unitId:'unit_ton',quantityCubicMetres:'22',pieces:''}));
    const data=await new SqliteBusinessReportRepository(db as never).getReportData();
    expect(sheetsForBusinessReport('quarry',data).some(value=>value.name==='Category Totals')).toBe(false);
  });
});

describe('data safety',()=>{
  it('upgrades a version-53 database to the current version with every existing load left without pieces or a group',async()=>{
    const {db,quarry,draft}=await setup();
    const old=await quarry.confirmPurchase(draft({itemId:'gravel',unitId:'unit_ton',quantityCubicMetres:'22',pieces:''}));
    db.raw.exec('DROP INDEX idx_quarry_purchases_group;ALTER TABLE quarry_purchases DROP COLUMN pieces;ALTER TABLE quarry_purchases DROP COLUMN delivery_group_id;PRAGMA user_version=53;');
    const before=db.raw.prepare('SELECT * FROM quarry_purchases WHERE id=?').get(old.id);
    await migrateDatabase(db as never);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect(db.raw.prepare('SELECT * FROM quarry_purchases WHERE id=?').get(old.id)).toEqual({...before,pieces:null,delivery_group_id:null});
    await migrateDatabase(db as never);
    expect((await quarry.listPurchases())[0]).toMatchObject({quantityCubicMetres:22,unitSymbol:'t',pieces:null,deliveryGroupId:null});
  });
  it('keeps pieces, the weight and the delivery group through a backup file restore',async()=>{
    const {db,quarry,draft}=await setup();
    const saved=await note0117(quarry,draft);
    const folder=mkdtempSync(path.join(os.tmpdir(),'dromex-steel-'));folders.push(folder);
    const file=path.join(folder,'backup.sqlite');
    db.raw.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);
    const restored=new SqliteTestDatabase(file);databases.push(restored);
    expect(restored.raw.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
    expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const after=await new SqliteQuarryRepository(restored as never).listPurchases();
    expect(after.map(load=>[load.itemName,load.quantityCubicMetres,load.pieces,load.deliveryGroupId]).sort()).toEqual(saved.map(load=>[load.itemName,load.quantityCubicMetres,load.pieces,load.deliveryGroupId]).sort());
  });
});
