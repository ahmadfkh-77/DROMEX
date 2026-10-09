import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks for the approved Screens A, C, D and E (DEC-505). There is no React Native
// renderer in the test stack; the grouping, wording and numbers are covered by fuel-batch-views.test.ts.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');
const inOrder=(text:string,parts:string[])=>{const at=parts.map(part=>text.indexOf(part));expect(at.every(index=>index>=0),`missing one of ${parts.join(' | ')}`).toBe(true);expect([...at].sort((a,b)=>a-b)).toEqual(at);};

describe('Screen A · Fuel screen',()=>{
  const panel=source('src/ui/components/fuel/DieselBatchesPanel.tsx');
  const screen=source('src/ui/screens/FuelTrackingScreen.tsx');
  it('opens on a Batches tab and keeps every existing tab',()=>{
    expect(screen).toContain("['batches','dashboard','history','usage','delivery','fill','gauge','price','sites','stations']");
    expect(screen).toContain("value==='batches'?'Batches'");
    expect(screen).toContain('<DieselBatchesPanel');
  });
  it('shows the parts in the approved order',()=>{
    inOrder(panel,['DIESEL IN TANK','label="Record Fill"','label="Record Delivery"','title="Filter fuel records"','title="Open batches"','title="Closed batches"','title="Outside station fills"','title="Before batches history"','title="Gasoline"']);
  });
  it('lists each open batch with its three figures, a usage bar and an honest note',()=>{
    for(const text of ['label="Delivered"','label="Filled"','label="Remaining"','dip adjustment','Starts after ','Invoice ','not recorded','Calculated (no dip reading)'])expect(panel).toContain(text);
    expect(panel).toContain('importantForAccessibility="no-hide-descendants"');
  });
  it('keeps large lists closed until opened and states that station fills leave the tank alone',()=>{
    expect(panel).toContain('useState<Set<string>>(new Set())');
    expect(panel).toContain('Outside station fills do not change the tank.');
  });
  it('shows active filters as removable chips with Clear all, and filters by every agreed field',()=>{
    for(const label of ['label="Source"','label="Batch status"','label="Project"','label="Company site"','label="Station"','label="From date"','label="To date"','Search batch or invoice number'])expect(panel).toContain(label);
    expect(panel).toContain('Remove filter');
    expect(panel).toContain('Clear all');
  });
  it('raises the Overfill Alert inside the tank card, in words',()=>{
    expect(panel).toContain('accessibilityRole="alert"');
    expect(panel).toContain('Overfill Alert:');
  });
  it('starts diesel batches once, from a dip reading or the calculated balance, after a confirmation',()=>{
    for(const text of ['Start diesel batches','Dip reading now, in litres (optional, recommended)','Opening stock price per litre (optional)','This is done once and cannot be undone.','Calculated (no dip reading)'])expect(panel).toContain(text);
    expect(screen).toContain('repository.startDieselBatches(draft)');
  });
});

describe('Screen C · batch page',()=>{
  const page=source('src/ui/components/fuel/DieselBatchPage.tsx');
  it('shows the parts in the approved order with a sticky summary',()=>{
    inOrder(page,['DIESEL BATCH','<BatchStatusBadge','label="Delivered"','label="Adjustments"','label="Remaining"','label="Record Fill"','title="Batch details"','title="Totals by destination"','Dip adjustment ·','title="Fills by day"','label="Cancel Batch"']);
    expect(page).toContain('stickyHeaderIndices={[1]}');
  });
  it('writes Unpriced and Not recorded instead of inventing values',()=>{
    expect(page).toContain("'Unpriced'");
    expect(page).toContain("'Not recorded'");
  });
  it('needs a reason to cancel, confirms first, and says the number is never reused',()=>{
    expect(page).toContain('label="Cancellation reason *"');
    expect(page).toContain('disabled={!reason.trim()}');
    expect(page).toContain('Alert.alert(');
    expect(page).toContain('is never reused');
    expect(page).toContain('tone="danger"');
  });
});

