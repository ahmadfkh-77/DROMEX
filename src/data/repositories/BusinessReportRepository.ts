import type{BusinessReportData}from'../../domain/businessReports';
export interface BusinessReportRepository{getReportData():Promise<BusinessReportData>}
