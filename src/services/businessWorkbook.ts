import { strToU8, zipSync } from 'fflate';

import {
  businessReportLabels,
  type BusinessReportData,
  type BusinessReportKind,
  type WorkbookCell,
  type WorkbookRow,
} from '../domain/businessReports';

export type WorkbookLocale = 'en' | 'ar';
export type ChartSpec = {
  title: string;
  categoryKey: string;
  valueKeys: string[];
  direction?: 'bar' | 'column';
};
export type EmbeddedWorkbookImage = {
  name: string;
  bytes: Uint8Array;
  extension: 'png' | 'jpeg';
  row: number;
  column?: number;
};
export type SheetSpec = {
  name: string;
  rows: WorkbookRow[];
  charts?: ChartSpec[];
  images?: EmbeddedWorkbookImage[];
  rtl?: boolean;
};
export type WorkbookProgress = {
  stage: 'preparing' | 'building' | 'compressing' | 'encoding';
  completed: number;
  total: number;
  percent: number;
  message: string;
};
export type WorkbookBuildOptions = {
  signal?: AbortSignal;
  locale?: WorkbookLocale;
  onProgress?: (progress: WorkbookProgress) => void;
};

const ARABIC_REPORT_LABELS: Record<BusinessReportKind, string> = {
  loads: 'الأحمال والمبيعات',
  customers: 'أرصدة العملاء والمدفوعات',
  quarry: 'أحمال الموردين وأرصدة الموردين',
  fuel: 'حركات الوقود والرصيد الحالي',
  projects: 'المشاريع وتقارير العمل اليومية',
  analysis: 'مصنف التحليل الكامل',
};

