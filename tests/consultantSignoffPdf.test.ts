import {describe,expect,it} from 'vitest';
import {buildProjectReportHtmlWithWaste} from '../src/services/projectReportWasteTemplate';
import type {DailyProjectReport,ReportProject,ProjectReportSetup} from '../src/domain/projectReports';

const project:ReportProject={id:'p',name:'Road',customerName:'Customer',location:'Aley',status:'active'};
const company:ProjectReportSetup['company']={name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null,ministryName:null,ministryLogoUri:null,consultingAgencyName:null};
const baseReport:DailyProjectReport={
  id:'r',projectId:'p',workDate:'2026-08-11',workDescription:'Excavation',workers:[],drivers:[],truckPlates:[],machines:[],
  materials:[],workerSafety:[],photos:[],notes:'',problemsDelaysIncidents:'',weatherSiteConditions:'',workStartTime:'',workEndTime:'',
  breakMinutes:'',nextWorkPlanned:'',consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[],showMinistryHeader:false,createdAt:'',updatedAt:'',
};
function render(report:DailyProjectReport){return buildProjectReportHtmlWithWaste(report,project,[],[],company,null,[]);}

describe('consultant sign-off in the daily-report PDF',()=>{
  it('renders no consultant section at all when sign-off is disabled',()=>{
    const html=render({...baseReport,consultantSignoffEnabled:false,consultantName:'Jad Khoury',consultantSignaturePaths:['M0 0']});
    expect(html).not.toContain('Consultant Sign-off');
  });

  it('shows an explicit incomplete notice with a missing-signature reason when only the name is on file',()=>{
    const html=render({...baseReport,consultantSignoffEnabled:true,consultantName:'Jad Khoury',consultantSignaturePaths:[]});
    expect(html).toContain('Consultant sign-off incomplete');
    expect(html).toContain('Signature not supplied');
    expect(html).toContain('Name on file: Jad Khoury');
    expect(html).not.toContain('Consultant name not supplied');
  });

  it('shows an explicit incomplete notice with a missing-name reason when only the signature is on file',()=>{
    const html=render({...baseReport,consultantSignoffEnabled:true,consultantName:'',consultantSignaturePaths:['M0 0']});
    expect(html).toContain('Consultant sign-off incomplete');
    expect(html).toContain('Consultant name not supplied');
    expect(html).not.toContain('Signature not supplied');
  });

  it('shows both missing-data reasons when neither name nor signature is on file',()=>{
    const html=render({...baseReport,consultantSignoffEnabled:true,consultantName:'',consultantSignaturePaths:[]});
    expect(html).toContain('Consultant sign-off incomplete');
    expect(html).toContain('Signature not supplied');
    expect(html).toContain('Consultant name not supplied');
  });

  it('never implies approval in the incomplete state: no signature image, no signing timestamp language',()=>{
    const html=render({...baseReport,consultantSignoffEnabled:true,consultantName:'',consultantSignaturePaths:[]});
    expect(html).not.toContain('<div class="consultant-signature-box">');
    expect(html).not.toContain('<svg viewBox="0 0 320 140">');
  });

  it('renders the consultant name and an svg signature when sign-off is complete',()=>{
    const html=render({...baseReport,consultantSignoffEnabled:true,consultantName:'Jad Khoury',consultantSignaturePaths:['M10 10 L20 20']});
    expect(html).toContain('Consultant Sign-off');
    expect(html).toContain('Jad Khoury');
    expect(html).toContain('<svg viewBox="0 0 320 140">');
    expect(html).toContain('d="M10 10 L20 20"');
    expect(html).not.toContain('Consultant sign-off incomplete');
  });
});