describe('Screen D · day cards',()=>{
  const parts=source('src/ui/components/fuel/FuelBatchParts.tsx');
  it('puts the date and the day total in the header, a label and total for each destination, and the source tag on every row',()=>{
    for(const text of ['Day total','PROJECT','COMPANY SITE','UNASSIGNED','Project total','Site total','Unassigned total','<SourceTag source={row.source}/>','row.splitLine'])expect(parts).toContain(text);
  });
  it('never relies on colour alone: tags and badges carry their words',()=>{
    expect(parts).toContain('{source.text}');
    expect(parts).toContain('{batchStatusLabels[status]}');
  });
  it('lines numbers up and keeps group headers at least 48 pt tall',()=>{
    expect(parts).toContain("fontVariant:['tabular-nums']");
    expect(parts).toMatch(/group:\{minHeight:56/);
  });
});

describe('Screen E · project fuel view',()=>{
  const view=source('src/ui/components/fuel/ProjectFuelView.tsx');
  const screen=source('src/ui/screens/FuelTrackingScreen.tsx');
  it('uses the approved header and parts in order',()=>{
    expect(screen).toContain("'PROJECT · EQUIPMENT FUEL'");
    expect(screen).toContain("'Equipment Fuel'");
    inOrder(view,['PROJECT','title="Fuel for this project"','Total fuel','From tank · batches','From tank · before batches','Outside stations','Fuel cost','title="By source"','title="Filter project fuel"','title="By equipment"','title="Fills by day"']);
  });
  it('shows a day card without destination groups, and counts unpriced litres openly',()=>{
    expect(view).toContain('byDestination:false');
    expect(view).toContain('Unpriced');
    expect(screen).toContain('byEquipment={<ProjectFuelGroups');
  });
});

describe('Home entry point',()=>{
  it('adds only a compact line to the existing Fuel Tracking action',()=>{
    expect(source('src/ui/screens/HomeScreen.tsx')).toContain('badge={props.fuelBadge??undefined}');
    expect(source('src/ui/DromexApp.tsx')).toContain('fuelHomeBadge(value)');
  });
});

describe('Screen F · exporting the Diesel Batch Report',()=>{
  const screen=source('src/ui/screens/FuelTrackingScreen.tsx');
  const panel=source('src/ui/components/fuel/DieselBatchesPanel.tsx');
  const exportPanel=source('src/ui/components/fuel/DieselPdfExportPanel.tsx');
  it('can be exported from the batch page, the filter view and the project view',()=>{
    expect(screen).toContain('exportReport({batchId:openBatch.id},includePrices,company)');
    expect(screen).toContain('exportReport({projectId:lockedProjectId},includePrices,company)');
    expect(screen).toContain('onExport={exportReport}');
    expect(panel).toContain('onExport(filters??{supplierId:supplierId||undefined,projectId:projectId||undefined,companySiteId:companySiteId||undefined,stationId:stationId||undefined,fromDate:fromDate||undefined,toDate:toDate||undefined},includePrices,company)');
  });
  it('defaults to Without prices, as DEC-373 says',()=>{
    expect(exportPanel).toContain("useState<'without'|'with'>('without')");
    expect(exportPanel).toContain("label:'Without prices'");
    expect(exportPanel).toContain("label:'With prices'");
  });
  it('builds the report at the moment of export and refuses an empty one with a plain message',()=>{
    expect(screen).toContain('exportedAt:new Date().toISOString()');
    expect(source('src/services/documentExport.ts')).toContain('No fills or deliveries match these filters, so there is nothing to export.');
  });
});

describe('History and Usage tabs in the day-card design (amended 2026-10-03)',()=>{
  const screen=source('src/ui/screens/FuelTrackingScreen.tsx');
  const history=source('src/ui/components/fuel/FuelHistoryView.tsx');
  const usage=source('src/ui/components/fuel/FuelUsageView.tsx');
  const parts=source('src/ui/components/fuel/FuelBatchParts.tsx');
  it('replaces the flat History list with a summary and one card per day holding deliveries, dip readings and fills',()=>{
    expect(screen).toContain('<FuelHistoryView');
    expect(screen).not.toContain('Movement history ·');
    inOrder(history,['title="Fuel history"','label="Delivered in"','label="Filled out"','label="Dip adjustments"','label="Diesel in tank"','title="Records by day"']);
    expect(history).toContain("title:'DELIVERIES IN'");
    expect(history).toContain("title:'DIP READINGS'");
    expect(history).toContain('onSelectRow={open}');
  });
  it('shows the History filters as removable chips with Clear all',()=>{
    expect(screen).toContain('historyChips.map');
    expect(screen).toContain('Remove filter ${label}');
  });
  it('strikes cancelled records through with their reason and lets every row open its record',()=>{
    expect(parts).toContain("textDecorationLine:'line-through'");
    expect(parts).toContain('Cancelled · {reason??');
    expect(parts).toContain('accessibilityHint="Opens this record"');
  });
  it('replaces the old Usage blocks with the project-view layout for every destination',()=>{
    expect(screen).toContain('<FuelUsageView');
    inOrder(usage,["'Fuel used by destination'",'Total fuel used','From tank · batches','From tank · before batches','Outside stations','Fuel cost','title="By destination"','title="By source"','title="Filter fuel usage"','title="Fills by day"','<DieselPdfExportPanel']);
    expect(usage).toContain('byDestination:true');
  });
  it('lets a project, site or Unassigned be tapped to show only its fills and export its own PDF',()=>{
    expect(usage).toContain('onPress={()=>setChosen(total)}');
    expect(usage).toContain("chosen.type==='project'?{projectId:");
    expect(usage).toContain("{companySiteId:");
    expect(usage).toContain('{unassigned:true}');
    expect(usage).toContain('Show all destinations');
    expect(usage).toContain('Export ${chosen.type===');
  });
});

describe('Diesel Batch Report header',()=>{
  it('prints the company from Company Settings with its logo',()=>{
    expect(source('src/ui/screens/FuelTrackingScreen.tsx')).toContain('exportAndShareDieselBatchReport(report,company??await repository.getCompanyIdentity())');
    expect(source('src/services/documentExport.ts')).toContain('const logo=await imageUriToDataUrl(company.logoUri)');
    expect(source('src/services/dieselBatchTemplate.ts')).not.toContain('Plant Management');
  });
});