const ARABIC_LABELS: Record<string, string> = {
  'Report Overview': 'نظرة عامة على التقرير', Summary: 'الملخص', 'Loads and Sales': 'الأحمال والمبيعات',
  'Payment Details': 'تفاصيل المدفوعات', 'Customer Summary': 'ملخص العملاء', 'Opening Balances': 'الأرصدة الافتتاحية',
  'Supplier Summary': 'ملخص الموردين', 'Purchase Details': 'تفاصيل المشتريات', 'Balance Summary': 'ملخص الرصيد',
  'Movement Details': 'تفاصيل الحركات', 'Equipment Totals': 'إجماليات المعدات', 'Project Summary': 'ملخص المشاريع',
  'Project Loads': 'أحمال المشاريع', 'Supplier Loads': 'أحمال الموردين', 'Fuel Movements': 'حركات الوقود',
  'Daily Report Index': 'فهرس التقارير اليومية', 'Materials Summary': 'ملخص المواد', 'Executive Summary': 'الملخص التنفيذي',
  Payments: 'المدفوعات', 'Daily Reports': 'التقارير اليومية', 'Data Dictionary': 'قاموس البيانات', Charts: 'الرسوم البيانية',
  'Financial Charts': 'الرسوم المالية', 'Operations Charts': 'الرسوم التشغيلية', Photos: 'الصور',
  'Work Details': 'تفاصيل العمل', Presence: 'الحضور والمعدات', Materials: 'المواد', 'Linked Loads': 'الأحمال المرتبطة', 'Waste Dumps': 'نقل النفايات',
  'Report information': 'معلومات التقرير', Details: 'التفاصيل', 'Report title': 'عنوان التقرير', Company: 'الشركة',
  'Daily Project Report': 'تقرير المشروع اليومي', 'Report ID': 'معرف التقرير', Section: 'القسم', Entries: 'المدخلات',
  'Generated on': 'تاريخ الإنشاء', 'Export contents': 'محتوى التصدير', Filter: 'عامل التصفية', Scope: 'النطاق', Value: 'القيمة',
  Metric: 'المؤشر', 'Generated at': 'وقت الإنشاء', 'Confirmed loads': 'الأحمال المؤكدة', 'Load sales USD': 'مبيعات الأحمال بالدولار',
  'Customer receivable USD': 'ذمم العملاء بالدولار', 'Supplier loads': 'أحمال الموردين', 'Supplier payable USD': 'ذمم الموردين بالدولار',
  'Current fuel litres': 'رصيد الوقود بالليتر', Projects: 'المشاريع', 'Daily reports': 'التقارير اليومية',
  Item: 'المادة', Customer: 'العميل', Supplier: 'المورد', Project: 'المشروع', Equipment: 'المعدة', Category: 'الفئة',
  'Sales USD': 'المبيعات بالدولار', 'Purchase USD': 'المشتريات بالدولار', 'Billed USD': 'المفوتر بالدولار',
  'Paid USD': 'المدفوع بالدولار', 'Remaining USD': 'المتبقي بالدولار', Litres: 'الليترات', Count: 'العدد',
  'Daily Report Count': 'عدد التقارير اليومية', 'Total Litres Filled': 'إجمالي الليترات المعبأة', 'Fill Count': 'عدد التعبئات',
  'Record ID': 'معرف السجل', 'Transaction Number': 'رقم العملية', 'Confirmed At': 'وقت التأكيد', 'Customer ID': 'معرف العميل',
  'Project ID': 'معرف المشروع', Destination: 'الوجهة', 'Item ID': 'معرف المادة', 'Item Code': 'رمز المادة', Driver: 'السائق',
  'Truck Plate': 'لوحة الشاحنة', 'Net Weight kg': 'الوزن الصافي كغ', 'Billed Quantity': 'الكمية المفوترة', Unit: 'الوحدة',
  'Unit Price USD': 'سعر الوحدة بالدولار', 'Subtotal USD': 'المجموع قبل الضريبة بالدولار', 'VAT Rate %': 'نسبة الضريبة %',
  'VAT USD': 'الضريبة بالدولار', 'Final Total USD': 'الإجمالي النهائي بالدولار', 'Overpaid USD': 'المدفوع الزائد بالدولار',
  'Payment Status': 'حالة الدفع', 'Signature Status': 'حالة التوقيع', 'Payment ID': 'معرف الدفعة',
  'Target Record ID': 'معرف السجل المرتبط', 'Target Type': 'نوع السجل المرتبط', 'Target Reference': 'مرجع السجل المرتبط',
  Party: 'الطرف', 'Amount USD': 'المبلغ بالدولار', 'Payment Date': 'تاريخ الدفع', Status: 'الحالة',
  'Target Payment Status': 'حالة دفع السجل', 'Cancellation Reason': 'سبب الإلغاء', 'Cancelled At': 'وقت الإلغاء',
  'Created At': 'وقت الإنشاء', 'Updated At': 'وقت التحديث', Type: 'النوع', Active: 'نشط', Phone: 'الهاتف', Email: 'البريد الإلكتروني',
  'Total Billed USD': 'إجمالي المفوتر بالدولار', 'Total Paid USD': 'إجمالي المدفوع بالدولار', 'Unpaid Records': 'السجلات غير المدفوعة',
  'Purchase Number': 'رقم الشراء', 'Ticket / Invoice': 'التذكرة / الفاتورة', 'Quantity m3': 'الكمية م³', 'Record Status': 'حالة السجل',
  'Photo Count': 'عدد الصور', 'Supplier ID': 'معرف المورد', 'Latest Purchase': 'آخر شراء', 'Movement ID': 'معرف الحركة',
  'Equipment ID': 'معرف المعدة', Ticket: 'التذكرة', 'Litres In': 'الليترات الداخلة', 'Litres Out': 'الليترات الخارجة',
  'Gauge Litres': 'قراءة الخزان بالليتر', 'Correction Difference': 'فرق التصحيح', 'Balance After Litres': 'الرصيد بعد الحركة بالليتر',
  'Price / Litre USD': 'سعر الليتر بالدولار', Notes: 'ملاحظات', Location: 'الموقع', 'Start Date': 'تاريخ البداية',
  'End Date': 'تاريخ النهاية', 'Latest Work Date': 'آخر تاريخ عمل', 'Work Date': 'تاريخ العمل', 'Work Description': 'وصف العمل',
  Workers: 'العمال', Drivers: 'السائقون', 'Truck Plates': 'لوحات الشاحنات', Machines: 'الآليات',
  'Problems / Delays / Incidents': 'المشاكل / التأخير / الحوادث', 'Weather / Site Conditions': 'الطقس / ظروف الموقع',
  'Work Start': 'بداية العمل', 'Work End': 'نهاية العمل', 'Break Minutes': 'دقائق الاستراحة', 'Net Work Minutes': 'صافي دقائق العمل',
  'Next Work Planned': 'العمل التالي المخطط', 'Used Quantity': 'الكمية المستخدمة', 'Transported Quantity': 'الكمية المنقولة',
  'Material ID': 'معرف المادة', Movement: 'الحركة', Quantity: 'الكمية', 'Unit ID': 'معرف الوحدة', 'Dumped At': 'وقت النقل', Material: 'المادة',
  'Opening Balance ID': 'معرف الرصيد الافتتاحي', 'Party Type': 'نوع الطرف', 'Original Amount USD': 'المبلغ الأصلي بالدولار',
  'As-of Date': 'التاريخ المرجعي', Reference: 'المرجع', 'Own Company': 'الشركة المالكة', 'Latest Payment': 'آخر دفعة',
  Reason: 'السبب', 'Previous Balance Litres': 'الرصيد السابق بالليتر', 'Difference Litres': 'الفرق بالليتر', Odometer: 'عداد المسافة',
  'Load sales by item (USD)': 'مبيعات الأحمال حسب المادة (دولار)', 'Customer balances (USD)': 'أرصدة العملاء (دولار)',
  'Supplier load value by supplier (USD)': 'قيمة أحمال الموردين حسب المورد (دولار)',
  'Delivered versus equipment-filled fuel (L)': 'الوقود المورد مقابل المعبأ للمعدات (ليتر)',
  'Daily reports by project': 'التقارير اليومية حسب المشروع', 'Financial overview (USD)': 'نظرة مالية عامة (دولار)',
  'Operational record counts': 'أعداد السجلات التشغيلية',
  Sheet: 'ورقة', Purpose: 'الغرض', Photo: 'الصورة', 'File name': 'اسم الملف', 'Work performed': 'العمل المنفذ',
};

