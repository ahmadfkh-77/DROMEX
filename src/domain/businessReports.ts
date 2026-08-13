export type BusinessReportKind='loads'|'customers'|'quarry'|'fuel'|'projects'|'analysis';
export type WorkbookCell=string|number|boolean|null;
export type WorkbookRow=Record<string,WorkbookCell>;
export type BusinessReportFilters={fromDate:string;toDate:string;projectId:string;customerId:string;supplierId:string;item:string;paymentStatus:string};
export const emptyBusinessReportFilters:BusinessReportFilters={fromDate:'',toDate:'',projectId:'',customerId:'',supplierId:'',item:'',paymentStatus:''};
export type BusinessReportData={
  generatedAt:string;
  companyName:string;
  loads:WorkbookRow[];
  customers:WorkbookRow[];
  payments:WorkbookRow[];
  openingBalances:WorkbookRow[];
  quarryPurchases:WorkbookRow[];
  suppliers:WorkbookRow[];
  fuelMovements:WorkbookRow[];
  equipmentTotals:WorkbookRow[];
  projects:WorkbookRow[];
  dailyReports:WorkbookRow[];
  materials:WorkbookRow[];
  activeFilters?:WorkbookRow[];
};

export const businessReportLabels:Record<BusinessReportKind,string>={loads:'Loads and Sales',customers:'Customer Balances and Payments',quarry:'Quarry Purchases and Supplier Balances',fuel:'Fuel Movements and Current Balance',projects:'Projects and Daily Work Reports',analysis:'Complete Analysis Workbook'};

