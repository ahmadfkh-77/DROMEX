import {afterEach,describe,expect,it} from 'vitest';

import {SqliteProjectTotalsRepository} from '../src/data/repositories/SqliteProjectTotalsRepository';
import {emptyInclusion,type CompanyTotalsData} from '../src/domain/companyTotals';
import {summarizeFuelFills,type ProjectFuelFill} from '../src/domain/projectTotals';
import {buildTotalsHtml} from '../src/services/totalsTemplate';
import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/** DEC-502. Project Totals PDF: an optional fuel list, and a layout where every item stands apart. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

describe('project fuel fills',()=>{
  it('lists a project’s Active fills in the date range, oldest first, with price and cost only where recorded',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    const fill=(id:string,day:string,litres:number,status='Active',project='road',price:number|null=null)=>db.raw.exec(`INSERT INTO fuel_movements (id,movement_type,confirmed_at,litres,equipment_name,fuel_type,project_id,destination_type,status,price_per_litre_usd_cents,consumption_cost_usd_cents,created_at)
      VALUES ('${id}','fill','${day}T08:00:00',${litres},'Excavator CAT 320','diesel','${project}','project','${status}',${price??'NULL'},${price==null?'NULL':Math.round(price*litres)},'${SEED_TIME}')`);
    db.raw.exec(`INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('other','customer','Other','X','active','2026-08-01','${SEED_TIME}','${SEED_TIME}',0)`);
    fill('b','2026-08-12',40,'Active','road',120);fill('a','2026-08-10',60);fill('x','2026-08-11',99,'Cancelled');fill('o','2026-08-11',30,'Active','other');fill('late','2026-09-20',10);
    const fills=await new SqliteProjectTotalsRepository(db as never).listFuelFills('road',{fromDate:'2026-08-01',toDate:'2026-08-31'});
    expect(fills.map(value=>[value.id,value.litres,value.pricePerLitreCents,value.costCents])).toEqual([['a',60,null,null],['b',40,120,4800]]);
    expect(fills[0]).toMatchObject({equipmentName:'Excavator CAT 320',fuelType:'diesel'});
  });

  it('summarizes fills per fuel type and equipment without adding diesel to gasoline',()=>{
    const fills:ProjectFuelFill[]=[
      {id:'1',confirmedAt:'2026-08-10T08:00:00',equipmentName:'Excavator',fuelType:'diesel',litres:60,pricePerLitreCents:120,costCents:7200},
      {id:'2',confirmedAt:'2026-08-11T08:00:00',equipmentName:'Excavator',fuelType:'diesel',litres:40,pricePerLitreCents:null,costCents:null},
      {id:'3',confirmedAt:'2026-08-12T08:00:00',equipmentName:'Pickup',fuelType:'gasoline',litres:25,pricePerLitreCents:150,costCents:3750},
    ];
    expect(summarizeFuelFills(fills)).toEqual({
      types:[{fuelType:'diesel',litres:100,recordCount:2,equipment:[{equipmentName:'Excavator',litres:100,recordCount:2}]},{fuelType:'gasoline',litres:25,recordCount:1,equipment:[{equipmentName:'Pickup',litres:25,recordCount:1}]}],
      cost:{totalCents:10950,pricedCount:2,unpricedCount:1},
    });
  });
});

const data:CompanyTotalsData={usageHiddenReason:null,usage:[],deliveries:[
  {source:'supplier_delivery',itemKey:'id:sand',itemName:'Sand',projectKey:'road',projectName:'Mountain Road',supplierKey:'id:a',supplierName:'Alpha Quarry',unitKey:'m3',unitSymbol:'m³',quantity:12,recordCount:2,valueCents:8000,pricedCount:1,inclusion:{...emptyInclusion(),total:2,open:2}},
  {source:'supplier_delivery',itemKey:'id:gravel',itemName:'Gravel',projectKey:'road',projectName:'Mountain Road',supplierKey:'id:a',supplierName:'Alpha Quarry',unitKey:'t',unitSymbol:'t',quantity:30,recordCount:3,valueCents:null,pricedCount:0,inclusion:{...emptyInclusion(),total:3,open:3}},
]};
const fills:ProjectFuelFill[]=[
  {id:'1',confirmedAt:'2026-08-10T08:00:00',equipmentName:'Excavator <CAT>',fuelType:'diesel',litres:60,pricePerLitreCents:120,costCents:7200},
  {id:'2',confirmedAt:'2026-08-12T09:30:00',equipmentName:'Pickup',fuelType:'gasoline',litres:25,pricePerLitreCents:null,costCents:null},
];
const base={companyName:'DROMEX',logo:null,title:'Project Totals',scope:'project' as const,filters:['Mountain Road','1 Aug 2026 – 31 Aug 2026'],generatedAt:'2026-09-02T08:00:00',data};

describe('fuel in the Project Totals PDF',()=>{
  it('leaves fuel out unless it is chosen',()=>{
    expect(buildTotalsHtml({...base,includePrices:false})).not.toContain('Fuel used on this project');
  });
  it('adds a fuel section with totals per fuel type and equipment and every fill',()=>{
    const html=buildTotalsHtml({...base,includePrices:false,fuel:fills});
    for(const text of ['Fuel used on this project','Diesel','Gasoline','60 L','25 L','Excavator &lt;CAT&gt;','10 Aug 2026','12 Aug 2026','09:30'])expect(html).toContain(text);
    expect(html).not.toContain('85 L');
    expect(html).not.toMatch(/\$\d/);
  });
  it('shows fuel prices and cost only with prices, counting unpriced fills',()=>{
    const html=buildTotalsHtml({...base,includePrices:true,fuel:fills});
    expect(html).toContain('$1.20 / L');
    expect(html).toContain('$72.00');
    expect(html).toContain('1 fill unpriced');
    expect(html).not.toContain('$0.00');
  });
  it('says so when the period has no fills',()=>{
    expect(buildTotalsHtml({...base,includePrices:false,fuel:[]})).toContain('No fuel fills recorded for this project in this period.');
  });
});

describe('clear layout',()=>{
  const html=buildTotalsHtml({...base,includePrices:false,fuel:fills});
  it('puts every material in its own numbered block with a title bar carrying its totals',()=>{
    expect((html.match(/<section class="block"/g)??[]).length).toBe(3);
    expect(html).toMatch(/<div class="block-bar"><span class="block-index">1<\/span>/);
    expect(html).toMatch(/block-bar[\s\S]*Gravel[\s\S]*30 t/);
    expect(html).toMatch(/\.block\{[^}]*border[^}]*\}/);
    expect(html).toMatch(/\.block-bar\{[^}]*background:#173F67/);
  });
  it('groups suppliers under their project and stripes rows for reading across',()=>{
    expect(html).toContain('class="group-row"');
    expect(html).toMatch(/tbody tr:nth-child\(even\)[^{]*\{[^}]*background/);
  });
  it('keeps a block title with its first rows and opens with a contents list',()=>{
    expect(html).toMatch(/\.block-bar\{[^}]*break-after:avoid/);
    expect(html).toContain('class="contents"');
    expect(html.indexOf('class="contents"')).toBeLessThan(html.indexOf('<section class="block"'));
  });
});
