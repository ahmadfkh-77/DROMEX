import {describe,expect,it} from 'vitest';

import type {StockUseRow} from '../src/domain/stock';
import {currentVersion,materialForLoad,reconcileStockUse,versionOn,type NewStockUseRow,type RuleBatch,type RuleLoad,type RuleOverride,type StockRule} from '../src/domain/stockRules';

/**
 * The counting engine of the Stock usage rules, as pure code: each confirmed load of the rule's item takes its materials out of Stock, oldest
 * batch first and carrying on into the next; a load keeps the rate it was counted with; cancelled and corrected loads are reversed or adjusted
 * by more rows; the owner can type the real amount; and a load is never blocked, a shortage is listed instead.
 */
const CEMENT='cement',SAND='sand';
const rule=(extra:Partial<StockRule>={}):StockRule=>({id:'rule_c30',loadItemId:'c30',loadItemName:'Ready-mix C30',unitSymbol:'m³',enabled:true,versions:[{id:'v1',effectiveFrom:'2026-10-15',perQuantity:1,lines:[{stockItemId:CEMENT,amount:7},{stockItemId:SAND,amount:0.45}],createdAt:'2026-10-14T08:00:00.000Z'}],...extra});
const load=(id:string,quantity:number|null,day='2026-10-16',extra:Partial<RuleLoad>={}):RuleLoad=>({id,itemId:'c30',itemName:'Ready-mix C30',loadNumber:`0${id.slice(-3)}`,confirmedAt:`${day}T09:00:00`,active:true,quantity,unitSymbol:'m³',...extra});
const batch=(id:string,itemId:string,day:string,quantity:number,active=true):RuleBatch=>({id,itemId,arrivedDay:day,active,quantity});
const batches=[batch('c1',CEMENT,'2026-10-03',60),batch('c2',CEMENT,'2026-10-12',350),batch('s1',SAND,'2026-10-01',5),batch('s2',SAND,'2026-10-11',40)];
let counter=0;
/** What the repository would save: each planned row becomes a stored row. */
const store=(planned:NewStockUseRow[]):StockUseRow[]=>planned.map(row=>({id:`row_${counter+=1}`,groupId:row.groupId,itemId:row.itemId,batchId:row.batchId,kind:row.kind,quantity:row.quantity,usedOn:row.usedOn,note:row.note,reason:null,createdAt:`2026-10-16T10:00:${String(counter%60).padStart(2,'0')}.000Z`,source:'load' as const,loadId:row.loadId,loadNumber:row.loadNumber,loadQuantity:row.loadQuantity,loadUnit:row.loadUnit,ruleId:row.ruleId,ruleVersionId:row.ruleVersionId,rulePerQuantity:row.rulePerQuantity,ruleAmount:row.ruleAmount}));
const run=(extra:{rules?:StockRule[];loads:RuleLoad[];rows?:StockUseRow[];batches?:RuleBatch[];overrides?:RuleOverride[]})=>reconcileStockUse({rules:[rule()],rows:[],batches,overrides:[],...extra});
const net=(rows:readonly {itemId:string;quantity:number}[],itemId:string)=>Math.round(rows.filter(row=>row.itemId===itemId).reduce((sum,row)=>sum+row.quantity,0)*1000)/1000;

describe('the amounts',()=>{
  it('takes `amount` of a material for every `perQuantity` of the load, to three decimals',()=>{
    expect(materialForLoad(8,1,7)).toBe(56);expect(materialForLoad(8,1,0.45)).toBe(3.6);expect(materialForLoad(6,2,7)).toBe(21);expect(materialForLoad(1.333,1,7)).toBe(9.331);
  });
  it('uses the version in force on the day, and none before the rule begins',()=>{
    const versions=[{id:'v1',effectiveFrom:'2026-10-15',perQuantity:1,lines:[],createdAt:'a'},{id:'v2',effectiveFrom:'2026-11-02',perQuantity:1,lines:[],createdAt:'b'}];
    expect(versionOn({versions},'2026-10-14')).toBeNull();expect(versionOn({versions},'2026-10-15')?.id).toBe('v1');expect(versionOn({versions},'2026-11-01')?.id).toBe('v1');expect(versionOn({versions},'2026-11-02')?.id).toBe('v2');
    expect(currentVersion({versions},'2026-10-20')?.id).toBe('v1');expect(currentVersion({versions},'2026-10-01')?.id).toBe('v1');expect(currentVersion({versions},'2026-12-01')?.id).toBe('v2');
  });
});

