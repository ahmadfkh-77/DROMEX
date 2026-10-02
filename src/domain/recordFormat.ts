import type {BusinessDocument,RecordSnapshot} from './businessDocuments';
import {loadNumberLabel} from './loadNumberSeries';

/**
 * DEC-487. How a record and its money are written, shared by screens, PDFs and workbooks so every
 * view uses the same words. Pure formatting: nothing here calculates a total.
 */
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const two=(value:number)=>String(value).padStart(2,'0');

export function formatCents(cents:number|null):string{
  if(cents==null)return 'Not recorded';
  const [whole='0',fraction='00']=(Math.abs(cents)/100).toFixed(2).split('.');
  return `${cents<0?'-':''}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${fraction}`;
}

/** "10 Aug 2026 · 09:05" in the phone's own time zone, without depending on its locale settings. */
export function formatRecordedAt(value:string):string{
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return value;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()} · ${two(date.getHours())}:${two(date.getMinutes())}`;
}
/** "10 Aug 2026" for a YYYY-MM-DD calendar date. */
export function formatDay(value:string|null|undefined):string{
  if(!value)return 'Not set';
  const [year,month,day]=value.split('-').map(Number);
  return year&&month&&day?`${day} ${MONTHS[month-1]} ${year}`:value;
}

/** A company load is known by its load number (or honestly as a legacy load); a Supplier Load by its own number. */
export function recordTitle(record:RecordSnapshot):string{
  return record.recordType==='company_load'?loadNumberLabel(record.loadNumber):record.reference;
}

/** The references other than the title, kept visibly apart from the load number. */
export function recordReferences(record:RecordSnapshot):string{
  if(record.recordType==='company_load')return [`Transaction ${record.reference}`,record.loadNumberSeriesName?`${record.loadNumberSeriesName} series`:null].filter(Boolean).join(' · ');
  return record.supplierReference?`Supplier ticket ${record.supplierReference}`:'No supplier ticket recorded';
}

/** Price and total exactly as recorded on the record; a missing price is never shown as zero. */
export function recordMoneyLine(record:RecordSnapshot):string{
  if(record.unitPriceCents==null)return 'No price recorded';
  const price=record.priceBasis==='whole'?`${formatCents(record.unitPriceCents)} for the whole delivery`:`${formatCents(record.unitPriceCents)} per ${record.unitSymbol}`;
  const vat=record.vatRateBasisPoints?` incl. VAT ${record.vatRateBasisPoints/100}%`:'';
  return record.totalCents==null?price:`${price} · Total ${formatCents(record.totalCents)}${vat}`;
}

/** A name safe on Android, iOS and Windows: no / \ : * ? " < > | or control characters; Arabic and other scripts kept. */
export function safeFileNamePart(value:string|null|undefined,max=60):string{
  const cleaned=(value??'').replace(/[\/:*?"<>|\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim();
  if(cleaned.length<=max)return cleaned;
  const cut=cleaned.slice(0,max);const space=cut.lastIndexOf(' ');
  return (space>max*.6?cut.slice(0,space):cut).trim();
}

const monthOf=(day:string)=>{const [year,month]=day.split('-').map(Number);return year&&month?{year,month,label:`${MONTHS[month-1]} ${year}`}:null;};
/** "Aug 2026", "Jul-Aug 2026", "Dec 2025-Jan 2026", "From Aug 2026" or "Until Aug 2026". */
export function periodFileLabel(fromDate:string|null|undefined,toDate:string|null|undefined):string|null{
  const from=fromDate?monthOf(fromDate):null,to=toDate?monthOf(toDate):null;
  if(from&&to){
    if(from.year===to.year&&from.month===to.month)return from.label;
    return from.year===to.year?`${MONTHS[from.month-1]}-${to.label}`:`${from.label}-${to.label}`;
  }
  if(from)return `From ${from.label}`;
  if(to)return `Until ${to.label}`;
  return null;
}

const localDay=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value.slice(0,10):`${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}`;};

/**
 * DEC-487. "INV-2026-014 - Road Co - Mountain Road - Aug 2026.pdf": number first so files sort in
 * order, then the party, the one project (or "N projects"), and the period (or the records' own months).
 * A draft is named by its draft number; a cancelled document says CANCELLED.
 */
export function documentFileName(doc:Pick<BusinessDocument,'documentNumber'|'draftNumber'|'partyName'|'periodFrom'|'periodTo'|'status'|'records'>):string{
  const projects=[...new Set(doc.records.map(record=>record.snapshot.projectName).filter((name):name is string=>Boolean(name)))];
  const days=doc.records.map(record=>localDay(record.snapshot.recordedAt)).sort();
  const period=periodFileLabel(doc.periodFrom,doc.periodTo)??(days.length?periodFileLabel(days[0],days[days.length-1]):null);
  const parts=[safeFileNamePart(doc.documentNumber??doc.draftNumber,40),safeFileNamePart(doc.partyName,50),
    projects.length===1?safeFileNamePart(projects[0],45):projects.length>1?`${projects.length} projects`:'',period??'',doc.status==='Cancelled'?'CANCELLED':''];
  return `${parts.filter(Boolean).join(' - ')}.pdf`;
}

/** "Company Load Totals - Mountain Road - Aug 2026.pdf"; "All dates" when no dates are filtered. */
export function companyLoadTotalsFileName(input:{projectName:string|null;fromDate:string;toDate:string}):string{
  return `${['Company Load Totals',safeFileNamePart(input.projectName,45),periodFileLabel(input.fromDate,input.toDate)??'All dates'].filter(Boolean).join(' - ')}.pdf`;
}
