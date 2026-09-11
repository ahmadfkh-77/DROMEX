import {describe,expect,it} from 'vitest';

import type {DailyProjectReport,LinkedFuelFill,ProjectReportSetup,ReportProject} from '../src/domain/projectReports';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';

const report={workDate:'2026-08-11',workDescription:'Excavation',workers:[],drivers:[],truckPlates:[],machines:[],materials:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,showConsultingAgency:false,showCustomHeader:false,projectId:'p',id:'r',createdAt:'',updatedAt:''} as unknown as DailyProjectReport;
const project={id:'p',name:'Road',customerName:'Customer',location:'Aley',status:'active'} as ReportProject;
const company={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryNameAr:null,ministryLogoUri:null,consultingAgencyName:null,consultingAgencyNameAr:null,customHeaderEn:null,customHeaderAr:null} as ProjectReportSetup['company'];

const fill=(id:string,fuelType:'diesel'|'gasoline',equipmentName:string):LinkedFuelFill=>({id,confirmedAt:'2026-08-11T08:00:00Z',equipmentName,litres:50,pricePerLitreUsd:null,consumptionCostUsd:null,odometerReading:null,notes:null,fuelType});

describe('daily report PDF fuel table',()=>{
  it('shows a fuel type column naming Diesel and Gasoline',()=>{
    const html=buildProjectReportHtmlWithWaste(report,project,[],[],[],[fill('f1','diesel','Excavator'),fill('f2','gasoline','Generator')],company,null,[]);

    expect(html).toContain('<th>Fuel type</th>');
    // The stored value is lowercase; the report must print the human label.
    expect(html).toContain('>Diesel</td>');
    expect(html).toContain('>Gasoline</td>');
  });

  it('keeps the empty-state row spanning every fuel column',()=>{
    // Time, Equipment, Fuel type, Litres, Odometer.
    const withoutPrices=buildProjectReportHtmlWithWaste(report,project,[],[],[],[],company,null,[],false);
    expect(withoutPrices).toContain('colspan="5"');

    // The same plus Price and Cost.
    const withPrices=buildProjectReportHtmlWithWaste(report,project,[],[],[],[],company,null,[],true);
    expect(withPrices).toContain('colspan="7"');
  });
});
