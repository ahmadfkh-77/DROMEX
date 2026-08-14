import {describe,expect,it} from 'vitest';
import {strFromU8,unzipSync} from 'fflate';

import type {DailyProjectReport,LinkedProjectLoad,LinkedWasteDump,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import {buildDailyReportWorkbook,dailyReportWorkbookSheets} from '../src/services/dailyReportWorkbookCore';

const report:DailyProjectReport={id:'report-1',projectId:'project-1',workDate:'2026-08-14',workDescription:'صب خرسانة Concrete pour',workers:['Ali'],drivers:['Omar'],truckPlates:['B123'],machines:['Excavator'],materials:[{id:'material-1',itemId:'item-1',itemName:'Concrete',unitId:'m3',unitName:'Cubic metre',unitSymbol:'m³',quantity:12,movement:'used'}],photos:['file:///photo-1.jpg'],notes:'Completed safely',problemsDelaysIncidents:'',weatherSiteConditions:'Clear',workStartTime:'07:00',workEndTime:'17:00',breakMinutes:'60',nextWorkPlanned:'Curing',createdAt:'2026-08-14T17:00:00Z',updatedAt:'2026-08-14T17:00:00Z'};
const project:ReportProject={id:'project-1',name:'Harbour Extension',customerName:'Customer A',location:'Beirut',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null};
const loads:LinkedProjectLoad[]=[{id:'load-1',transactionNumber:'L-100',itemName:'Sand',quantity:20.5,unitSymbol:'t',driverName:'Ali',truckPlate:'B123'}];
const waste:LinkedWasteDump[]=[{id:'waste-1',dumpedAt:'2026-08-14T12:00:00Z',materialType:'Soil',dumpLocation:'Zone B',truckPlate:'B123',driverName:'Ali'}];

describe('daily report workbook',()=>{
  it('contains structured work, presence, material, load, waste, and photo sheets',()=>{expect(dailyReportWorkbookSheets(report,project,loads,waste,company).map(sheet=>sheet.name)).toEqual(['Report Overview','Work Details','Presence','Materials','Linked Loads','Waste Dumps','Photos']);});
  it('embeds photo media through a dedicated Photos worksheet drawing',()=>{const image={name:'Photo 1',bytes:new Uint8Array([137,80,78,71,13,10,26,10]),extension:'png' as const,row:2,column:0};const files=unzipSync(buildDailyReportWorkbook(report,project,loads,waste,company,[image]));expect(files['xl/media/image1.png']).toEqual(image.bytes);expect(strFromU8(files['xl/worksheets/sheet7.xml']!)).toContain('<drawing r:id="rId1"/>');expect(strFromU8(files['xl/drawings/drawing1.xml']!)).toContain('Photo 1');expect(strFromU8(files['xl/drawings/_rels/drawing1.xml.rels']!)).toContain('../media/image1.png');});
  it('localizes generated labels and direction without translating entered text',()=>{const files=unzipSync(buildDailyReportWorkbook(report,project,loads,waste,company,[],'ar')),workbook=strFromU8(files['xl/workbook.xml']!),work=strFromU8(files['xl/worksheets/sheet2.xml']!);expect(workbook).toContain('نظرة عامة على التقرير');expect(work).toContain('rightToLeft="1"');expect(work).toContain('صب خرسانة Concrete pour');expect(work).toContain('17:00');});
});