const ARABIC_VALUES: Record<string, string> = {
  'Only records matching the scope below are included.': 'تم تضمين السجلات المطابقة للنطاق أدناه فقط.',
  'All records': 'كل السجلات', 'All dates': 'كل التواريخ', 'All projects': 'كل المشاريع', 'All customers': 'كل العملاء',
  'All suppliers': 'كل الموردين', 'All items': 'كل المواد', 'All payment statuses': 'كل حالات الدفع', Beginning: 'البداية', Today: 'اليوم',
  Active: 'نشط', Cancelled: 'ملغى', Paid: 'مدفوع', Unpaid: 'غير مدفوع', 'Partially Paid': 'مدفوع جزئياً',
  Overpaid: 'مدفوع بزيادة', Unpriced: 'غير مسعّر', 'No Payment Due': 'لا دفعة مستحقة', delivery: 'توريد', fill: 'تعبئة', gauge: 'قراءة خزان',
  Workers: 'العمال', Drivers: 'السائقون', 'Truck Plates': 'لوحات الشاحنات', Machines: 'الآليات', used: 'مستخدمة', transported: 'منقولة',
  'Customer receivable': 'ذمم العملاء', 'Supplier payable': 'ذمم الموردين', 'Load sales': 'مبيعات الأحمال',
  'Supplier loads': 'أحمال الموردين', Loads: 'الأحمال', 'Fuel movements': 'حركات الوقود', 'Daily reports': 'التقارير اليومية',
  Delivered: 'الوقود المورد', 'Equipment fills': 'تعبئة المعدات',
};

const abortError = () => { const error = new Error('Workbook export cancelled.'); error.name = 'AbortError'; return error; };
const checkCancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw abortError(); };
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const progress = (options: WorkbookBuildOptions, stage: WorkbookProgress['stage'], completed: number, total: number, percent: number, message: string) => options.onProgress?.({ stage, completed, total, percent, message });
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] ?? char));
const columnName = (index: number) => { let name = ''; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name; return name; };
const money = (rows: WorkbookRow[], key: string) => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);

const summary = (data: BusinessReportData): WorkbookRow[] => [
  { Metric: 'Generated at', Value: data.generatedAt }, { Metric: 'Company', Value: data.companyName },
  { Metric: 'Confirmed loads', Value: data.loads.length }, { Metric: 'Load sales USD', Value: money(data.loads, 'Final Total USD') },
  { Metric: 'Customer receivable USD', Value: money(data.customers, 'Remaining USD') }, { Metric: 'Supplier loads', Value: data.quarryPurchases.length },
  { Metric: 'Supplier payable USD', Value: money(data.suppliers, 'Remaining USD') }, { Metric: 'Current fuel litres', Value: data.fuelMovements.at(-1)?.['Balance After Litres'] ?? 0 },
  { Metric: 'Projects', Value: data.projects.length }, { Metric: 'Daily reports', Value: data.dailyReports.length },
];

