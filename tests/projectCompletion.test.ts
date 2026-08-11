import {describe,expect,it} from 'vitest';
import {buildProjectCompletionHtml} from '../src/services/projectCompletionTemplate';

describe('completed project PDF',()=>{
  it('includes start-to-finish summaries and appendices',()=>{
    const html=buildProjectCompletionHtml(
      {id:'p1',name:'Six Month Roadworks',customerName:'Municipality',location:'Aley',status:'completed'},
      [{id:'r1',projectId:'p1',workDate:'2026-01-02',workDescription:'Excavation',workers:['Ali'],drivers:['Omar'],truckPlates:['123 A'],machines:['CAT 320'],materials:[],photos:[],notes:'Progressed normally',problemsDelaysIncidents:'Rain delay',weatherSiteConditions:'Wet',workStartTime:'07:00',workEndTime:'17:00',breakMinutes:'60',nextWorkPlanned:'Continue excavation',createdAt:'',updatedAt:''}],
      [{id:'l1',workDate:'2026-01-02',transactionNumber:'L-001',itemName:'Basecourse',quantity:12.5,unitSymbol:'m³',driverName:'Omar',truckPlate:'123 A'}],
      [{id:'w1',workDate:'2026-01-02',dumpedAt:'2026-01-02T09:00:00Z',materialType:'Soil',dumpLocation:'North dump',truckPlate:'123 A',driverName:'Omar'}],
      {name:'DROMEX',logoUri:null,address:null,phone:null,email:null,taxVatNumber:null},null,[],
    );
    expect(html).toContain('Completed Project Report');
    expect(html).toContain('Six Month Roadworks');
    expect(html).toContain('12.500');
    expect(html).toContain('Waste dump appendix');
    expect(html).toContain('9.0 hours net');
  });
});
