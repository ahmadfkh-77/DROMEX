import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteBusinessReportRepository} from '../src/data/repositories/SqliteBusinessReportRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {emptyQuarryPurchaseDraft,validateQuarryPurchase,type QuarryPurchaseDraft} from '../src/domain/quarry';
import {
  acceptedWeightKg,calculatedPatch,calculatedWeightChanged,calculateRebarLine,comparisonText,defaultSteelSettings,diameterFromName,formatKgFixed,formatPerMeter,isSteelCategory,
  kgPerMeter,parseDiameterList,rebarTotals,sourceAfterTyping,splitTotalProportionally,validateSteelSettings,weightDifference,
} from '../src/domain/rebar';
import {buildSupplierDeliveriesPdf} from '../src/domain/supplierDeliveriesPdf';
import {categorySummaries} from '../src/domain/supplierSteel';
import {sheetsForBusinessReport} from '../src/services/businessWorkbook';
import {buildSupplierDeliveriesHtml} from '../src/services/supplierDeliveriesTemplate';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Steel on Supplier Loads, Step 2: the rebar calculator. It only suggests a weight. The weight typed is saved exactly as typed
 * and is never overwritten; the calculated weight is kept beside it with the difference. The real delivery note 0117
 * (12 mm and 10 mm, 6 m bars, 50 pieces each, 460 kg written by the supplier) is the worked case.
 */
const D=7850;
const line12={diameterMm:12,lengthPerBarM:6,pieces:50},line10={diameterMm:10,lengthPerBarM:6,pieces:50};
const databases:SqliteTestDatabase[]=[];const folders:string[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});

describe('the formula',()=>{
  it('gives 0.888 kg/m for 12 mm and 0.617 kg/m for 10 mm, close to the d² ÷ 162 rule of thumb',()=>{
    expect(formatPerMeter(kgPerMeter(12,D))).toBe('0.888');expect(formatPerMeter(kgPerMeter(10,D))).toBe('0.617');
    expect(kgPerMeter(12,D)).toBeCloseTo(0.887814,5);
    for(const d of [8,10,12,14,16,20,25,32])expect(Math.abs(kgPerMeter(d,D)-d*d/162)/kgPerMeter(d,D)).toBeLessThan(0.002);
  });
  it('works the delivery note out: meters, weight per line and the delivery total',()=>{
    const a=calculateRebarLine(line12,D)!,b=calculateRebarLine(line10,D)!;
    expect(a.meters).toBe(300);expect(b.meters).toBe(300);
    expect(a.weightKg).toBeCloseTo(266.3441,3);expect(b.weightKg).toBeCloseTo(184.9613,3);
    expect([formatKgFixed(a.weightKg),formatKgFixed(b.weightKg)]).toEqual(['266.3','185.0']);
    const total=rebarTotals([{...a,pieces:50},{...b,pieces:50}]);
    expect(total).toMatchObject({meters:600,pieces:100,lines:2});expect(formatKgFixed(total.weightKg)).toBe('451.3');
  });
  it('multiplies pieces by the length and scales with the density, which has one default',()=>{
    expect(calculateRebarLine({...line12,pieces:60},D)!.meters).toBe(360);
    expect(formatKgFixed(calculateRebarLine({...line12,pieces:60},D)!.weightKg)).toBe('319.6');
    expect(calculateRebarLine({...line12,lengthPerBarM:12},D)!.meters).toBe(600);
    expect(calculateRebarLine(line12,7800)!.weightKg/calculateRebarLine(line12,D)!.weightKg).toBeCloseTo(7800/7850,10);
    expect(defaultSteelSettings()).toEqual({densityKgM3:7850,diameters:[8,10,12,14,16,18,20,25,32]});
  });
  it('gives nothing for an incomplete line, never a zero',()=>{
    for(const bad of [{...line12,diameterMm:0},{...line12,lengthPerBarM:NaN},{...line12,pieces:0},{diameterMm:12,lengthPerBarM:6,pieces:-1}])expect(calculateRebarLine(bad,D)).toBeNull();
    expect(calculateRebarLine(line12,0)).toBeNull();
  });
  it('accepts a calculated weight to 0.1 kg and compares it with the weight entered',()=>{
    expect(acceptedWeightKg(266.344)).toBe(266.3);expect(acceptedWeightKg(184.968)).toBe(185);
    const calculated=calculateRebarLine(line12,D)!.weightKg+calculateRebarLine(line10,D)!.weightKg;
    expect(weightDifference(calculated,460)!.kg).toBeCloseTo(8.6946,3);expect(weightDifference(calculated,460)!.percent).toBeCloseTo(1.9266,3);
    expect(comparisonText(calculated,460)).toBe('Calculated 451.3 kg, entered 460 kg, difference 8.7 kg (1.9%)');
    expect(comparisonText(185,185)).toBeNull();expect(comparisonText(null,460)).toBeNull();expect(weightDifference(0,5)).toBeNull();
  });
  it('shares a supplier total in proportion to the calculated weights, to 0.1 kg and exactly the total',()=>{
    const a=calculateRebarLine(line12,D)!.weightKg,b=calculateRebarLine(line10,D)!.weightKg;
    expect(splitTotalProportionally(460,[a,b])).toEqual([271.5,188.5]);
    const three=splitTotalProportionally(100,[1,1,1])!;expect(Math.round(three.reduce((x,y)=>x+y,0)*10)/10).toBe(100);
    expect(splitTotalProportionally(0,[a,b])).toBeNull();expect(splitTotalProportionally(460,[])).toBeNull();expect(splitTotalProportionally(460,[0,0])).toBeNull();
  });
  it('reads the diameter from an item name, the steel category, and the editable diameter list',()=>{
    expect(diameterFromName('Rebar 12 mm')).toBe(12);expect(diameterFromName('Ø14 bar')).toBe(14);expect(diameterFromName('Steel pipe')).toBeNull();
    expect(isSteelCategory('Steel')).toBe(true);expect(isSteelCategory('Rebar & mesh')).toBe(true);expect(isSteelCategory('Aggregates')).toBe(false);
    expect(parseDiameterList('12, 8 10;10 x 0')).toEqual([8,10,12]);
    expect(validateSteelSettings({densityKgM3:7850,diameters:[8]})).toEqual([]);
    expect(validateSteelSettings({densityKgM3:5,diameters:[]}).length).toBe(2);
  });
});