const dictionary: WorkbookRow[] = [
  { Sheet: 'Loads and Sales', Purpose: 'One row per confirmed outgoing load; amounts and quantities are numeric.' },
  { Sheet: 'Customer Summary', Purpose: 'One row per customer with billed, paid, remaining, and overpaid totals.' },
  { Sheet: 'Payments', Purpose: 'One row per payment event, including retained cancelled events.' },
  { Sheet: 'Opening Balances', Purpose: 'Carried-forward receivable and payable records from paper history.' },
  { Sheet: 'Supplier Loads', Purpose: 'One row per external supplier load, including cancelled record status.' },
  { Sheet: 'Supplier Summary', Purpose: 'One row per supplier across quarry and priced fuel delivery balances.' },
  { Sheet: 'Fuel Movements', Purpose: 'Chronological single-tank gauge, delivery, and equipment-fill ledger.' },
  { Sheet: 'Equipment Totals', Purpose: 'Active equipment-fill litres grouped by saved equipment.' },
  { Sheet: 'Project Summary', Purpose: 'One row per project with identity, status, dates, and report count.' },
  { Sheet: 'Daily Reports', Purpose: 'One row per project workday with full searchable operational text.' },
  { Sheet: 'Materials Summary', Purpose: 'Daily-report material quantities grouped by project, item, unit, and movement.' },
  { Sheet: 'Charts', Purpose: 'Visible chart-source tables calculated from the filtered workbook records.' },
];

function groupedRows(rows: WorkbookRow[], categoryKey: string, sourceKeys: string[], outputKeys: string[], limit = 10): WorkbookRow[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const category = String(row[categoryKey] ?? 'Unassigned').trim() || 'Unassigned';
    const values = groups.get(category) ?? sourceKeys.map(() => 0);
    sourceKeys.forEach((key, index) => { values[index] = (values[index] ?? 0) + Number(row[key] ?? 0); });
    groups.set(category, values);
  }
  const result = [...groups].map(([category, values]) => outputKeys.reduce<WorkbookRow>((entry, key, index) => { entry[key] = values[index] ?? 0; return entry; }, { [categoryKey]: category }));
  result.sort((a, b) => Number(b[outputKeys[0]!] ?? 0) - Number(a[outputKeys[0]!] ?? 0));
  return result.slice(0, limit).length ? result.slice(0, limit) : [{ [categoryKey]: 'No matching records', [outputKeys[0]!]: 0 }];
}

function chartSheet(name: string, rows: WorkbookRow[], title: string, categoryKey: string, valueKeys: string[], direction: ChartSpec['direction'] = 'column'): SheetSpec {
  return { name, rows, charts: [{ title, categoryKey, valueKeys, direction }] };
}

