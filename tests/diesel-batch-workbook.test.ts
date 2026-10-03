import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteBusinessReportRepository} from '../src/data/repositories/SqliteBusinessReportRepository';
import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {filterBusinessReportData} from '../src/domain/businessReports';
import {sheetsForBusinessReport} from '../src/services/businessWorkbook';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-492. The existing fuel workbook gains batch, source and station columns plus Diesel Batches and Fuel
 * Stations sheets with stable identifiers. No separate workbook system is created.
 */
const open:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of open.splice(0))database.close();});
const clock=(local:string)=>vi.setSystemTime(new Date(local));

async function build(){
  const db=await migratedDatabaseWithProject(open);
  db.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Al-Nour Fuel',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO machine_profiles (id,name,is_active,created_at,updated_at) VALUES ('exc','Excavator',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const fuel=new SqliteFuelRepository(db as never);
  const deliver=(local:string,litres:string,price:string,ticket:string)=>{clock(local);return fuel.recordDelivery({recordDate:local.slice(0,10),supplierId:'sup',litres,ticketNumber:ticket,pricePerLitreUsd:price,updateCurrentPrice:false,notes:''});};
  const fill=(local:string,litres:string,extra:Record<string,unknown>={})=>{clock(local);return fuel.recordFill({recordDate:local.slice(0,10),fuelType:'diesel',litres,equipmentType:'machine',equipmentId:'exc',destinationType:'project',projectId:'road',companySiteId:'',odometerReading:'',pricePerLitreUsd:'',priceOverrideReason:'',notes:'',...extra} as never);};
  await deliver('2026-09-20T09:00:00','300','1.00','OLD');
  clock('2026-10-01T09:00:00');await fuel.startDieselBatches({dipLitres:'',pricePerLitreUsd:''});
  const delivery=await deliver('2026-10-02T09:00:00','100','1.10','55821');
  await deliver('2026-10-02T10:00:00','500','','');
  const split=await fill('2026-10-03T09:00:00','450');
  const station=await fuel.createFuelStation({name:'Hasbaya Station',location:'Hasbaya',notes:''});
  const stationFill=await fill('2026-10-03T10:00:00','60',{fuelSource:'station',stationId:station.id,receiptNumber:'R-1'});
  const gasoline=await fill('2026-10-03T11:00:00','20',{fuelType:'gasoline'});
  const data=await new SqliteBusinessReportRepository(db as never).getReportData();
  return {db,fuel,data,delivery,split,station,stationFill,gasoline};
}

describe('fuel movement rows',()=>{
  it('add fuel type, source, station, receipt and batch columns to every fuel row',async()=>{
    const {data,delivery,split,stationFill}=await build();
    const row=(id:string)=>data.fuelMovements.find(value=>value['Movement ID']===id)!;
    expect(row(delivery.id)).toMatchObject({'Fuel Type':'diesel','Source':null,'Station':null,'Batch Number':'DSL-2026-00002','Batch Portions':null});
    expect(row(split.id)).toMatchObject({'Fuel Type':'diesel','Source':'Tank','Batch Number':'DSL-2026-00001 + DSL-2026-00002 + DSL-2026-00003','Batch Portions':'300 L DSL-2026-00001; 100 L DSL-2026-00002; 50 L DSL-2026-00003'});
    expect(row(stationFill.id)).toMatchObject({'Source':'Outside station','Station':'Hasbaya Station','Ticket':'R-1','Batch Number':null});
  });

  it('keeps outside station fills and gasoline out of the tank balance column, matching the app',async()=>{
    const {data,fuel}=await build();
    const last=data.fuelMovements.at(-1)!;
    expect(last['Balance After Litres']).toBe((await fuel.getOverview()).currentBalanceLitres);
  });
});

describe('Diesel Batches and Fuel Stations sheets',()=>{
  it('list every batch with stable identifiers and numeric litres',async()=>{
    const {data}=await build();
    expect(data.dieselBatches!.map(row=>[row['Batch Number'],row.Kind,row['Invoice Number'],row['Delivered Litres'],row['Remaining Litres'],row.Status])).toEqual([
      ['DSL-2026-00001','Opening stock','',300,0,'Closed'],
      ['DSL-2026-00002','Delivery','55821',100,0,'Closed'],
      ['DSL-2026-00003','Delivery','',500,450,'Open · In use'],
    ].map(([number,kind,invoice,delivered,remaining,status])=>[number,kind,invoice||null,delivered,remaining,status]));
    expect(data.dieselBatches![0]).toMatchObject({'Batch ID':expect.any(String),'Opening Basis':'Calculated (no dip reading)','Price / Litre USD':null,'Arrived At':expect.any(String)});
    expect(data.dieselBatches![1]).toMatchObject({'Price / Litre USD':1.1,'Supplier':'Al-Nour Fuel','Filled Litres':100,'Adjustment Litres':0});
  });

  it('list every saved station with its fills and litres',async()=>{
    const {data,station}=await build();
    expect(data.fuelStations).toEqual([{'Station ID':station.id,'Station':'Hasbaya Station','Location':'Hasbaya','Active':'Yes','Active Fills':1,'Litres':60}]);
  });

  it('appear in the fuel and analysis workbooks, with data dictionary entries',async()=>{
    const {data}=await build();
    for(const kind of ['fuel','analysis'] as const){
      const names=sheetsForBusinessReport(kind,data).map(sheet=>sheet.name);
      expect(names).toEqual(expect.arrayContaining(['Diesel Batches','Fuel Stations']));
    }
    const dictionary=sheetsForBusinessReport('analysis',data).find(sheet=>sheet.name==='Data Dictionary')!.rows;
    expect(dictionary).toEqual(expect.arrayContaining([expect.objectContaining({Sheet:'Diesel Batches'}),expect.objectContaining({Sheet:'Fuel Stations'})]));
  });

  it('keep only the batches that arrived inside a date filter',async()=>{
    const {data}=await build();
    const filtered=filterBusinessReportData(data,{fromDate:'2026-10-02',toDate:'2026-10-02',projectId:'',customerId:'',supplierId:'',item:'',paymentStatus:''} as never);
    expect(filtered.dieselBatches!.map(row=>row['Batch Number'])).toEqual(['DSL-2026-00002','DSL-2026-00003']);
  });

  it('leave the workbook unchanged for data without batches',()=>{
    const names=sheetsForBusinessReport('fuel',{generatedAt:'',companyName:'DROMEX',loads:[],customers:[],payments:[],openingBalances:[],quarryPurchases:[],suppliers:[],fuelMovements:[],equipmentTotals:[],projects:[],dailyReports:[],materials:[]}).map(sheet=>sheet.name);
    expect(names).not.toContain('Diesel Batches');
  });
});