describe('manual weight and calculated weight together',()=>{
  it('never overwrites a typed weight: typing only marks it typed and keeps the calculated figure beside it',()=>{
    expect(sourceAfterTyping('266.344','calculated')).toBe('typed');
    expect(sourceAfterTyping('','')).toBe('');expect(sourceAfterTyping(undefined,'typed')).toBe('typed');
    expect(calculatedPatch(266.344)).toEqual({quantity:'266.3',calc:'266.344',source:'calculated'});
  });
  it('asks "Calculated weight changed, update?" only when a calculated weight no longer matches its inputs',()=>{
    const same=calculateRebarLine(line12,D)!,more=calculateRebarLine({...line12,pieces:60},D)!;
    expect(calculatedWeightChanged('calculated',same.weightKg,same)).toBe(false);
    expect(calculatedWeightChanged('calculated',same.weightKg,more)).toBe(true);
    expect(calculatedWeightChanged('typed',same.weightKg,more)).toBe(false);
    expect(calculatedWeightChanged(null,null,more)).toBe(false);expect(calculatedWeightChanged('calculated',same.weightKg,null)).toBe(false);
  });
  it('is the only place the screen takes a calculated weight from: the sheet button and the Update choice',()=>{
    const screen=readFileSync('src/ui/screens/QuarryPurchasesScreen.tsx','utf8'),fields=readFileSync('src/ui/components/SteelItemFields.tsx','utf8'),sheet=readFileSync('src/ui/components/RebarCalculatorSheet.tsx','utf8');
    expect(screen.match(/calculatedPatch\(/g)?.length).toBe(1);
    expect(fields.match(/calculatedPatch\(/g)?.length).toBe(1);
    expect(sheet).toContain('primaryLabel="Use calculated weights"');
    expect(screen).toContain('onApply={applyCalculator}');
    expect(screen).not.toMatch(/calculateRebarLine\(/);
  });
});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('hadid','Al Hadid Steel Trading',1,'${SEED_TIME}','${SEED_TIME}'),('other','Other Steel Co',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('steel','Steel','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,created_at,updated_at) VALUES ('rebar12','steel','Rebar 12 mm','unit_kg',1,'${SEED_TIME}','${SEED_TIME}'),('rebar10','steel','Rebar 10 mm','unit_kg',1,'${SEED_TIME}','${SEED_TIME}'),('pipe','steel','Steel pipe','unit_piece',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const quarry=new SqliteQuarryRepository(db as never);
  const draft=(extra:Partial<QuarryPurchaseDraft>={}):QuarryPurchaseDraft=>({...emptyQuarryPurchaseDraft,recordDate:'2026-10-10',supplierId:'hadid',projectId:'road',itemId:'rebar12',unitId:'unit_kg',quantityCubicMetres:'266.3',pieces:'50',diameterMm:'12',lengthPerBarM:'6',calculatedWeightKg:'266.3441',weightSource:'calculated',deliveryMethod:'supplier',supplierTruckPlate:'778899',supplierTicketNumber:'0117',...extra});
  return {db,quarry,draft};
}

describe('what is saved',()=>{
  it('saves each diameter as its own item with the calculated weight beside the weight that counts',async()=>{
    const {db,quarry,draft}=await setup();
    const saved=await quarry.confirmDelivery([
      draft(),
      draft({itemId:'rebar10',diameterMm:'10',calculatedWeightKg:'184.9613',quantityCubicMetres:'188.5',weightSource:'typed'}),
      draft({itemId:'pipe',unitId:'unit_piece',quantityCubicMetres:'1',pieces:'',diameterMm:'',lengthPerBarM:'',calculatedWeightKg:'',weightSource:''}),
    ]);
    expect(saved.map(load=>[load.itemName,load.quantityCubicMetres,load.calculatedWeightKg,load.weightSource,load.diameterMm,load.lengthPerBarM,load.pieces])).toEqual([
      ['Rebar 12 mm',266.3,266.3441,'calculated',12,6,50],['Rebar 10 mm',188.5,184.9613,'typed',10,6,50],['Steel pipe',1,null,null,null,null,null]]);
    expect(new Set(saved.map(load=>load.deliveryGroupId)).size).toBe(1);
    expect(db.raw.prepare('SELECT quantity_cubic_metres q,calculated_weight_kg c,weight_source s FROM quarry_purchases WHERE id=?').get(saved[1]!.id)).toEqual({q:188.5,c:184.9613,s:'typed'});
  });
  it('saves a weight typed without any calculator exactly as typed, with a length and no calculated weight',async()=>{
    const {quarry,draft}=await setup();
    const saved=await quarry.confirmPurchase(draft({quantityCubicMetres:'271.45',diameterMm:'',calculatedWeightKg:'',weightSource:''}));
    expect(saved).toMatchObject({quantityCubicMetres:271.45,lengthPerBarM:6,diameterMm:null,calculatedWeightKg:null,weightSource:null,pieces:50});
  });
  it('rejects a length, diameter or calculated weight that is not a number above zero, or a made-up source',async()=>{
    const {quarry,draft}=await setup();const data=await quarry.getSetup();
    for(const patch of [{lengthPerBarM:'0'},{lengthPerBarM:'-6'},{diameterMm:'abc'},{calculatedWeightKg:'0'},{lengthPerBarM:'5000'}])expect(validateQuarryPurchase(draft(patch),data).length).toBe(1);
    expect(validateQuarryPurchase(draft({weightSource:'guess' as never}),data)).toContain('The weight source is not valid.');
    expect(validateQuarryPurchase(draft({lengthPerBarM:'6,5'}),data)).toEqual([]);
  });
  it('corrects the length and the weight source with a reason, recording what changed',async()=>{
    const {quarry,draft}=await setup();
    const saved=await quarry.confirmPurchase(draft());
    const corrected=await quarry.correctPurchase(saved.id,{...draft(),quantityCubicMetres:'270',weightSource:'typed',lengthPerBarM:'12',correctionReason:'Supplier note says 12 m bars, weight 270'});
    expect(corrected).toMatchObject({quantityCubicMetres:270,lengthPerBarM:12,weightSource:'typed',calculatedWeightKg:266.3441});
    expect(corrected.correctionHistory[0]!.changes.map(change=>change.field).sort()).toEqual(['Length per bar','Quantity']);
  });
  it('shows the supplier steel totals from the weights that count, so typed and calculated weights add up exactly as printed',async()=>{
    const {quarry,draft}=await setup();
    await quarry.confirmDelivery([draft(),draft({itemId:'rebar10',diameterMm:'10',calculatedWeightKg:'184.9613',quantityCubicMetres:'185'})]);
    const [category]=categorySummaries(await quarry.listPurchases());
    expect(category!.totals).toEqual([{unitId:'unit_kg',unitSymbol:'kg',quantity:451.3,loads:2}]);
  });
});

describe('density and diameter list: one saved setting',()=>{
  it('starts with 7,850 and the default list, keeps a change, and rejects nonsense',async()=>{
    const {db,quarry}=await setup();
    expect(await quarry.getSteelSettings()).toEqual({densityKgM3:7850,diameters:[8,10,12,14,16,18,20,25,32]});
    await quarry.saveSteelSettings({densityKgM3:7800,diameters:[16,12,12,10]});
    expect(await quarry.getSteelSettings()).toEqual({densityKgM3:7800,diameters:[10,12,16]});
    await expect(quarry.saveSteelSettings({densityKgM3:1,diameters:[12]})).rejects.toThrow('Density must be');
    await expect(quarry.saveSteelSettings({densityKgM3:7850,diameters:[]})).rejects.toThrow('at least one diameter');
    expect(db.raw.prepare('SELECT COUNT(*) n FROM steel_settings').get()).toEqual({n:1});
    expect(calculateRebarLine(line12,(await quarry.getSteelSettings()).densityKgM3)!.weightKg).toBeCloseTo(266.344*7800/7850,2);
  });
});

describe('the supplier PDF and Excel',()=>{
  async function note(){
    const {db,quarry,draft}=await setup();
    await quarry.confirmDelivery([draft({quantityCubicMetres:'271.5',weightSource:'typed'}),draft({itemId:'rebar10',diameterMm:'10',calculatedWeightKg:'184.9613',quantityCubicMetres:'188.5',weightSource:'typed'})]);
    await quarry.confirmPurchase(draft({recordDate:'2026-10-03',quantityCubicMetres:'540',pieces:'100',lengthPerBarM:'12',diameterMm:'',calculatedWeightKg:'',weightSource:'',supplierTicketNumber:'0112'}));
    await quarry.confirmPurchase(draft({recordDate:'2026-10-01',quantityCubicMetres:'280',pieces:'20',lengthPerBarM:'',diameterMm:'',calculatedWeightKg:'',weightSource:'',supplierTicketNumber:'0099'}));
    await quarry.confirmPurchase(draft({supplierId:'other',quantityCubicMetres:'999',pieces:'7'}));
    return {db,quarry};
  }
  it('prints Length per bar and Meters beside Pieces, and where each weight came from',async()=>{
    const {quarry}=await note();
    const report=buildSupplierDeliveriesPdf({supplierId:'hadid',supplierName:'Al Hadid Steel Trading',purchases:await quarry.listPurchases(),filters:{includePrices:false,includeDiesel:false},generatedAt:'2026-10-12T16:30:00'});
    const html=buildSupplierDeliveriesHtml({companyName:'DROMEX S.A.R.L.',logo:null,contactLine:null,report}).replace(/\s+/g,' ');
    expect(report.hasLength).toBe(true);
    expect(html).toContain('<th>Ticket</th><th class="num">Pieces</th><th class="num">Length per bar</th><th class="num">Meters</th><th class="num">Quantity</th><th>Status</th>');
    expect(html).toContain('<td class="num wr">50</td><td class="num wr">6 m</td><td class="num wr">300</td> <td class="num">271.5 kg<div class="muted">Calculated 266.3 kg</div></td>');
    expect(html).toContain('<td class="num wr">100</td><td class="num wr">12 m</td><td class="num wr">1200</td> <td class="num">540 kg<div class="muted">Typed only</div></td>');
    expect(html).toContain('<td class="num wr">20</td><td class="num wr"><span class="missing wrap">Not recorded</span></td><td class="num wr"><span class="missing wrap">Not recorded</span></td>');
    expect(html).not.toContain('999 kg');
    expect(html.match(/<colgroup>.*?<\/colgroup>/)![0].match(/width:(\d+)%/g)!.reduce((sum,value)=>sum+Number(value.match(/\d+/)![0]),0)).toBe(100);
  });
  it('keeps 12 aligned columns with prices, and the same 100% widths',async()=>{
    const {quarry}=await note();
    const report=buildSupplierDeliveriesPdf({supplierId:'hadid',supplierName:'Al Hadid Steel Trading',purchases:await quarry.listPurchases(),filters:{includePrices:true,includeDiesel:false},generatedAt:'2026-10-12T16:30:00'});
    const html=buildSupplierDeliveriesHtml({companyName:'DROMEX S.A.R.L.',logo:null,contactLine:null,report});
    const widths=html.slice(html.indexOf('<section class="block table-block">')).match(/<colgroup>.*?<\/colgroup>/s)![0].match(/width:(\d+)%/g)!;
    expect(widths.length).toBe(12);expect(widths.reduce((sum,value)=>sum+Number(value.match(/\d+/)![0]),0)).toBe(100);
    expect((html.match(/<tr class="bar-row">.*?<\/tr><tr>(.*?)<\/tr><\/thead>/s)![1]!.match(/<th/g)??[]).length).toBe(12);
  });
  it('leaves a PDF with only typed weights and no length exactly as in Step 1',async()=>{
    const {quarry,draft}=await setup();
    await quarry.confirmPurchase(draft({lengthPerBarM:'',diameterMm:'',calculatedWeightKg:'',weightSource:'',quantityCubicMetres:'270'}));
    const report=buildSupplierDeliveriesPdf({supplierId:'hadid',supplierName:'Al Hadid Steel Trading',purchases:await quarry.listPurchases(),filters:{includePrices:false,includeDiesel:false},generatedAt:'2026-10-12T16:30:00'});
    const html=buildSupplierDeliveriesHtml({companyName:'DROMEX S.A.R.L.',logo:null,contactLine:null,report});
    expect(report.hasLength).toBe(false);expect(html).not.toContain('Length per bar');expect(html).not.toContain('Typed only');
  });
  it('adds the steel columns to the Excel loads sheet: diameter, length, meters, calculated kg, difference and source',async()=>{
    const {db}=await note();
    const data=await new SqliteBusinessReportRepository(db as never).getReportData();
    const rows=data.quarryPurchases.filter(row=>row.Supplier==='Al Hadid Steel Trading');
    const twelve=rows.find(row=>row.Item==='Rebar 12 mm'&&row['Diameter mm']===12)!;
    expect(twelve).toMatchObject({'Diameter mm':12,'Length per Bar m':6,Meters:300,'Calculated Weight kg':266.3441,Quantity:271.5,'Weight Source':'typed'});
    expect(twelve['Weight Difference kg']).toBeCloseTo(5.1559,4);
    const typedOnly=rows.find(row=>row['Length per Bar m']===12)!;
    expect(typedOnly).toMatchObject({Meters:1200,'Calculated Weight kg':null,'Weight Difference kg':null,'Weight Source':null});
    expect(sheetsForBusinessReport('quarry',data).find(sheet=>sheet.name==='Purchase Details')).toBeDefined();
  });
});

describe('data safety',()=>{
  it('upgrades a version-54 database: new columns empty on every old load, settings created, nothing lost',async()=>{
    const {db,quarry,draft}=await setup();
    const old=await quarry.confirmPurchase(draft({lengthPerBarM:'',diameterMm:'',calculatedWeightKg:'',weightSource:'',quantityCubicMetes:undefined} as never));
    db.raw.exec('DROP TABLE steel_settings;ALTER TABLE quarry_purchases DROP COLUMN diameter_mm;ALTER TABLE quarry_purchases DROP COLUMN length_per_bar_m;ALTER TABLE quarry_purchases DROP COLUMN calculated_weight_kg;ALTER TABLE quarry_purchases DROP COLUMN weight_source;PRAGMA user_version=54;');
    const before=db.raw.prepare('SELECT * FROM quarry_purchases WHERE id=?').get(old.id);
    await migrateDatabase(db as never);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(55);
    expect(db.raw.prepare('SELECT * FROM quarry_purchases WHERE id=?').get(old.id)).toEqual({...before,diameter_mm:null,length_per_bar_m:null,calculated_weight_kg:null,weight_source:null});
    expect(await quarry.getSteelSettings()).toEqual(defaultSteelSettings());
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM steel_settings').get()).toEqual({n:1});
  });
  it('keeps the calculated weight, the length, the source and the density through a backup file restore',async()=>{
    const {db,quarry,draft}=await setup();
    await quarry.saveSteelSettings({densityKgM3:7800,diameters:[10,12]});
    const saved=await quarry.confirmDelivery([draft(),draft({itemId:'rebar10',diameterMm:'10',calculatedWeightKg:'184.9613',quantityCubicMetres:'190',weightSource:'typed'})]);
    const folder=mkdtempSync(path.join(os.tmpdir(),'dromex-rebar-'));folders.push(folder);const file=path.join(folder,'backup.sqlite');
    db.raw.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);
    const restored=new SqliteTestDatabase(file);databases.push(restored);
    expect(restored.raw.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const repository=new SqliteQuarryRepository(restored as never);
    const key=(load:{itemName:string;quantityCubicMetres:number;calculatedWeightKg?:number|null;lengthPerBarM?:number|null;weightSource?:string|null;diameterMm?:number|null})=>[load.itemName,load.quantityCubicMetres,load.calculatedWeightKg,load.lengthPerBarM,load.weightSource,load.diameterMm];
    expect((await repository.listPurchases()).map(key).sort()).toEqual(saved.map(key).sort());
    expect(await repository.getSteelSettings()).toEqual({densityKgM3:7800,diameters:[10,12]});
  });
});
