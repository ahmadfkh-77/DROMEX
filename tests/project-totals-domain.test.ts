import {describe,expect,it} from 'vitest';

import {
  buildItemLedger,describeTotalsRange,emptyTotalsFilters,formatTotalQuantity,summarizeConstruction,summarizeFuel,totalsFilterChoices,validateTotalsFilters,
  type ProjectTotalsData,
} from '../src/domain/projectTotals';

/** DEC-481. Project Totals keeps delivered and used quantities apart and never adds unlike units. */
const data:ProjectTotalsData={
  deliveries:[
    {source:'supplier_delivery',itemKey:'id:sand',itemName:'Sand',supplierKey:'id:sup_a',supplierName:'Alpha Quarry',unitKey:'unit_ton',unitSymbol:'t',quantity:40,recordCount:2},
    {source:'supplier_delivery',itemKey:'id:sand',itemName:'Sand',supplierKey:'id:sup_b',supplierName:'Beta Quarry',unitKey:'unit_ton',unitSymbol:'t',quantity:12.5,recordCount:1},
    {source:'supplier_delivery',itemKey:'id:sand',itemName:'Sand',supplierKey:'id:sup_b',supplierName:'Beta Quarry',unitKey:'unit_m3',unitSymbol:'m³',quantity:6,recordCount:1},
    {source:'company_delivery',itemKey:'id:sand',itemName:'Sand',supplierKey:'company',supplierName:'Company deliveries',unitKey:'unit_ton',unitSymbol:'t',quantity:10,recordCount:1},
    {source:'supplier_delivery',itemKey:'id:asphalt',itemName:'Asphalt',supplierKey:'id:sup_a',supplierName:'Alpha Quarry',unitKey:'unit_ton',unitSymbol:'t',quantity:30,recordCount:3},
  ],
  usage:[
    {movement:'used',itemKey:'id:sand',itemName:'Sand',unitKey:'unit_ton',unitSymbol:'t',quantity:45,recordCount:4},
    {movement:'transported',itemKey:'id:sand',itemName:'Sand',unitKey:'unit_ton',unitSymbol:'t',quantity:5,recordCount:1},
    {movement:'used',itemKey:'id:cement',itemName:'Cement',unitKey:'unit_bag',unitSymbol:'bag',quantity:80,recordCount:2},
  ],
  fuel:[
    {fuelType:'diesel',equipmentName:'Excavator',litres:120,recordCount:2},
    {fuelType:'diesel',equipmentName:'Roller',litres:60.5,recordCount:1},
    {fuelType:'gasoline',equipmentName:'Generator',litres:20,recordCount:1},
  ],
  construction:[
    {source:'wall_consumption',materialKey:'ready_mix',materialLabel:'Ready-mix concrete',unitKey:'m3',unitSymbol:'m³',quantity:14,recordCount:2},
    {source:'lift_ready_mix',materialKey:'ready_mix',materialLabel:'Ready-mix concrete',unitKey:'m3',unitSymbol:'m³',quantity:9,recordCount:3},
    {source:'lift_stone',materialKey:'stone',materialLabel:'Stone',unitKey:'m3',unitSymbol:'m³',quantity:7,recordCount:3},
    {source:'foundation_legacy',materialKey:'stone',materialLabel:'Stone',unitKey:'tonnes',unitSymbol:'t',quantity:5,recordCount:1},
  ],
};