describe('counting a load',()=>{
  it('takes every material of the rule, oldest batch first, and records the rule it used',()=>{
    const {rows,attention}=run({loads:[load('L0412',8)]});
    expect(attention).toEqual([]);
    expect(net(rows,CEMENT)).toBe(56);expect(net(rows,SAND)).toBe(3.6);
    expect(rows.filter(row=>row.itemId===CEMENT)).toEqual([expect.objectContaining({batchId:'c1',kind:'use',quantity:56,usedOn:'2026-10-16',groupId:'load_L0412_cement',loadNumber:'0412',loadQuantity:8,loadUnit:'m³',ruleId:'rule_c30',ruleVersionId:'v1',rulePerQuantity:1,ruleAmount:7})]);
    expect(rows.filter(row=>row.itemId===SAND)).toEqual([expect.objectContaining({batchId:'s1',quantity:3.6})]);
  });
  it('carries on into the next batch when one runs out, load after load',()=>{
    const first=run({loads:[load('L0412',8)]});
    const stored=store(first.rows);
    const second=run({loads:[load('L0412',8),load('L0413',6)],rows:stored});
    expect(second.rows.filter(row=>row.itemId===CEMENT).map(row=>[row.batchId,row.quantity])).toEqual([['c1',4],['c2',38]]);
    expect(second.rows.filter(row=>row.itemId===SAND).map(row=>[row.batchId,row.quantity])).toEqual([['s1',1.4],['s2',1.3]]);
    expect(second.attention).toEqual([]);
  });
  it('counts once: running it again adds nothing',()=>{
    const first=run({loads:[load('L0412',8),load('L0413',6)]});
    const again=run({loads:[load('L0412',8),load('L0413',6)],rows:store(first.rows)});
    expect(again.rows).toEqual([]);expect(again.attention).toEqual([]);
  });
  it('only draws on batches that had arrived by the load\'s day',()=>{
    const early=rule({versions:[{id:'v0',effectiveFrom:'2026-10-01',perQuantity:1,lines:[{stockItemId:CEMENT,amount:7}],createdAt:'2026-09-30T08:00:00.000Z'}]});
    const {rows,attention}=run({rules:[early],loads:[load('L0400',20,'2026-10-02')],batches:[batch('c1',CEMENT,'2026-10-03',60),batch('c2',CEMENT,'2026-10-12',350)]});
    expect(rows.filter(row=>row.itemId===CEMENT)).toEqual([]);
    expect(attention.find(item=>item.stockItemId===CEMENT)).toMatchObject({kind:'short',quantity:140});
  });
  it('does not count a load before the rule began, or when the rule is off',()=>{
    expect(run({loads:[load('L0300',8,'2026-10-14')]}).rows).toEqual([]);
    expect(run({rules:[rule({enabled:false})],loads:[load('L0412',8)]}).rows).toEqual([]);
    expect(run({rules:[],loads:[load('L0412',8)]}).rows).toEqual([]);
  });
  it('ignores loads of items that have no rule',()=>{
    expect(run({loads:[load('L0500',8,'2026-10-16',{itemId:'asphalt'})]}).rows).toEqual([]);
  });
});