const dateValue=(row:WorkbookRow)=>String(row['Confirmed At']??row['Payment Date']??row['As-of Date']??row['Work Date']??row['Created At']??'').slice(0,10);
const matchesDate=(row:WorkbookRow,filters:BusinessReportFilters)=>{const date=dateValue(row);return(!filters.fromDate||!date||date>=filters.fromDate)&&(!filters.toDate||!date||date<=filters.toDate)};
const matches=(value:WorkbookCell|undefined,selected:string)=>!selected||String(value??'')===selected;
export function activeBusinessFilterCount(filters:BusinessReportFilters){return Object.values(filters).filter(Boolean).length;}
export function filterBusinessReportData(data:BusinessReportData,filters:BusinessReportFilters):BusinessReportData{
  const loads=data.loads.filter(row=>matchesDate(row,filters)&&matches(row['Project ID'],filters.projectId)&&matches(row['Customer ID'],filters.customerId)&&matches(row.Item,filters.item)&&matches(row['Payment Status'],filters.paymentStatus));
  const quarryPurchases=data.quarryPurchases.filter(row=>matchesDate(row,filters)&&matches(row['Project ID'],filters.projectId)&&matches(row['Supplier ID'],filters.supplierId)&&matches(row.Item,filters.item)&&matches(row['Payment Status'],filters.paymentStatus));
  const fuelMovements=data.fuelMovements.filter(row=>matchesDate(row,filters)&&matches(row['Project ID'],filters.projectId)&&matches(row['Supplier ID'],filters.supplierId)&&matches(row['Payment Status'],filters.paymentStatus));
  const projects=data.projects.filter(row=>matches(row['Project ID'],filters.projectId)&&matches(row['Customer ID'],filters.customerId));
  const dailyReports=data.dailyReports.filter(row=>matchesDate(row,filters)&&matches(row['Project ID'],filters.projectId));
  const materials=data.materials.filter(row=>matchesDate(row,filters)&&matches(row['Project ID'],filters.projectId)&&matches(row.Item,filters.item));
  const openingBalances=data.openingBalances.filter(row=>matchesDate(row,filters)&&matches(row['Customer ID'],filters.customerId)&&matches(row['Supplier ID'],filters.supplierId)&&matches(row.Status,filters.paymentStatus));
  const selectedRecordIds=new Set<string>();
  for(const row of [...loads,...quarryPurchases,...fuelMovements,...openingBalances]){const id=String(row['Record ID']??row['Movement ID']??'');if(id)selectedRecordIds.add(id);}
  const payments=data.payments.filter(row=>selectedRecordIds.has(String(row['Target Record ID']??'')));
  const customerPayments=payments.filter(row=>row['Customer ID']);const customers=data.customers.filter(row=>matches(row['Customer ID'],filters.customerId)).map(row=>{const id=row['Customer ID'],customerLoads=loads.filter(value=>value['Customer ID']===id),customerOpenings=openingBalances.filter(value=>value['Customer ID']===id),billed=customerLoads.reduce((sum,value)=>sum+Number(value['Final Total USD']??0),0)+customerOpenings.reduce((sum,value)=>sum+Number(value['Original Amount USD']??0),0),paid=customerPayments.filter(value=>value['Customer ID']===id&&value.Status==='Active').reduce((sum,value)=>sum+Number(value['Amount USD']??0),0);return{...row,'Total Billed USD':billed,'Total Paid USD':paid,'Remaining USD':Math.max(0,billed-paid),'Overpaid USD':Math.max(0,paid-billed),'Unpaid Records':customerLoads.filter(value=>!['Paid','No Payment Due','Unpriced'].includes(String(value['Payment Status']))).length}}).filter(row=>!filters.paymentStatus||Number(row['Total Billed USD'])>0);
  const supplierPayments=payments.filter(row=>row['Supplier ID']);const suppliers=data.suppliers.filter(row=>matches(row['Supplier ID'],filters.supplierId)).map(row=>{const id=row['Supplier ID'],purchases=quarryPurchases.filter(value=>value['Supplier ID']===id&&value['Record Status']==='Active'),deliveries=fuelMovements.filter(value=>value['Supplier ID']===id&&value.Type==='delivery'&&value.Status==='Active'),billed=purchases.reduce((sum,value)=>sum+Number(value['Final Total USD']??0),0)+deliveries.reduce((sum,value)=>sum+Number(value['Final Total USD']??0),0),paid=supplierPayments.filter(value=>value['Supplier ID']===id&&value.Status==='Active').reduce((sum,value)=>sum+Number(value['Amount USD']??0),0);return{...row,'Total Billed USD':billed,'Total Paid USD':paid,'Remaining USD':Math.max(0,billed-paid),'Overpaid USD':Math.max(0,paid-billed)}}).filter(row=>!filters.paymentStatus||Number(row['Total Billed USD'])>0);
  const equipmentTotals=[...fuelMovements.reduce((totals,row)=>{if(row.Type!=='fill'||row.Status!=='Active')return totals;const key=String(row['Equipment ID']??row.Equipment??'Unassigned'),current=totals.get(key)??{'Equipment ID':row['Equipment ID']??null,'Equipment':row.Equipment??null,'Total Litres Filled':0,'Fill Count':0};current['Total Litres Filled']=Number(current['Total Litres Filled'])+Number(row['Litres Out']??0);current['Fill Count']=Number(current['Fill Count'])+1;totals.set(key,current);return totals;},new Map<string,WorkbookRow>()).values()];
  const projectName=String(data.projects.find(row=>row['Project ID']===filters.projectId)?.Project??filters.projectId);
  const customerName=String(data.customers.find(row=>row['Customer ID']===filters.customerId)?.Customer??filters.customerId);
  const supplierName=String(data.suppliers.find(row=>row['Supplier ID']===filters.supplierId)?.Supplier??filters.supplierId);
  const activeFilters:WorkbookRow[]=[
    {'Filter':'Date range','Value':filters.fromDate||filters.toDate?`${filters.fromDate||'Beginning'} to ${filters.toDate||'Today'}`:'All dates'},
    {'Filter':'Project','Value':filters.projectId?projectName:'All projects'},
    {'Filter':'Customer','Value':filters.customerId?customerName:'All customers'},
    {'Filter':'Supplier','Value':filters.supplierId?supplierName:'All suppliers'},
    {'Filter':'Item','Value':filters.item||'All items'},
    {'Filter':'Payment status','Value':filters.paymentStatus||'All payment statuses'},
  ];
  return{...data,loads,quarryPurchases,fuelMovements,equipmentTotals,projects,dailyReports,materials,payments,openingBalances,customers,suppliers,activeFilters};
}