describe('item ledger',()=>{
  const ledger=buildItemLedger(data,emptyTotalsFilters());
  const sand=ledger.find(item=>item.itemKey==='id:sand')!;
  it('orders items by name and keeps every unit of an item separate',()=>{
    expect(ledger.map(item=>item.itemName)).toEqual(['Asphalt','Cement','Sand']);
    expect(sand.units.map(unit=>unit.unitSymbol)).toEqual(['m³','t']);
  });
  it('totals delivered per unit across delivery sources, with the source breakdown',()=>{
    const tonnes=sand.units.find(unit=>unit.unitKey==='unit_ton')!;
    expect(tonnes.delivered).toEqual({quantity:62.5,recordCount:4,sources:[{source:'supplier_delivery',quantity:52.5,recordCount:3},{source:'company_delivery',quantity:10,recordCount:1}]});
  });
  it('keeps used and transported as their own measures, never added to delivered',()=>{
    const tonnes=sand.units.find(unit=>unit.unitKey==='unit_ton')!;
    expect(tonnes.used).toEqual({quantity:45,recordCount:4});
    expect(tonnes.transported).toEqual({quantity:5,recordCount:1});
  });
  it('shows a difference only where the same item has delivered and used quantities in the same unit',()=>{
    expect(sand.units.find(unit=>unit.unitKey==='unit_ton')!.difference).toBe(17.5);
    expect(sand.units.find(unit=>unit.unitKey==='unit_m3')!).toMatchObject({used:null,difference:null});
    const cement=ledger.find(item=>item.itemKey==='id:cement')!;
    expect(cement.units[0]).toMatchObject({delivered:null,difference:null,used:{quantity:80,recordCount:2}});
  });
  it('breaks deliveries down Item -> Supplier -> quantity per unit',()=>{
    expect(sand.suppliers).toEqual([
      {supplierKey:'id:sup_a',supplierName:'Alpha Quarry',source:'supplier_delivery',units:[{unitKey:'unit_ton',unitSymbol:'t',quantity:40,recordCount:2}]},
      {supplierKey:'id:sup_b',supplierName:'Beta Quarry',source:'supplier_delivery',units:[{unitKey:'unit_m3',unitSymbol:'m³',quantity:6,recordCount:1},{unitKey:'unit_ton',unitSymbol:'t',quantity:12.5,recordCount:1}]},
      {supplierKey:'company',supplierName:'Company deliveries',source:'company_delivery',units:[{unitKey:'unit_ton',unitSymbol:'t',quantity:10,recordCount:1}]},
    ]);
    expect(sand.recordCount).toBe(10);
  });
  it('filters by item and unit',()=>{
    expect(buildItemLedger(data,{...emptyTotalsFilters(),itemKey:'id:asphalt'}).map(item=>item.itemName)).toEqual(['Asphalt']);
    expect(buildItemLedger(data,{...emptyTotalsFilters(),unitKey:'unit_m3'}).map(item=>[item.itemName,item.units.map(unit=>unit.unitSymbol)])).toEqual([['Sand',['m³']]]);
  });
  it('filters by supplier and then refuses to pair that supplier with project-wide usage',()=>{
    const beta=buildItemLedger(data,{...emptyTotalsFilters(),supplierKey:'id:sup_b'});
    expect(beta.map(item=>item.itemName)).toEqual(['Sand']);
    expect(beta[0]!.units.find(unit=>unit.unitKey==='unit_ton')).toMatchObject({delivered:{quantity:12.5},used:null,transported:null,difference:null});
    expect(beta[0]!.usageHiddenBySupplierFilter).toBe(true);
  });
  it('shows only delivered or only used measures when asked',()=>{
    expect(buildItemLedger(data,{...emptyTotalsFilters(),view:'delivered'}).map(item=>item.itemName)).toEqual(['Asphalt','Sand']);
    const used=buildItemLedger(data,{...emptyTotalsFilters(),view:'used'});
    expect(used.map(item=>item.itemName)).toEqual(['Cement','Sand']);
    expect(used.find(item=>item.itemKey==='id:sand')!.units.every(unit=>unit.delivered===null&&unit.difference===null)).toBe(true);
  });
  it('rounds away floating-point noise',()=>{
    const noisy=buildItemLedger({...data,deliveries:[{...data.deliveries[0]!,quantity:.1},{...data.deliveries[1]!,quantity:.2}],usage:[]},emptyTotalsFilters());
    expect(noisy[0]!.units[0]!.delivered!.quantity).toBe(.3);
  });
});

describe('fuel and construction summaries',()=>{
  it('totals fuel per fuel type only, never diesel plus gasoline, with the largest consumers first',()=>{
    expect(summarizeFuel(data.fuel)).toEqual([
      {fuelType:'diesel',litres:180.5,recordCount:3,equipment:[{equipmentName:'Excavator',litres:120,recordCount:2},{equipmentName:'Roller',litres:60.5,recordCount:1}]},
      {fuelType:'gasoline',litres:20,recordCount:1,equipment:[{equipmentName:'Generator',litres:20,recordCount:1}]},
    ]);
  });
  it('keeps every construction source separate: no quantity is added across sources or units',()=>{
    expect(summarizeConstruction(data.construction)).toEqual([
      {materialKey:'ready_mix',materialLabel:'Ready-mix concrete',unitKey:'m3',unitSymbol:'m³',sources:[{source:'wall_consumption',quantity:14,recordCount:2},{source:'lift_ready_mix',quantity:9,recordCount:3}]},
      {materialKey:'stone',materialLabel:'Stone',unitKey:'m3',unitSymbol:'m³',sources:[{source:'lift_stone',quantity:7,recordCount:3}]},
      {materialKey:'stone',materialLabel:'Stone',unitKey:'tonnes',unitSymbol:'t',sources:[{source:'foundation_legacy',quantity:5,recordCount:1}]},
    ]);
  });
});

describe('filters and wording',()=>{
  it('describes the date range every total covers',()=>{
    expect(describeTotalsRange('','')).toBe('All recorded dates');
    expect(describeTotalsRange('2026-08-01','2026-08-31')).toBe('1 Aug 2026 – 31 Aug 2026');
    expect(describeTotalsRange('2026-08-01','')).toBe('From 1 Aug 2026');
    expect(describeTotalsRange('','2026-08-31')).toBe('Up to 31 Aug 2026');
  });
  it('rejects an invalid or reversed range',()=>{
    expect(validateTotalsFilters({...emptyTotalsFilters(),fromDate:'2026-09-01',toDate:'2026-08-01'})).toContain('The start date must be on or before the end date.');
    expect(validateTotalsFilters({...emptyTotalsFilters(),fromDate:'2026-02-30'})).toContain('Enter valid dates.');
    expect(validateTotalsFilters(emptyTotalsFilters())).toEqual([]);
  });
  it('offers filter choices from the data itself, archived records included',()=>{
    const choices=totalsFilterChoices(data);
    expect(choices.items.map(value=>value.label)).toEqual(['Asphalt','Cement','Sand']);
    expect(choices.suppliers.map(value=>value.label)).toEqual(['Alpha Quarry','Beta Quarry','Company deliveries']);
    expect(choices.units.map(value=>value.label)).toEqual(['bag','m³','t']);
  });
  it('prints quantities beside their unit without false zeros',()=>{
    expect(formatTotalQuantity(52.5,'t')).toBe('52.5 t');
    expect(formatTotalQuantity(1.23456,'m³')).toBe('1.235 m³');
    expect(formatTotalQuantity(.0004,'t')).toBe('0.00040 t');
    expect(formatTotalQuantity(-3,'t')).toBe('-3 t');
  });
});