function englishSheetsForBusinessReport(kind: BusinessReportKind, data: BusinessReportData): SheetSpec[] {
  const payments = (types: string[]) => data.payments.filter((row) => types.includes(String(row['Target Type'])));
  const overview: SheetSpec = { name: 'Report Overview', rows: [
    { 'Report information': 'Report title', Details: businessReportLabels[kind] },
    { 'Report information': 'Company', Details: data.companyName },
    { 'Report information': 'Generated on', Details: data.generatedAt },
    { 'Report information': 'Export contents', Details: 'Only records matching the scope below are included.' },
    ...(data.activeFilters ?? [{ Filter: 'Scope', Value: 'All records' }]).map((row) => ({ 'Report information': String(row.Filter), Details: row.Value ?? null })),
  ] };
  if (kind === 'loads') return [overview, { name: 'Summary', rows: summary(data).slice(0, 5) }, chartSheet('Charts', groupedRows(data.loads, 'Item', ['Final Total USD'], ['Sales USD']), 'Load sales by item (USD)', 'Item', ['Sales USD']), { name: 'Loads and Sales', rows: data.loads }, { name: 'Payment Details', rows: payments(['load']) }];
  if (kind === 'customers') return [overview, chartSheet('Charts', data.customers.length ? data.customers.slice().sort((a, b) => Number(b['Remaining USD'] ?? 0) - Number(a['Remaining USD'] ?? 0)).slice(0, 10).map((row) => ({ Customer: row.Customer ?? null, 'Billed USD': row['Total Billed USD'] ?? null, 'Paid USD': row['Total Paid USD'] ?? null, 'Remaining USD': row['Remaining USD'] ?? null })) : [{ Customer: 'No matching records', 'Billed USD': 0, 'Paid USD': 0, 'Remaining USD': 0 }], 'Customer balances (USD)', 'Customer', ['Billed USD', 'Paid USD', 'Remaining USD'], 'bar'), { name: 'Customer Summary', rows: data.customers }, { name: 'Payment Details', rows: payments(['load', 'openingBalance']).filter((value) => value['Customer ID']) }, { name: 'Opening Balances', rows: data.openingBalances.filter((value) => value['Party Type'] === 'customer') }];
  if (kind === 'quarry') return [overview, chartSheet('Charts', groupedRows(data.quarryPurchases.filter((row) => row['Record Status'] === 'Active'), 'Supplier', ['Final Total USD'], ['Purchase USD']), 'Supplier load value by supplier (USD)', 'Supplier', ['Purchase USD'], 'bar'), { name: 'Supplier Summary', rows: data.suppliers }, { name: 'Purchase Details', rows: data.quarryPurchases }, { name: 'Payment Details', rows: payments(['quarryPurchase', 'openingBalance']).filter((value) => value['Supplier ID']) }];
  if (kind === 'fuel') {
    const gauge = [...data.fuelMovements].reverse().find((value) => value.Type === 'gauge' && value.Status === 'Active');
    const fuelChart = [{ Type: 'Delivered', Litres: data.fuelMovements.filter((value) => value.Type === 'delivery' && value.Status === 'Active').reduce((sum, value) => sum + Number(value['Litres In'] ?? 0), 0) }, { Type: 'Equipment fills', Litres: data.fuelMovements.filter((value) => value.Type === 'fill' && value.Status === 'Active').reduce((sum, value) => sum + Number(value['Litres Out'] ?? 0), 0) }];
    return [overview, { name: 'Balance Summary', rows: [{ Metric: 'Current calculated litres', Value: gauge?data.fuelMovements.at(-1)?.['Balance After Litres']??null:null }, { Metric: 'Latest physical gauge litres', Value: gauge?.['Gauge Litres'] ?? null }, { Metric: 'Latest physical gauge date', Value: gauge?.['Confirmed At'] ?? null }, { Metric: 'Total active purchased litres', Value: fuelChart[0]!.Litres }, { Metric: 'Total active filled litres', Value: fuelChart[1]!.Litres }, { Metric: 'Total consumption cost USD', Value: data.fuelMovements.filter(value=>value.Type==='fill'&&value.Status==='Active').reduce((sum,value)=>sum+Number(value['Consumption Cost USD']??0),0) }, {Metric:'Unpriced fill litres',Value:data.fuelMovements.filter(value=>value.Type==='fill'&&value.Status==='Active'&&value['Consumption Cost USD']==null).reduce((sum,value)=>sum+Number(value['Litres Out']??0),0)}, { Metric: 'Total active correction difference', Value: data.fuelMovements.filter((value) => value.Type === 'gauge' && value.Status === 'Active').reduce((sum, value) => sum + Number(value['Correction Difference'] ?? 0), 0) }] }, chartSheet('Charts', fuelChart, 'Purchased versus equipment-filled fuel (L)', 'Type', ['Litres']), { name: 'Movement Details', rows: data.fuelMovements }, { name: 'Project Cost Totals', rows: data.projectFuelTotals??[] }, { name: 'Machine Cost Totals', rows: data.equipmentTotals }, { name: 'Payment Details', rows: payments(['fuelDelivery']) }];
  }
  if (kind === 'projects') return [overview, chartSheet('Charts', data.projects.length ? data.projects.slice().sort((a, b) => Number(b['Daily Report Count'] ?? 0) - Number(a['Daily Report Count'] ?? 0)).slice(0, 10).map((row) => ({ Project: row.Project ?? null, 'Daily Report Count': row['Daily Report Count'] ?? null })) : [{ Project: 'No matching records', 'Daily Report Count': 0 }], 'Daily reports by project', 'Project', ['Daily Report Count'], 'bar'), { name: 'Project Summary', rows: data.projects }, { name: 'Project Loads', rows: data.loads }, { name: 'Supplier Loads', rows: data.quarryPurchases }, { name: 'Fuel Movements', rows: data.fuelMovements }, { name: 'Payment Details', rows: data.payments }, { name: 'Daily Report Index', rows: data.dailyReports }, { name: 'Materials Summary', rows: data.materials }];
  const financialRows = [{ Category: 'Customer receivable', 'Remaining USD': money(data.customers, 'Remaining USD') }, { Category: 'Supplier payable', 'Remaining USD': money(data.suppliers, 'Remaining USD') }, { Category: 'Load sales', 'Remaining USD': money(data.loads, 'Final Total USD') }, { Category: 'Supplier loads', 'Remaining USD': money(data.quarryPurchases, 'Final Total USD') }];
  const operationsRows = [{ Category: 'Loads', Count: data.loads.length }, { Category: 'Supplier loads', Count: data.quarryPurchases.length }, { Category: 'Fuel movements', Count: data.fuelMovements.length }, { Category: 'Daily reports', Count: data.dailyReports.length }];
  return [overview, { name: 'Executive Summary', rows: summary(data) }, chartSheet('Financial Charts', financialRows, 'Financial overview (USD)', 'Category', ['Remaining USD']), chartSheet('Operations Charts', operationsRows, 'Operational record counts', 'Category', ['Count']), { name: 'Loads and Sales', rows: data.loads }, { name: 'Customer Summary', rows: data.customers }, { name: 'Payments', rows: data.payments }, { name: 'Opening Balances', rows: data.openingBalances }, { name: 'Supplier Loads', rows: data.quarryPurchases }, { name: 'Supplier Summary', rows: data.suppliers }, { name: 'Fuel Movements', rows: data.fuelMovements }, { name: 'Equipment Totals', rows: data.equipmentTotals }, { name: 'Project Summary', rows: data.projects }, { name: 'Daily Reports', rows: data.dailyReports }, { name: 'Materials Summary', rows: data.materials }, { name: 'Data Dictionary', rows: dictionary }];
}

