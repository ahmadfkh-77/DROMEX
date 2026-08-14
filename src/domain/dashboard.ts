import type {BusinessReportData,WorkbookRow} from './businessReports';

export type DashboardPeriod='today'|'7days'|'30days'|'custom';
export type DashboardRange={fromDate:string;toDate:string;label:string};
export type DashboardProjectSummary={id:string;name:string;loadCount:number;netTonnes:number;missingReportCount:number};
export type DashboardBalanceSummary={id:string;name:string;partyType:'customer'|'supplier';remainingUsd:number;recordCount:number};
export type DashboardSnapshot={
  range:DashboardRange;
  production:{loadCount:number;netTonnes:number;unpricedLoadCount:number;activeProjectCount:number;fuelBalanceLitres:number;fuelUsedLitres:number;quarryCubicMetres:number;missingReportCount:number;projects:DashboardProjectSummary[]};
  financial:{salesUsd:number;receivedUsd:number;receivableUsd:number;payableUsd:number;attentionCount:number;largestBalances:DashboardBalanceSummary[]};
};

const text=(value:unknown)=>String(value??'');
const numeric=(value:unknown)=>{const parsed=Number(value??0);return Number.isFinite(parsed)?parsed:0;};
const rowDate=(row:WorkbookRow)=>text(row['Confirmed At']??row['Payment Date']??row['As-of Date']??row['Work Date']).slice(0,10);
const inRange=(row:WorkbookRow,range:DashboardRange)=>{const date=rowDate(row);return Boolean(date)&&(!range.fromDate||date>=range.fromDate)&&(!range.toDate||date<=range.toDate);};
const active=(row:WorkbookRow)=>text(row.Status??row['Record Status']??'Active')==='Active';
const daysBefore=(date:string,days:number)=>{const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()-days);return value.toISOString().slice(0,10);};

export function resolveDashboardRange(period:DashboardPeriod,today:string,customFrom='',customTo=''):DashboardRange{
  if(period==='today')return{fromDate:today,toDate:today,label:'Today'};
  if(period==='7days')return{fromDate:daysBefore(today,6),toDate:today,label:'Last 7 days'};
  if(period==='30days')return{fromDate:daysBefore(today,29),toDate:today,label:'Last 30 days'};
  if(!customFrom&&!customTo)return{fromDate:'',toDate:'',label:'All dates'};
  if(!customFrom)return{fromDate:'',toDate:customTo,label:`Through ${customTo}`};
  if(!customTo)return{fromDate:customFrom,toDate:'',label:`${customFrom} onward`};
  return{fromDate:customFrom,toDate:customTo,label:`${customFrom} to ${customTo}`};
}

