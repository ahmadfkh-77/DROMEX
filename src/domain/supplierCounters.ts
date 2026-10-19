import type {QuarryDailyCounter} from './quarry';

/** One unit's total. Different units are never added together. */
export type CounterUnitTotal={symbol:string;quantity:number};
export type CounterGroup={name:string;tripCount:number;units:CounterUnitTotal[];counters:QuarryDailyCounter[]};
export type CounterBoard={
  /** Every counter of the day, open and finished, so the line does not change when one is finished. */
  summary:{trucks:number;trips:number;units:CounterUnitTotal[];places:number};
  places:string[];
  /** Open counters, grouped by where the material went. */
  groups:CounterGroup[];
  finished:QuarryDailyCounter[];
};

export const noPlaceName='No project linked';
export const counterPlaceName=(counter:QuarryDailyCounter)=>counter.projectName??noPlaceName;

function unitTotals(counters:QuarryDailyCounter[]):CounterUnitTotal[]{
  const totals=new Map<string,number>();
  for(const counter of counters)totals.set(counter.unitSymbol,(totals.get(counter.unitSymbol)??0)+counter.totalQuantityCubicMetres);
  return [...totals.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([symbol,quantity])=>({symbol,quantity:Number(quantity.toFixed(6))}));
}

/** The daily truck counters, grouped by place, with the finished ones set apart. `place` limits the view to one place. */
export function buildCounterBoard(counters:QuarryDailyCounter[],finishedKeys:ReadonlySet<string>,place:string|null):CounterBoard{
  const places=[...new Set(counters.map(counterPlaceName))].sort((a,b)=>a===noPlaceName?1:b===noPlaceName?-1:a.localeCompare(b));
  const visible=place?counters.filter(counter=>counterPlaceName(counter)===place):counters;
  const groups=new Map<string,QuarryDailyCounter[]>();
  for(const counter of visible){
    if(finishedKeys.has(counter.key))continue;
    const name=counterPlaceName(counter);
    groups.set(name,[...(groups.get(name)??[]),counter]);
  }
  return{
    summary:{trucks:counters.length,trips:counters.reduce((sum,counter)=>sum+counter.tripCount,0),units:unitTotals(counters),places:places.length},
    places,
    groups:places.filter(name=>groups.has(name)).map(name=>{const list=groups.get(name)!;return{name,tripCount:list.reduce((sum,counter)=>sum+counter.tripCount,0),units:unitTotals(list),counters:list};}),
    finished:visible.filter(counter=>finishedKeys.has(counter.key)),
  };
}

/**
 * Finished counters are a display choice for one day, kept as a small stored preference. They never touch a
 * confirmed Supplier Load, and a new day starts with none finished.
 */
export const finishedCountersKey='dromex.supplier-counters-finished.v1';
export function readFinishedCounters(raw:string|null,workDate:string):string[]{
  if(!raw)return[];
  try{
    const value=JSON.parse(raw) as {date?:unknown;keys?:unknown};
    if(value.date!==workDate||!Array.isArray(value.keys))return[];
    return value.keys.filter((key):key is string=>typeof key==='string');
  }catch{return[];}
}
export function writeFinishedCounters(workDate:string,keys:Iterable<string>):string{return JSON.stringify({date:workDate,keys:[...new Set(keys)]});}
