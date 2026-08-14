import {describe,expect,it} from 'vitest';
import {buildDashboardSnapshot,resolveDashboardRange} from '../src/domain/dashboard';
import type {BusinessReportData} from '../src/domain/businessReports';

const base:BusinessReportData={generatedAt:'2026-08-14T12:00:00Z',companyName:'DROMEX',customers:[],suppliers:[],equipmentTotals:[],materials:[],loads:[
  {'Record ID':'load-1','Confirmed At':'2026-08-14T08:00:00','Customer ID':'c1','Customer':'Cedar','Project ID':'p1','Project':'Road','Net Weight kg':20000,'Final Total USD':1000,'Remaining USD':600,'Payment Status':'Partially Paid'},
  {'Record ID':'load-2','Confirmed At':'2026-08-12T08:00:00','Customer ID':'c1','Customer':'Cedar','Project ID':'p1','Project':'Road','Net Weight kg':18000,'Final Total USD':null,'Remaining USD':null,'Payment Status':'Unpriced'},
],payments:[
  {'Payment ID':'pay-1','Target Record ID':'load-1','Target Type':'load','Customer ID':'c1','Amount USD':400,'Payment Date':'2026-08-14','Status':'Active'},
  {'Payment ID':'pay-cancelled','Target Record ID':'load-1','Target Type':'load','Customer ID':'c1','Amount USD':100,'Payment Date':'2026-08-14','Status':'Cancelled'},
],openingBalances:[{'Record ID':'opening-1','Party Type':'supplier','Supplier ID':'s1','Party':'Quarry','Original Amount USD':500,'As-of Date':'2026-08-10','Status':'Unpaid'}],quarryPurchases:[{'Record ID':'quarry-1','Confirmed At':'2026-08-13','Supplier ID':'s1','Supplier':'Quarry','Quantity m3':80,'Remaining USD':200,'Record Status':'Active'}],fuelMovements:[
  {'Movement ID':'g1','Confirmed At':'2026-08-01','Type':'gauge','Status':'Active','Balance After Litres':2000},
  {'Movement ID':'f1','Confirmed At':'2026-08-13','Type':'fill','Status':'Active','Litres Out':300,'Balance After Litres':1700,'Project ID':'p1'},
  {'Movement ID':'d1','Confirmed At':'2026-08-14','Type':'delivery','Status':'Active','Litres In':1000,'Balance After Litres':2700,'Supplier ID':'s2','Supplier':'Fuel Co','Final Total USD':900,'Paid USD':300},
],projects:[{'Project ID':'p1','Project':'Road','Status':'active'},{'Project ID':'p2','Project':'Idle project','Status':'active'}],dailyReports:[{'Report ID':'r1','Project ID':'p1','Work Date':'2026-08-12'}]};

describe('dashboard ranges',()=>{
  it('uses inclusive today, seven-day, and thirty-day windows',()=>{
    expect(resolveDashboardRange('today','2026-08-14')).toMatchObject({fromDate:'2026-08-14',toDate:'2026-08-14'});
    expect(resolveDashboardRange('7days','2026-08-14')).toMatchObject({fromDate:'2026-08-08',toDate:'2026-08-14'});
    expect(resolveDashboardRange('30days','2026-08-14')).toMatchObject({fromDate:'2026-07-16',toDate:'2026-08-14'});
  });

  it('supports all-time and either open-ended custom date boundary',()=>{
    expect(resolveDashboardRange('custom','2026-08-14','','')).toEqual({fromDate:'',toDate:'',label:'All dates'});
    expect(resolveDashboardRange('custom','2026-08-14','2026-01-01','')).toEqual({fromDate:'2026-01-01',toDate:'',label:'2026-01-01 onward'});
    expect(resolveDashboardRange('custom','2026-08-14','','2026-06-30')).toEqual({fromDate:'',toDate:'2026-06-30',label:'Through 2026-06-30'});
  });
});

describe('dashboard reconciliation',()=>{
  it('calculates production, missing reports, current fuel, and period financials',()=>{
    const result=buildDashboardSnapshot(base,resolveDashboardRange('7days','2026-08-14'));
    expect(result.production).toMatchObject({loadCount:2,netTonnes:38,unpricedLoadCount:1,activeProjectCount:2,fuelBalanceLitres:2700,fuelUsedLitres:300,quarryCubicMetres:80,missingReportCount:1});
    expect(result.financial).toMatchObject({salesUsd:1000,receivedUsd:400,receivableUsd:600,payableUsd:1300,attentionCount:4});
    expect(result.financial.largestBalances.map(value=>value.name)).toEqual(['Quarry','Cedar','Fuel Co']);
  });

  it('counts only active project-days with loads and no matching report',()=>{
    const today=buildDashboardSnapshot(base,resolveDashboardRange('today','2026-08-14'));
    expect(today.production.missingReportCount).toBe(1);
    expect(today.production.projects).toHaveLength(1);
    expect(today.production.projects[0]).toMatchObject({id:'p1',loadCount:1,missingReportCount:1});
  });

  it('reconciles ten thousand loads within a practical dashboard calculation budget',()=>{
    const projects=Array.from({length:12},(_,index)=>({'Project ID':`p${index+1}`,'Project':`Large project ${index+1}`,'Status':index<8?'active':'completed'}));
    const loads=Array.from({length:10000},(_,index)=>{
      const project=(index%12)+1,day=String((index%28)+1).padStart(2,'0');
      return{'Record ID':`load-${index}`,'Confirmed At':`2026-07-${day}T08:00:00`,'Customer ID':`c${(index%8)+1}`,'Customer':`Customer ${(index%8)+1}`,'Project ID':`p${project}`,'Project':`Large project ${project}`,'Net Weight kg':20000,'Final Total USD':1000,'Remaining USD':index%4===0?0:500,'Payment Status':index%17===0?'Unpriced':'Unpaid'};
    });
    const large:BusinessReportData={...base,loads,projects,dailyReports:[],payments:[],openingBalances:[],quarryPurchases:[],fuelMovements:[]};
    const started=performance.now();
    const result=buildDashboardSnapshot(large,resolveDashboardRange('custom','2026-08-14','',''));
    const elapsed=performance.now()-started;
    expect(result.production.loadCount).toBe(10000);
    expect(result.production.netTonnes).toBe(200000);
    expect(result.production.missingReportCount).toBe(56);
    expect(result.financial.salesUsd).toBe(10000000);
    expect(elapsed).toBeLessThan(2000);
  });
});