const translate = (value: string, locale: WorkbookLocale) => locale === 'ar' ? (ARABIC_LABELS[value] ?? ARABIC_VALUES[value] ?? value) : value;
function localizeRow(row: WorkbookRow, locale: WorkbookLocale): WorkbookRow {
  if (locale === 'en') return row;
  return Object.entries(row).reduce<WorkbookRow>((result, [key, value]) => { const generatedLabelValue=['Report information','Metric','Section'].includes(key)||(key==='Value'&&row.Metric==='Report title')||(key==='Details'&&row['Report information']==='Report title');result[translate(key, locale)] = typeof value === 'string' ? (ARABIC_VALUES[value] ?? (generatedLabelValue?ARABIC_LABELS[value]:undefined) ?? value) : value; return result; }, {});
}
function localizeSheet(sheet: SheetSpec, locale: WorkbookLocale): SheetSpec {
  if (locale === 'en') return sheet;
  return {
    ...sheet,
    name: translate(sheet.name, locale), rtl: true, rows: sheet.rows.map((row) => localizeRow(row, locale)),
    charts: sheet.charts?.map((chart) => ({ ...chart, title: translate(chart.title, locale), categoryKey: translate(chart.categoryKey, locale), valueKeys: chart.valueKeys.map((key) => translate(key, locale)) })),
  };
}
export function sheetsForBusinessReport(kind: BusinessReportKind, data: BusinessReportData, locale: WorkbookLocale = 'en'): SheetSpec[] { return englishSheetsForBusinessReport(kind, data).map((sheet) => localizeSheet(sheet, locale)); }
export function localizeWorkbookSheets(sheets: SheetSpec[], locale: WorkbookLocale): SheetSpec[] { return sheets.map((sheet) => localizeSheet(sheet, locale)); }

function styleForCell(key: string, value: WorkbookCell, header: boolean): number {
  if (header) return 1;
  if (typeof value !== 'number') return 0;
  if (/USD|Price|Subtotal|VAT|Paid|Remaining|Overpaid|Billed|Sales|Purchase/.test(key)) return 2;
  return 3;
}
function cellXml(value: WorkbookCell, row: number, column: number, key: string, header = false) {
  const ref = `${columnName(column)}${row}`, style = styleForCell(key, value, header);
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b" s="${style}"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}
function worksheetXml(spec: SheetSpec, hasDrawing: boolean) {
  const source = spec.rows.length ? spec.rows : [{ Status: 'No matching records' }], headers = [...new Set(source.flatMap((row) => Object.keys(row)))];
  const rows = [headers.reduce<WorkbookRow>((row, key) => { row[key] = key; return row; }, {}), ...source];
  const body = rows.map((values, index) => `<row r="${index + 1}">${headers.map((key, column) => cellXml(values[key] ?? null, index + 1, column, key, index === 0)).join('')}</row>`).join('');
  const widths = headers.map((key, column) => { let width = String(key).length + 2; for (const row of source.slice(0, 200)) width = Math.max(width, String(row[key] ?? '').length + 2); return `<col min="${column + 1}" max="${column + 1}" width="${Math.min(Math.max(width, 12), 36)}" customWidth="1"/>`; }).join('');
  const last = `${columnName(Math.max(0, headers.length - 1))}${rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"${spec.rtl ? ' rightToLeft="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${last}"/>${hasDrawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173F67"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const sheetFormula = (sheetName: string, column: number, endRow: number) => `'${sheetName.replace(/'/g, "''")}'!$${columnName(column)}$2:$${columnName(column)}$${Math.max(2, endRow)}`;