describe('when stock is short',()=>{
  const tight=[batch('c1',CEMENT,'2026-10-03',25),batch('s1',SAND,'2026-10-01',50)];
  it('takes what exists, lists the shortage, and never blocks',()=>{
    const {rows,attention}=run({loads:[load('L0415',8)],batches:tight});
    expect(net(rows,CEMENT)).toBe(25);expect(net(rows,SAND)).toBe(3.6);
    expect(attention).toEqual([expect.objectContaining({loadId:'L0415',stockItemId:CEMENT,kind:'short',quantity:31})]);
  });
  it('fills the shortage by itself when a delivery arrives, and then lists nothing',()=>{
    const first=run({loads:[load('L0415',8)],batches:tight});
    const arrived=[...tight,batch('c3',CEMENT,'2026-10-16',300)];
    const second=run({loads:[load('L0415',8)],rows:store(first.rows),batches:arrived});
    expect(second.rows.filter(row=>row.itemId===CEMENT).map(row=>[row.batchId,row.quantity])).toEqual([['c3',31]]);
    expect(second.attention).toEqual([]);
    expect(run({loads:[load('L0415',8)],rows:store([...first.rows,...second.rows]),batches:arrived}).rows).toEqual([]);
  });
  it('lists a shortage each time until it is covered, without adding rows that cannot be filled',()=>{
    const first=run({loads:[load('L0415',8)],batches:tight});
    const again=run({loads:[load('L0415',8)],rows:store(first.rows),batches:tight});
    expect(again.rows).toEqual([]);expect(again.attention.map(item=>item.quantity)).toEqual([31]);
  });
});

