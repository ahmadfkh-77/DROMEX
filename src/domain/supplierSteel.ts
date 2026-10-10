import type {QuarryPurchase} from './quarry';

/**
 * Steel on Supplier Loads. A category whose loads carry pieces (rebar in several diameters, each its own item) gets one
 * summary: every item's pieces and quantity, and one total per unit "all items together". The quantity of a steel
 * load is its weight, so the total of kg is the steel weight. A weight is only ever added to the same unit (kg to kg,
 * t to t) and pieces are only ever added to pieces; the two are never mixed. Cancelled loads never count.
 */
export type CategoryItemTotal={itemId:string;itemName:string;unitId:string;unitSymbol:string;quantity:number;pieces:number;loads:number};
export type CategoryUnitTotal={unitId:string;unitSymbol:string;quantity:number;loads:number};
export type CategorySummary={categoryName:string;items:CategoryItemTotal[];/** One per unit, never mixed. */totals:CategoryUnitTotal[];pieces:number;loadCount:number};

type Source=Pick<QuarryPurchase,'categoryName'|'itemId'|'itemName'|'unitId'|'unitSymbol'|'quantityCubicMetres'|'status'>&{pieces?:number|null};
const settle=(value:number)=>Number(value.toFixed(6));
const byText=(a:string,b:string)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true});

export function categorySummaries(purchases:readonly Source[]):CategorySummary[]{
  const active=purchases.filter(purchase=>purchase.status==='Active');
  const withPieces=new Set(active.filter(purchase=>purchase.pieces).map(purchase=>purchase.categoryName));
  const result:CategorySummary[]=[];
  for(const categoryName of withPieces){
    const items=new Map<string,CategoryItemTotal>(),units=new Map<string,CategoryUnitTotal>();let pieces=0,loadCount=0;
    for(const purchase of active.filter(value=>value.categoryName===categoryName)){
      const itemKey=`${purchase.itemId}|${purchase.unitId}`;
      const item=items.get(itemKey)??{itemId:purchase.itemId,itemName:purchase.itemName,unitId:purchase.unitId,unitSymbol:purchase.unitSymbol,quantity:0,pieces:0,loads:0};
      item.quantity=settle(item.quantity+purchase.quantityCubicMetres);item.pieces+=purchase.pieces??0;item.loads+=1;items.set(itemKey,item);
      const unit=units.get(purchase.unitId)??{unitId:purchase.unitId,unitSymbol:purchase.unitSymbol,quantity:0,loads:0};
      unit.quantity=settle(unit.quantity+purchase.quantityCubicMetres);unit.loads+=1;units.set(purchase.unitId,unit);
      pieces+=purchase.pieces??0;loadCount+=1;
    }
    result.push({categoryName,items:[...items.values()].sort((a,b)=>byText(a.itemName,b.itemName)||byText(a.unitSymbol,b.unitSymbol)),totals:[...units.values()].sort((a,b)=>byText(a.unitSymbol,b.unitSymbol)),pieces,loadCount});
  }
  return result.sort((a,b)=>byText(a.categoryName,b.categoryName));
}

/** "50 pcs" / "1 pc"; empty when no pieces were recorded. */
export const piecesText=(pieces:number|null|undefined)=>pieces?`${pieces} ${pieces===1?'pc':'pcs'}`:'';
