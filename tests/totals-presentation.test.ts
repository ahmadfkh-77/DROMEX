import {describe,expect,it} from 'vitest';

import type {RecordSnapshot} from '../src/domain/businessDocuments';
import {formatCents,formatRecordedAt,inclusionTone,recordMoneyLine,recordReferences,recordTitle,recordedValueLine,unitFigures} from '../src/ui/totalsPresentation';

/** DEC-487. Wording every totals and document screen shares; screens add nothing up themselves. */
const snap=(overrides:Partial<RecordSnapshot>):RecordSnapshot=>({recordType:'company_load',recordId:'l1',reference:'20260810-AB12-00007',loadNumber:'ASP-2026-004',loadNumberSeriesName:'Asphalt',itemKey:'id:a',itemName:'Asphalt',unitKey:'unit_ton',unitSymbol:'t',quantity:12.5,projectId:'p',projectName:'Mountain Road',partyId:'c',partyName:'Road Co',recordedAt:'2026-08-10T06:05:00.000Z',enteredAt:null,unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null,...overrides});

describe('record wording',()=>{
  it('titles a company load by its load number, a legacy load honestly, and a Supplier Load by its number',()=>{
    expect(recordTitle(snap({}))).toBe('ASP-2026-004');
    expect(recordTitle(snap({loadNumber:null}))).toBe('Legacy load — no generated load number');
    expect(recordTitle(snap({recordType:'supplier_load',loadNumber:null,reference:'QP-0042'}))).toBe('QP-0042');
  });
  it('lists the other references separately from the load number',()=>{
    expect(recordReferences(snap({}))).toBe('Transaction 20260810-AB12-00007 · Asphalt series');
    expect(recordReferences(snap({recordType:'supplier_load',loadNumber:null,loadNumberSeriesName:null,reference:'QP-0042',supplierReference:'T-88'}))).toBe('Supplier ticket T-88');
    expect(recordReferences(snap({recordType:'supplier_load',loadNumber:null,loadNumberSeriesName:null,reference:'QP-0042'}))).toBe('No supplier ticket recorded');
  });
  it('shows money only where recorded and never prints $0.00 for a missing price',()=>{
    expect(recordMoneyLine(snap({}))).toBe('No price recorded');
    expect(recordMoneyLine(snap({unitPriceCents:1500,subtotalCents:18750,vatRateBasisPoints:1100,vatCents:2063,totalCents:20813}))).toBe('$15.00 per t · Total $208.13 incl. VAT 11%');
    expect(recordMoneyLine(snap({priceBasis:'whole',unitPriceCents:50000,subtotalCents:50000,vatRateBasisPoints:0,vatCents:0,totalCents:50000}))).toBe('$500.00 for the whole delivery · Total $500.00');
  });
  it('formats cents with separators',()=>{
    expect(formatCents(123456789)).toBe('$1,234,567.89');
    expect(formatCents(null)).toBe('Not recorded');
  });
  it('states recorded value with the unpriced count',()=>{
    expect(recordedValueLine({totalCents:8000,pricedCount:1,unpricedCount:5})).toBe('Recorded value $80.00 · 5 records unpriced');
    expect(recordedValueLine({totalCents:null,pricedCount:0,unpricedCount:3})).toBe('No prices recorded');
    expect(recordedValueLine({totalCents:2500,pricedCount:2,unpricedCount:0})).toBe('Recorded value $25.00');
  });
  it('formats a record date and time without depending on the phone locale',()=>{
    expect(formatRecordedAt('2026-08-10T09:05:00')).toBe('10 Aug 2026 · 09:05');
  });
});

describe('unit figures',()=>{
  it('keeps every unit on its own line with Not recorded where a measure is missing',()=>{
    expect(unitFigures([{unitKey:'m3',unitSymbol:'m³',delivered:{quantity:12,recordCount:2},used:{quantity:9,recordCount:1},transported:null},{unitKey:'t',unitSymbol:'t',delivered:{quantity:16,recordCount:2},used:null,transported:null}],'all'))
      .toEqual([{unitKey:'m3',unitSymbol:'m³',delivered:'12 m³',used:'9 m³'},{unitKey:'t',unitSymbol:'t',delivered:'16 t',used:'Not recorded'}]);
    expect(unitFigures([{unitKey:'t',unitSymbol:'t',delivered:{quantity:16,recordCount:2},used:null,transported:null}],'delivered')).toEqual([{unitKey:'t',unitSymbol:'t',delivered:'16 t',used:null}]);
  });
});

describe('status tones',()=>{
  it('maps each inclusion state to a tone that is always paired with words',()=>{
    expect(inclusionTone({state:'not_included'})).toBe('open');
    expect(inclusionTone({state:'in_draft',drafts:[]})).toBe('draft');
    expect(inclusionTone({state:'previously_cancelled',document:{documentId:'d',kind:'customer_invoice',status:'Cancelled',draftNumber:'DRAFT-1',documentNumber:'INV-1',issueDate:null}})).toBe('history');
  });
});