function chartXml(sheet: SheetSpec, chart: ChartSpec) {
  const rows = sheet.rows.length ? sheet.rows : [{ [chart.categoryKey]: 'No matching records', [chart.valueKeys[0]!]: 0 }];
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))], categoryColumn = Math.max(0, headers.indexOf(chart.categoryKey));
  const series = chart.valueKeys.map((key, index) => {
    const valueColumn = Math.max(0, headers.indexOf(key));
    const categoryCache=rows.map((row,point)=>`<c:pt idx="${point}"><c:v>${esc(row[chart.categoryKey]??'')}</c:v></c:pt>`).join('');
    const valueCache=rows.map((row,point)=>`<c:pt idx="${point}"><c:v>${Number(row[key]??0)}</c:v></c:pt>`).join('');
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${esc(key)}</c:v></c:tx><c:cat><c:strRef><c:f>${esc(sheetFormula(sheet.name, categoryColumn, rows.length + 1))}</c:f><c:strCache><c:ptCount val="${rows.length}"/>${categoryCache}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${esc(sheetFormula(sheet.name, valueColumn, rows.length + 1))}</c:f><c:numCache><c:formatCode>#,##0.00</c:formatCode><c:ptCount val="${rows.length}"/>${valueCache}</c:numCache></c:numRef></c:val></c:ser>`;
  }).join('');
  const barDir = chart.direction === 'bar' ? 'bar' : 'col';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1300" b="1"/><a:t>${esc(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="${barDir}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:axId val="48650112"/><c:axId val="48672768"/></c:barChart><c:catAx><c:axId val="48650112"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="48672768"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="48672768"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="#,##0.00" sourceLinked="0"/><c:majorGridlines/><c:tickLblPos val="nextTo"/><c:crossAx val="48650112"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea>${chart.valueKeys.length>1?'<c:legend><c:legendPos val="b"/><c:layout/></c:legend>':''}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}
