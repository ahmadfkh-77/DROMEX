import {describe,expect,it} from 'vitest';
import {
  applyFuelLedger,buildFuelDashboard,companySiteKey,describeFuelDestination,fillCostLabel,fuelDestinationOptions,
  fuelUsageCostLabel,groupFuelUsageByDestination,normalizeCompanySiteName,resolveFuelDestination,type FuelMovement,
  companySiteChoices,type CompanySite,
} from '../src/domain/fuel';

describe('companySiteChoices',()=>{
  const at='2026-09-01T00:00:00.000Z';
  const sites:CompanySite[]=[
    {id:'plant',name:'Asphalt Plant',isActive:true,createdAt:at,updatedAt:at},
    {id:'yard',name:'Main Yard',isActive:false,createdAt:at,updatedAt:at},
    {id:'depot',name:'Old Depot',isActive:false,createdAt:at,updatedAt:at},
  ];
  it('offers only active sites for a new fill',()=>{
    expect(companySiteChoices(sites,null)).toEqual([{id:'plant',label:'Asphalt Plant'}]);
  });
  it('keeps the inactive site a record already uses, and no other inactive site',()=>{
    expect(companySiteChoices(sites,'yard')).toEqual([{id:'plant',label:'Asphalt Plant'},{id:'yard',label:'Main Yard',detail:'Inactive site kept from this record'}]);
  });
});

const fill=(over:Partial<Omit<FuelMovement,'balanceAfterLitres'>>):Omit<FuelMovement,'balanceAfterLitres'>=>({
  id:'x',type:'fill',fuelType:'diesel',correctionHistory:[],confirmedAt:'2026-09-10T08:00:00Z',litres:0,previousBalanceLitres:null,
  differenceLitres:null,supplierId:null,supplierName:null,equipmentId:'loader',equipmentName:'Loader 01',projectId:null,projectName:null,
  ticketNumber:null,odometerReading:null,reason:null,notes:null,fuelPriceHistoryId:null,pricePerLitreUsd:null,priceOverrideReason:null,
  consumptionCostUsd:null,subtotalUsd:null,vatRatePercent:null,vatAmountUsd:null,finalTotalUsd:null,paymentStatus:'Unpriced',status:'Active',
  cancellationReason:null,cancelledAt:null,destinationType:'unassigned',companySiteId:null,companySiteName:null,companySiteIsActive:null,
  ...over,
});
const project=(id:string,name:string)=>({destinationType:'project' as const,projectId:id,projectName:name});
const site=(id:string,name:string,isActive=true)=>({destinationType:'company_site' as const,companySiteId:id,companySiteName:name,companySiteIsActive:isActive});

const movements=applyFuelLedger([
  fill({id:'gauge',type:'gauge',litres:5000,destinationType:null,confirmedAt:'2026-09-01T06:00:00Z'}),
  fill({id:'delivery',type:'delivery',litres:1000,destinationType:null,confirmedAt:'2026-09-01T07:00:00Z',finalTotalUsd:950}),
  fill({id:'road1',...project('road','Road'),litres:100,pricePerLitreUsd:.9,consumptionCostUsd:90,confirmedAt:'2026-09-02T08:00:00Z'}),
  fill({id:'road2',...project('road','Road'),fuelType:'gasoline',litres:50,equipmentName:'Pickup 02',confirmedAt:'2026-09-03T08:00:00Z'}),
  fill({id:'bridge',...project('bridge','Bridge'),litres:30,pricePerLitreUsd:1,consumptionCostUsd:30}),
  fill({id:'plant1',...site('plant','Asphalt Plant'),litres:200,pricePerLitreUsd:.9,consumptionCostUsd:180}),
  fill({id:'yard',...site('yard','Main Yard',false),litres:40}),
  fill({id:'un1',litres:25,pricePerLitreUsd:.9,consumptionCostUsd:22.5,notes:'Generator top-up'}),
  fill({id:'cancelled',...site('plant','Asphalt Plant'),litres:999,status:'Cancelled',consumptionCostUsd:899.1,pricePerLitreUsd:.9}),
]);

describe('fuel destination choices',()=>{
  it('offers exactly Project, Company Site, and Unassigned',()=>{
    expect(fuelDestinationOptions.map(option=>[option.id,option.label])).toEqual([['project','Project'],['company_site','Company Site'],['unassigned','Unassigned']]);
  });
});