describe('a load that changes',()=>{
  it('is reversed when it is cancelled, taking back from the most recent batch first, and counted again when reactivated',()=>{
    const first=store(run({loads:[load('L0413',6)],batches:[batch('c1',CEMENT,'2026-10-03',4),batch('c2',CEMENT,'2026-10-12',350)]}).rows);
    expect(first.filter(row=>row.itemId===CEMENT).map(row=>[row.batchId,row.quantity])).toEqual([['c1',4],['c2',38]]);
    const cancelled=run({loads:[load('L0413',6,'2026-10-16',{active:false})],rows:first,batches:[batch('c1',CEMENT,'2026-10-03',4),batch('c2',CEMENT,'2026-10-12',350)]});
    expect(cancelled.rows.filter(row=>row.itemId===CEMENT).map(row=>[row.batchId,row.kind,row.quantity,row.note])).toEqual([['c2','reversal',-38,'Load cancelled'],['c1','reversal',-4,'Load cancelled']]);
    expect(net([...first,...store(cancelled.rows)],CEMENT)).toBe(0);
    const back=run({loads:[load('L0413',6)],rows:[...first,...store(cancelled.rows)],batches:[batch('c1',CEMENT,'2026-10-03',4),batch('c2',CEMENT,'2026-10-12',350)]});
    expect(net(back.rows,CEMENT)).toBe(42);expect(back.rows[0]!.note).toBe('Load counted again');
  });
  it('adds or takes back only the difference when its quantity is corrected, at the rate it was counted with',()=>{
    const first=store(run({loads:[load('L0412',8)]}).rows);
    const more=run({loads:[load('L0412',9)],rows:first});
    expect(net(more.rows,CEMENT)).toBe(7);expect(more.rows[0]).toMatchObject({kind:'use',note:'Load corrected',rulePerQuantity:1,ruleAmount:7});
    const less=run({loads:[load('L0412',5)],rows:first});
    expect(less.rows.filter(row=>row.itemId===CEMENT)).toEqual([expect.objectContaining({kind:'reversal',quantity:-21,note:'Load corrected'})]);
  });
  it('keeps the rate a load was counted with when the rule changes later, and uses the new rate from its date',()=>{
    const changed=rule({versions:[...rule().versions,{id:'v2',effectiveFrom:'2026-11-02',perQuantity:1,lines:[{stockItemId:CEMENT,amount:6.5},{stockItemId:SAND,amount:0.45}],createdAt:'2026-10-30T08:00:00.000Z'}]});
    const counted=store(run({rules:[rule()],loads:[load('L0412',8)]}).rows);
    const corrected=run({rules:[changed],loads:[load('L0412',10)],rows:counted});
    expect(net(corrected.rows,CEMENT)).toBe(14);
    const november=run({rules:[changed],loads:[load('L0600',8,'2026-11-03')],batches:[batch('c2',CEMENT,'2026-10-12',350),batch('s2',SAND,'2026-10-11',40)]});
    expect(net(november.rows,CEMENT)).toBe(52);expect(november.rows[0]).toMatchObject({ruleVersionId:'v2',ruleAmount:6.5});
    const october=run({rules:[changed],loads:[load('L0601',8,'2026-11-01')]});
    expect(net(october.rows,CEMENT)).toBe(56);
  });
  it('uses the real amount the owner typed for one load, and keeps it when the load is corrected',()=>{
    const first=store(run({loads:[load('L0412',8)]}).rows);
    const override:RuleOverride={loadId:'L0412',stockItemId:CEMENT,quantity:55,reason:'Counted the empty bags',createdAt:'2026-10-16T11:00:00.000Z'};
    const adjusted=run({loads:[load('L0412',8)],rows:first,overrides:[override]});
    expect(adjusted.rows.filter(row=>row.itemId===CEMENT)).toEqual([expect.objectContaining({kind:'reversal',quantity:-1,note:'Adjusted: Counted the empty bags'})]);
    expect(adjusted.rows.filter(row=>row.itemId===SAND)).toEqual([]);
    const later=run({loads:[load('L0412',9)],rows:[...first,...store(adjusted.rows)],overrides:[override]});
    expect(later.rows.filter(row=>row.itemId===CEMENT)).toEqual([]);
    const newer:RuleOverride={...override,quantity:60,reason:'Recounted',createdAt:'2026-10-16T12:00:00.000Z'};
    const again=run({loads:[load('L0412',8)],rows:[...first,...store(adjusted.rows)],overrides:[override,newer]});
    expect(net(again.rows,CEMENT)).toBe(5);expect(again.rows[0]!.note).toBe('Adjusted: Recounted');
  });
  it('counts an override of zero as nothing used, and a cancelled load as nothing whatever the override',()=>{
    const first=store(run({loads:[load('L0412',8)]}).rows);
    const zero=run({loads:[load('L0412',8)],rows:first,overrides:[{loadId:'L0412',stockItemId:CEMENT,quantity:0,reason:'Not used',createdAt:'2026-10-16T11:00:00.000Z'}]});
    expect(net(zero.rows,CEMENT)).toBe(-56);
    const cancelled=run({loads:[load('L0412',8,'2026-10-16',{active:false})],rows:first,overrides:[{loadId:'L0412',stockItemId:CEMENT,quantity:55,reason:'x',createdAt:'2026-10-16T11:00:00.000Z'}]});
    expect(net(cancelled.rows,CEMENT)).toBe(-56);expect(cancelled.rows[0]!.note).toBe('Load cancelled');
  });
  it('still reverses a counted load when the rule has since been turned off',()=>{
    const counted=store(run({loads:[load('L0412',8)]}).rows);
    const off=run({rules:[rule({enabled:false})],loads:[load('L0412',8,'2026-10-16',{active:false})],rows:counted});
    expect(net(off.rows,CEMENT)).toBe(-56);
    expect(run({rules:[rule({enabled:false})],loads:[load('L0412',8)],rows:counted}).rows).toEqual([]);
  });
});

describe('a load that cannot be counted',()=>{
  it('is listed, not guessed, when its quantity is unknown or in another unit',()=>{
    const unknown=run({loads:[load('L0420',null)]});
    expect(unknown.rows).toEqual([]);expect(unknown.attention.map(item=>[item.kind,item.stockItemId])).toEqual([['not_countable',CEMENT],['not_countable',SAND]]);
    const tons=run({loads:[load('L0421',12,'2026-10-16',{unitSymbol:'t'})]});
    expect(tons.rows).toEqual([]);expect(tons.attention[0]).toMatchObject({kind:'not_countable',loadNumber:'0421'});expect(tons.attention[0]!.note).toContain('m³');
    expect(run({loads:[load('L0422',8,'2026-10-16',{unitSymbol:'M³'})]}).rows.length).toBeGreaterThan(0);
    expect(run({loads:[load('L0423',8,'2026-10-16',{unitSymbol:null})]}).rows).toEqual([]);
  });
  it('is not listed once it is cancelled', ()=>{
    expect(run({loads:[load('L0420',null,'2026-10-16',{active:false})]}).attention).toEqual([]);
  });
});
