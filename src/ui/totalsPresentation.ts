import type {InclusionState} from '../domain/businessDocuments';
import type {RecordedValue,TotalsView,UnitMeasures} from '../domain/companyTotals';
import {formatTotalQuantity} from '../domain/projectTotals';
import {formatCents} from '../domain/recordFormat';
export {formatCents,formatDay,formatRecordedAt,recordMoneyLine,recordReferences,recordTitle} from '../domain/recordFormat';

/**
 * DEC-500. The wording shared by Company Totals, Project Totals, Company Load Totals and documents.
 * Pure formatting only: every figure arrives already calculated by the domain.
 */
export function recordedValueLine(value:RecordedValue):string{
  if(value.totalCents==null)return 'No prices recorded';
  return `Recorded value ${formatCents(value.totalCents)}${value.unpricedCount?` · ${value.unpricedCount} record${value.unpricedCount===1?'':'s'} unpriced`:''}`;
}

export type UnitFigureRow={unitKey:string;unitSymbol:string;delivered:string|null;used:string|null};
/** One line per unit; a column hidden by the view is null, a missing measure reads "Not recorded". */
export function unitFigures(units:readonly UnitMeasures[],view:TotalsView,usageHidden=false):UnitFigureRow[]{
  return units.map(unit=>({unitKey:unit.unitKey,unitSymbol:unit.unitSymbol,
    delivered:view==='used'?null:unit.delivered?formatTotalQuantity(unit.delivered.quantity,unit.unitSymbol):'Not recorded',
    used:view==='delivered'||usageHidden?null:unit.used?formatTotalQuantity(unit.used.quantity,unit.unitSymbol):'Not recorded'}));
}

export type InclusionTone='open'|'draft'|'included'|'history';
export function inclusionTone(state:InclusionState):InclusionTone{
  return state.state==='included'?'included':state.state==='in_draft'?'draft':state.state==='previously_cancelled'?'history':'open';
}
