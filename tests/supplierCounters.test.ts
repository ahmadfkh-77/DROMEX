import {describe,expect,it} from 'vitest';
import {quarryDailyCounters,type QuarryPurchase} from '../src/domain/quarry';
import {buildCounterBoard,readFinishedCounters,writeFinishedCounters} from '../src/domain/supplierCounters';

const purchase=(id:string,time:string,place:{id:string;name:string},truckId:string,quantity:number,status:'Active'|'Cancelled'='Active',unit:{id:string;symbol:string}={id:'m3',symbol:'M³'})=>({id,purchaseNumber:`SL-${id}`,confirmedAt:`2026-10-19T${time}:00`,projectId:place.id,projectName:place.name,supplierId:'s1',supplierName:'Choukine supplier',itemId:'i1',itemName:'BaseCourse',unitId:unit.id,unitSymbol:unit.symbol,deliveryMethod:'company',driverId:`d-${truckId}`,driverName:`Driver ${truckId}`,truckId,truckPlate:`P-${truckId}`,quantityCubicMetres:quantity,status} as QuarryPurchase);
const majbal={id:'p1',name:'Majbal'},road={id:'p2',name:'Zebdine - Choukine Road'};
const day='2026-10-19';

describe('daily counter trips',()=>{
  it('lists every trip oldest first, keeps a cancelled trip out of the count and the total',()=>{
    const [counter]=quarryDailyCounters([purchase('b','10:00',road,'t1',20),purchase('a','08:00',road,'t1',20),purchase('x','09:00',road,'t1',20,'Cancelled')],day);
    expect(counter!.trips.map(trip=>trip.id)).toEqual(['a','x','b']);
    expect(counter).toMatchObject({tripCount:2,totalQuantityCubicMetres:40});
    expect(counter!.trips.find(trip=>trip.id==='x')!.status).toBe('Cancelled');
  });
  it('does not show a counter whose only trips were cancelled',()=>{
    expect(quarryDailyCounters([purchase('x','09:00',road,'t1',20,'Cancelled')],day)).toEqual([]);
  });
});

describe('the counter board',()=>{
  const counters=quarryDailyCounters([purchase('1','07:00',majbal,'t1',20),purchase('2','08:00',road,'t2',20),purchase('3','09:00',road,'t2',20),purchase('4','10:00',road,'t3',30,'Active',{id:'t',symbol:'t'})],day);
  it('groups open counters by place with per-unit totals and a day summary',()=>{
    const board=buildCounterBoard(counters,new Set(),null);
    expect(board.places).toEqual(['Majbal','Zebdine - Choukine Road']);
    expect(board.groups.map(group=>[group.name,group.tripCount])).toEqual([['Majbal',1],['Zebdine - Choukine Road',3]]);
    expect(board.groups[1]!.units).toEqual([{symbol:'M³',quantity:40},{symbol:'t',quantity:30}]);
    expect(board.summary).toMatchObject({trucks:3,trips:4,places:2});
  });
  it('moves a finished counter out of the groups and keeps the day summary unchanged',()=>{
    const key=counters.find(counter=>counter.truckPlate==='P-t2')!.key;
    const board=buildCounterBoard(counters,new Set([key]),null);
    expect(board.finished.map(counter=>counter.key)).toEqual([key]);
    expect(board.groups.flatMap(group=>group.counters).some(counter=>counter.key===key)).toBe(false);
    expect(board.summary.trips).toBe(4);
  });
  it('limits the view to one place',()=>{
    const board=buildCounterBoard(counters,new Set(),'Majbal');
    expect(board.groups.map(group=>group.name)).toEqual(['Majbal']);
    expect(board.places).toHaveLength(2);
  });
});

describe('finished counters storage',()=>{
  it('round-trips for the same day and starts empty on a new day or bad data',()=>{
    const raw=writeFinishedCounters(day,['a','b','a']);
    expect(readFinishedCounters(raw,day)).toEqual(['a','b']);
    expect(readFinishedCounters(raw,'2026-10-20')).toEqual([]);
    expect(readFinishedCounters('not json',day)).toEqual([]);
    expect(readFinishedCounters(null,day)).toEqual([]);
  });
});