describe('resolveFuelDestination',()=>{
  it('requires a project for the Project destination',()=>{
    expect(()=>resolveFuelDestination({destinationType:'project',projectId:'',companySiteId:''})).toThrow(/select a project/i);
  });
  it('requires a company site for the Company Site destination',()=>{
    expect(()=>resolveFuelDestination({destinationType:'company_site',projectId:'',companySiteId:'  '})).toThrow(/select a company site/i);
  });
  it('clears a stale company-site id when Project is chosen',()=>{
    expect(resolveFuelDestination({destinationType:'project',projectId:'road',companySiteId:'plant'})).toEqual({destinationType:'project',projectId:'road',companySiteId:null});
  });
  it('clears a stale project id when Company Site is chosen',()=>{
    expect(resolveFuelDestination({destinationType:'company_site',projectId:'road',companySiteId:'plant'})).toEqual({destinationType:'company_site',projectId:null,companySiteId:'plant'});
  });
  it('clears both ids when Unassigned is chosen',()=>{
    expect(resolveFuelDestination({destinationType:'unassigned',projectId:'road',companySiteId:'plant'})).toEqual({destinationType:'unassigned',projectId:null,companySiteId:null});
  });
  it('derives the destination of a draft saved before destinations existed',()=>{
    expect(resolveFuelDestination({projectId:'road'})).toEqual({destinationType:'project',projectId:'road',companySiteId:null});
    expect(resolveFuelDestination({})).toEqual({destinationType:'unassigned',projectId:null,companySiteId:null});
  });
  it('refuses an unknown destination type',()=>{
    expect(()=>resolveFuelDestination({destinationType:'site' as never,projectId:'road'})).toThrow(/fuel destination/i);
  });
});

describe('company site names',()=>{
  it('stores a trimmed, internally collapsed display name',()=>expect(normalizeCompanySiteName('  Asphalt   Plant ')).toBe('Asphalt Plant'));
  it('compares names case-insensitively for duplicates',()=>expect(companySiteKey(' ASPHALT  plant')).toBe(companySiteKey('asphalt plant')));
});

describe('describeFuelDestination',()=>{
  it('names the destination type and its target for correction history',()=>{
    expect(describeFuelDestination({destinationType:'project',projectName:'Road',companySiteName:null})).toBe('Project: Road');
    expect(describeFuelDestination({destinationType:'company_site',projectName:null,companySiteName:'Asphalt Plant'})).toBe('Company Site: Asphalt Plant');
    expect(describeFuelDestination({destinationType:'unassigned',projectName:null,companySiteName:null})).toBe('Unassigned');
  });
});