function drawingXml(items: { kind: 'chart' | 'image'; relId: string; row: number; column: number; name: string }[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${items.map((item, index) => {
    const toColumn = item.column + (item.kind === 'chart' ? 8 : 4), toRow = item.row + (item.kind === 'chart' ? 20 : 16);
    const from = `<xdr:from><xdr:col>${item.column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${item.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`, to = `<xdr:to><xdr:col>${toColumn}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`;
    if (item.kind === 'chart') return `<xdr:twoCellAnchor>${from}${to}<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="${esc(item.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${item.relId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
    return `<xdr:twoCellAnchor>${from}${to}<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 2}" name="${esc(item.name)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${item.relId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm/><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
  }).join('')}</xdr:wsDr>`;
}

export function buildWorkbookFromSheets(sheets: SheetSpec[]): Uint8Array {
  const files: Record<string, Uint8Array> = {}, chartPaths: string[] = [], drawingPaths: string[] = [];
  files['_rels/.rels'] = strToU8(rootRels); files['xl/styles.xml'] = strToU8(styles);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, index) => `<sheet name="${esc(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr calcId="191029"/></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  let chartIndex = 0, drawingIndex = 0, imageIndex = 0;
  sheets.forEach((sheet, sheetIndex) => {
    const drawingItems: { kind: 'chart' | 'image'; relId: string; row: number; column: number; name: string; target: string }[] = [];
    for (const chart of sheet.charts ?? []) { chartIndex += 1; files[`xl/charts/chart${chartIndex}.xml`] = strToU8(chartXml(sheet, chart)); chartPaths.push(`/xl/charts/chart${chartIndex}.xml`); drawingItems.push({ kind: 'chart', relId: `rId${drawingItems.length + 1}`, row: 1 + (drawingItems.length * 21), column: Math.max(3, Object.keys(sheet.rows[0] ?? {}).length + 1), name: chart.title, target: `../charts/chart${chartIndex}.xml` }); }
    for (const image of sheet.images ?? []) { imageIndex += 1; files[`xl/media/image${imageIndex}.${image.extension}`] = image.bytes; drawingItems.push({ kind: 'image', relId: `rId${drawingItems.length + 1}`, row: image.row, column: image.column ?? 0, name: image.name, target: `../media/image${imageIndex}.${image.extension}` }); }
    files[`xl/worksheets/sheet${sheetIndex + 1}.xml`] = strToU8(worksheetXml(sheet, drawingItems.length > 0));
    if (drawingItems.length) {
      drawingIndex += 1; const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`; drawingPaths.push(`/${drawingPath}`); files[drawingPath] = strToU8(drawingXml(drawingItems));
      files[`xl/drawings/_rels/drawing${drawingIndex}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingItems.map((item) => `<Relationship Id="${item.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${item.kind === 'chart' ? 'chart' : 'image'}" Target="${item.target}"/>`).join('')}</Relationships>`);
      files[`xl/worksheets/_rels/sheet${sheetIndex + 1}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/></Relationships>`);
    }
  });
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${drawingPaths.map((path) => `<Override PartName="${path}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('')}${chartPaths.map((path) => `<Override PartName="${path}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('')}</Types>`);
  return zipSync(files, { level: 6 });
}

export function buildBusinessWorkbook(kind: BusinessReportKind, data: BusinessReportData, locale: WorkbookLocale = 'en') { return buildWorkbookFromSheets(sheetsForBusinessReport(kind, data, locale)); }
export async function buildBusinessWorkbookAsync(kind: BusinessReportKind, data: BusinessReportData, options: WorkbookBuildOptions = {}): Promise<Uint8Array> {
  checkCancelled(options.signal); const sheets = sheetsForBusinessReport(kind, data, options.locale ?? 'en'); progress(options, 'preparing', 0, sheets.length, 2, 'Preparing workbook structure');
  const staged: SheetSpec[] = [];
  for (let index = 0; index < sheets.length; index += 1) { checkCancelled(options.signal); const sheet = sheets[index]!; progress(options, 'building', index, sheets.length, 5 + Math.round(index / Math.max(1, sheets.length) * 65), `Building ${sheet.name}`); staged.push(sheet); await yieldToUi(); }
  checkCancelled(options.signal); progress(options, 'compressing', sheets.length, sheets.length, 72, 'Compressing workbook'); await yieldToUi(); const bytes = buildWorkbookFromSheets(staged); checkCancelled(options.signal); progress(options, 'compressing', sheets.length, sheets.length, 82, 'Workbook compressed'); return bytes;
}
function base64(bytes: Uint8Array) { const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let result = ''; for (let index = 0; index < bytes.length; index += 3) { const a = bytes[index] ?? 0, b = bytes[index + 1] ?? 0, c = bytes[index + 2] ?? 0, value = (a << 16) | (b << 8) | c; result += chars.charAt((value >> 18) & 63) + chars.charAt((value >> 12) & 63) + (index + 1 < bytes.length ? chars.charAt((value >> 6) & 63) : '=') + (index + 2 < bytes.length ? chars.charAt(value & 63) : '='); } return result; }
export function encodeWorkbookBytes(bytes: Uint8Array) { return base64(bytes); }
export function encodeBusinessWorkbook(kind: BusinessReportKind, data: BusinessReportData, locale: WorkbookLocale = 'en') { return base64(buildBusinessWorkbook(kind, data, locale)); }
export async function encodeBusinessWorkbookAsync(kind: BusinessReportKind, data: BusinessReportData, options: WorkbookBuildOptions = {}): Promise<string> {
  const bytes = await buildBusinessWorkbookAsync(kind, data, options), chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let result = ''; const chunkSize = 12288;
  for (let start = 0; start < bytes.length; start += chunkSize) { checkCancelled(options.signal); const end = Math.min(bytes.length, start + chunkSize); for (let index = start; index < end; index += 3) { const a = bytes[index] ?? 0, b = bytes[index + 1] ?? 0, c = bytes[index + 2] ?? 0, value = (a << 16) | (b << 8) | c; result += chars.charAt((value >> 18) & 63) + chars.charAt((value >> 12) & 63) + (index + 1 < bytes.length ? chars.charAt((value >> 6) & 63) : '=') + (index + 2 < bytes.length ? chars.charAt(value & 63) : '='); } progress(options, 'encoding', end, bytes.length, 82 + Math.round(end / Math.max(1, bytes.length) * 16), 'Encoding workbook file'); await yieldToUi(); }
  checkCancelled(options.signal); progress(options, 'encoding', bytes.length, bytes.length, 98, 'Workbook file ready'); return result;
}
