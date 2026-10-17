import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteStockRepository} from '../src/data/repositories/SqliteStockRepository';
import {emptyLoadDraft} from '../src/domain/loads';
import {buildStockReport} from '../src/domain/stockReport';
import {stockWorkbookSheets} from '../src/services/stockWorkbook';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Stock usage rules: the reports say where a use came from, and the screens show the rules, the shortages and the real-amount adjustment.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-16T12:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const read=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;

async function counted(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX Test','${SEED_TIME}');
    INSERT OR REPLACE INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('produced','Produced','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,is_active,created_at,updated_at) VALUES ('c30','produced','Ready-mix C30','unit_m3',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('cement','produced','Cement','unit_kg',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at) VALUES ('omar','Omar',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('mixer','L 204118',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const stock=new SqliteStockRepository(db as never),loads=new SqliteLoadRepository(db as never);
  await stock.recordBatch({itemId:'cement',unitId:'',recordDate:'2026-10-03',supplierId:'',invoiceNumber:'',quantity:'6000',priceBasis:'per_unit',price:'',vat:{mode:'none',ratePercent:''},notes:'',});
  await stock.saveRule({loadItemId:'c30',unitId:'unit_m3',perQuantity:'1',effectiveFrom:'2026-10-15',lines:[{stockItemId:'cement',amount:'350'}]});
  const first=await loads.confirmLoad({...emptyLoadDraft,recordDate:'2026-10-16',customerId:'customer',destinationAddress:'Beirut site',itemId:'c30',driverId:'omar',driverName:'Omar',truckId:'mixer',truckPlate:'L 204118',quantityMethod:'direct',directQuantity:'8',directUnitId:'unit_m3'});
  await stock.syncUse();
  return {stock,first};
}

describe('the reports show where a use came from',()=>{
  it('names the load, its quantity and the rate in the PDF model and in the workbook',async()=>{
    const {stock,first}=await counted();
    await stock.adjustLoadUse(first.id,'cement','2750','Counted the empty bags');
    await stock.recordUse({itemId:'cement',quantity:'100',usedOn:'2026-10-16',note:'Wall panels'});
    const overview=await stock.getOverview();
    const report=buildStockReport(overview,{itemId:'cement',includePrices:false},'2026-10-16T12:30:00.000Z');
    expect(report.items[0]!.uses.map(row=>row.source).sort()).toEqual(['By hand',expect.stringMatching(/^Load \S+ · 8 m³ × 350 per 1 \(adjusted: Counted the empty bags\)$/)]);
    const sheet=stockWorkbookSheets(overview,{itemId:'cement',includePrices:false},{name:'Plant Co'},'2026-10-16T12:30:00.000Z').find(value=>value.name==='Uses')!.rows;
    expect(sheet.find(row=>row.Source==='Load')).toMatchObject({Quantity:2750,'Load Quantity':8,'Load Unit':'m³','Rule Amount':350,'Rule Per Quantity':1,'Adjusted Reason':'Counted the empty bags','Item ID':'cement'});
    expect(sheet.find(row=>row.Source==='By hand')).toMatchObject({Quantity:100,'Load Number':null,'Rule Amount':null,Note:'Wall panels'});
    expect(overview.items[0]!.totalUsed).toBe(2850);
  });
});

describe('the screens',()=>{
  const screen=read('src/ui/screens/StockScreen.tsx'),view=read('src/ui/components/StockRulesView.tsx');
  it('counts loads whenever Stock is opened, and shows what needs attention without blocking',()=>{
    expect(screen).toContain('repository.syncUse().catch(()=>null)');expect(screen).toContain('setAttention(synced?.attention??[])');
    expect(screen).toContain('Needs attention · ${attention.length}');expect(screen).toContain('These loads were made. Nothing was blocked.');
  });
  it('says on the list and on each item whether it has a rule, and offers Usage rules',()=>{
    expect(screen).toContain('${ruleSub(value.itemId)}');expect(screen).toContain("texts.length?texts.join(' · '):'inventory only'");
    expect(screen).toContain('label="Usage rules"');expect(screen).toContain('<AppCard title="Usage rule">');expect(screen).toContain('Inventory only. You record its use by hand.');
  });
  it('lets a use from a load be adjusted, and removed only by cancelling the load',()=>{
    expect(screen).toContain('From a load');expect(screen).toContain('label="Adjust the real amount"');expect(screen).toContain('To remove it, cancel the load.');
    expect(screen).toContain('repository.adjustLoadUse(loadId,item.itemId,quantity,reason)');expect(screen).toContain('Real amount saved. The rule is not changed.');
  });
  it('builds a rule from the Catalog and Stock, with the calendar for its date and a live check',()=>{
    expect(view).toContain("<DatePickerField label={rule?'Applies to loads from *':'Count loads from *'}");
    expect(view).toContain('When this item is delivered *');expect(view).toContain('Choose from your Stock');expect(view).toContain('+ Add material');expect(view).toContain('3 · Check with a quantity');
    expect(view).toContain('Loads already counted keep the amounts they were counted with.');expect(view).toContain('Items that Bitumen already counts are not listed.');
    expect(screen).toContain('repository.saveRule(draft)');expect(screen).toContain('repository.setRuleEnabled(rule.id,!rule.enabled)');
  });
});