export function buildDashboardSnapshot(data:BusinessReportData,range:DashboardRange):DashboardSnapshot{
  const loads=data.loads.filter(row=>inRange(row,range));
  const activeProjects=data.projects.filter(row=>text(row.Status).toLowerCase()==='active');
  const activeProjectIds=new Set(activeProjects.map(row=>text(row['Project ID'])).filter(Boolean));
  const reports=data.dailyReports.filter(row=>inRange(row,range));
  const reportKeys=new Set(reports.map(row=>`${text(row['Project ID'])}|${rowDate(row)}`));
  const requiredReportKeys=new Set(loads.map(row=>({projectId:text(row['Project ID']),date:rowDate(row)})).filter(value=>value.projectId&&value.date&&activeProjectIds.has(value.projectId)).map(value=>`${value.projectId}|${value.date}`));
  const missingReportKeys=[...requiredReportKeys].filter(key=>!reportKeys.has(key));
  const quarry=data.quarryPurchases.filter(row=>active(row)&&inRange(row,range));
  const fuelInPeriod=data.fuelMovements.filter(row=>active(row)&&inRange(row,range));
  const currentFuel=[...data.fuelMovements].reverse().find(row=>active(row));
  const projects=activeProjects.map((project):DashboardProjectSummary=>{
    const id=text(project['Project ID']),ownLoads=loads.filter(row=>text(row['Project ID'])===id);
    return{id,name:text(project.Project)||'Unnamed project',loadCount:ownLoads.length,netTonnes:ownLoads.reduce((sum,row)=>sum+numeric(row['Net Weight kg']),0)/1000,missingReportCount:missingReportKeys.filter(key=>key.startsWith(`${id}|`)).length};
  }).filter(project=>project.loadCount>0||project.missingReportCount>0).sort((a,b)=>b.netTonnes-a.netTonnes||a.name.localeCompare(b.name));

  const paymentByTarget=new Map<string,number>();
  for(const payment of data.payments)if(text(payment.Status)==='Active'){const targetId=text(payment['Target Record ID']);paymentByTarget.set(targetId,(paymentByTarget.get(targetId)??0)+numeric(payment['Amount USD']));}
  const balanceGroups=new Map<string,DashboardBalanceSummary>();
  const addBalance=(partyType:'customer'|'supplier',id:string,name:string,remaining:number)=>{if(!id||remaining<=0)return;const key=`${partyType}|${id}`,current=balanceGroups.get(key)??{id,name:name||'Unnamed',partyType,remainingUsd:0,recordCount:0};current.remainingUsd+=remaining;current.recordCount++;balanceGroups.set(key,current);};
  for(const row of loads){const remaining=numeric(row['Remaining USD']);addBalance('customer',text(row['Customer ID']),text(row.Customer),remaining);}
  const openings=data.openingBalances.filter(row=>inRange(row,range));
  for(const row of openings){const remaining=Math.max(0,numeric(row['Original Amount USD'])-(paymentByTarget.get(text(row['Record ID']))??0));const supplier=text(row['Party Type'])==='supplier';addBalance(supplier?'supplier':'customer',text(row[supplier?'Supplier ID':'Customer ID']),text(row.Party),remaining);}
  for(const row of quarry)addBalance('supplier',text(row['Supplier ID']),text(row.Supplier),numeric(row['Remaining USD']));
  const fuelDeliveries=fuelInPeriod.filter(row=>text(row.Type)==='delivery');
  for(const row of fuelDeliveries){const remaining=Math.max(0,numeric(row['Final Total USD'])-numeric(row['Paid USD']));addBalance('supplier',text(row['Supplier ID']),text(row.Supplier),remaining);}
  const balances=[...balanceGroups.values()];
  const receivableUsd=balances.filter(value=>value.partyType==='customer').reduce((sum,value)=>sum+value.remainingUsd,0);
  const payableUsd=balances.filter(value=>value.partyType==='supplier').reduce((sum,value)=>sum+value.remainingUsd,0);
  const receivedUsd=data.payments.filter(row=>text(row.Status)==='Active'&&Boolean(row['Customer ID'])&&inRange(row,range)).reduce((sum,row)=>sum+numeric(row['Amount USD']),0);

  return{
    range,
    production:{loadCount:loads.length,netTonnes:loads.reduce((sum,row)=>sum+numeric(row['Net Weight kg']),0)/1000,unpricedLoadCount:loads.filter(row=>text(row['Payment Status'])==='Unpriced').length,activeProjectCount:activeProjects.length,fuelBalanceLitres:numeric(currentFuel?.['Balance After Litres']),fuelUsedLitres:fuelInPeriod.filter(row=>text(row.Type)==='fill').reduce((sum,row)=>sum+numeric(row['Litres Out']),0),quarryCubicMetres:quarry.reduce((sum,row)=>sum+numeric(row['Quantity m3']),0),missingReportCount:missingReportKeys.length,projects:projects.slice(0,3)},
    financial:{salesUsd:loads.reduce((sum,row)=>sum+numeric(row['Final Total USD']),0),receivedUsd,receivableUsd,payableUsd,attentionCount:balances.reduce((sum,value)=>sum+value.recordCount,0),largestBalances:balances.sort((a,b)=>b.remainingUsd-a.remainingUsd||a.name.localeCompare(b.name)).slice(0,3)},
  };
}