describe('groupFuelUsageByDestination',()=>{
  it('gives every project, every company site, and Unassigned its own group, projects first and Unassigned last',()=>{
    const review=groupFuelUsageByDestination(movements);
    expect(review.groups.map(group=>[group.destinationType,group.name,group.totalLitres,group.fillCount])).toEqual([
      ['project','Road',150,2],['project','Bridge',30,1],['company_site','Asphalt Plant',200,1],['company_site','Main Yard',40,1],['unassigned','Unassigned',25,1],
    ]);
  });

  it('excludes cancelled fills, purchases, and gauge readings',()=>{
    const ids=groupFuelUsageByDestination(movements).groups.flatMap(group=>group.fills.map(value=>value.id));
    expect(ids).not.toContain('cancelled');
    expect(ids).not.toContain('delivery');
    expect(ids).not.toContain('gauge');
  });

  it('reconciles group totals with the overall included usage',()=>{
    const review=groupFuelUsageByDestination(movements);
    const sum=(pick:(group:typeof review.groups[number])=>number)=>Math.round(review.groups.reduce((total,group)=>total+pick(group),0)*100)/100;
    expect(review.totals).toEqual({totalLitres:445,pricedCostUsd:322.5,unpricedLitres:90,unpricedFillCount:2,fillCount:6});
    expect(sum(group=>group.totalLitres)).toBe(review.totals.totalLitres);
    expect(sum(group=>group.pricedCostUsd)).toBe(review.totals.pricedCostUsd);
    expect(sum(group=>group.unpricedLitres)).toBe(review.totals.unpricedLitres);
    expect(sum(group=>group.fillCount)).toBe(review.totals.fillCount);
  });

  it('counts unpriced litres without treating a missing price as zero cost',()=>{
    const groups=groupFuelUsageByDestination(movements).groups;
    expect(groups.find(group=>group.name==='Main Yard')).toMatchObject({pricedCostUsd:0,pricedFillCount:0,unpricedLitres:40,unpricedFillCount:1});
    expect(groups.find(group=>group.name==='Road')).toMatchObject({pricedCostUsd:90,pricedFillCount:1,unpricedLitres:50,unpricedFillCount:1});
  });

  it('breaks each destination down by fuel type',()=>{
    const road=groupFuelUsageByDestination(movements).groups.find(group=>group.name==='Road');
    expect(road?.fuelTypes).toEqual({diesel:{litres:100,fillCount:1},gasoline:{litres:50,fillCount:1}});
  });

  it('lists fills newest first inside a destination',()=>{
    expect(groupFuelUsageByDestination(movements).groups[0]?.fills.map(value=>value.id)).toEqual(['road2','road1']);
  });

  it('keeps an inactive company site visible with its historical fills',()=>{
    expect(groupFuelUsageByDestination(movements).groups.find(group=>group.destinationId==='yard')).toMatchObject({isActive:false,fillCount:1});
  });

  it('filters to projects, company sites, or Unassigned',()=>{
    const names=(filter:'project'|'company_site'|'unassigned')=>groupFuelUsageByDestination(movements,{filter}).groups.map(group=>group.name);
    expect(names('project')).toEqual(['Road','Bridge']);
    expect(names('company_site')).toEqual(['Asphalt Plant','Main Yard']);
    expect(names('unassigned')).toEqual(['Unassigned']);
    expect(groupFuelUsageByDestination(movements,{filter:'unassigned'}).groups[0]?.fills.map(value=>value.id)).toEqual(['un1']);
    expect(groupFuelUsageByDestination(movements,{filter:'project'}).totals.totalLitres).toBe(180);
  });

  it('searches destination names, equipment, and notes, and totals only what matches',()=>{
    expect(groupFuelUsageByDestination(movements,{query:'plant'}).groups.map(group=>group.name)).toEqual(['Asphalt Plant']);
    const notes=groupFuelUsageByDestination(movements,{query:'GENERATOR'});
    expect(notes.groups.map(group=>[group.name,group.fills.map(value=>value.id)])).toEqual([['Unassigned',['un1']]]);
    const equipment=groupFuelUsageByDestination(movements,{query:'pickup'});
    expect(equipment.groups.map(group=>[group.name,group.totalLitres])).toEqual([['Road',50]]);
    expect(equipment.totals.totalLitres).toBe(50);
    expect(groupFuelUsageByDestination(movements,{query:'no such destination'})).toEqual({groups:[],totals:{totalLitres:0,pricedCostUsd:0,unpricedLitres:0,unpricedFillCount:0,fillCount:0}});
  });

  it('places a fill saved before destinations existed by its project link',()=>{
    const legacy=applyFuelLedger([fill({id:'old-project',destinationType:undefined,projectId:'road',projectName:'Road',litres:10}),fill({id:'old-none',destinationType:undefined,litres:5})]);
    expect(groupFuelUsageByDestination(legacy).groups.map(group=>[group.destinationType,group.name])).toEqual([['project','Road'],['unassigned','Unassigned']]);
  });
});

describe('fuel cost labels',()=>{
  it('shows Cost unavailable, never $0.00, when nothing in a destination is priced',()=>{
    expect(fuelUsageCostLabel({pricedCostUsd:0,pricedFillCount:0})).toBe('Cost unavailable');
    expect(fuelUsageCostLabel({pricedCostUsd:90,pricedFillCount:1})).toBe('$90.00');
  });
  it('shows Cost unavailable for an unpriced fill',()=>{
    expect(fillCostLabel({consumptionCostUsd:null})).toBe('Cost unavailable');
    expect(fillCostLabel({consumptionCostUsd:0})).toBe('$0.00');
  });
});

describe('fuel dashboard destinations',()=>{
  it('reports this month by destination instead of lumping unlinked fills under a project heading',()=>{
    const dashboard=buildFuelDashboard(movements,new Date(2026,8,15,12));
    expect(dashboard.destinations.map(group=>group.name)).toEqual(['Road','Bridge','Asphalt Plant','Main Yard','Unassigned']);
    expect('projects' in dashboard).toBe(false);
  });
});
