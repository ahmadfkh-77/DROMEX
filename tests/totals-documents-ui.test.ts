import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// DEC-487 static UI contracts. No React Native renderer is available, so these pin entry points,
// wording, accessible labels and the rules each screen must keep. Behaviour is covered by the domain,
// repository, PDF and backup suites.
const read=(path:string)=>existsSync(join(__dirname,'..',path))?readFileSync(join(__dirname,'..',path),'utf8'):'';
const app=read('src/ui/DromexApp.tsx');
const home=read('src/ui/screens/HomeScreen.tsx');
const hub=read('src/ui/screens/WorkspaceHubScreen.tsx');
const company=read('src/ui/screens/CompanyTotalsScreen.tsx');
const explorer=read('src/ui/components/totals/TotalsExplorer.tsx');
const parts=read('src/ui/components/totals/TotalsParts.tsx');
const start=read('src/ui/components/totals/DocumentStartSheet.tsx');
const review=read('src/ui/screens/documents/DocumentReviewScreen.tsx');
const documentScreen=read('src/ui/screens/documents/DocumentScreen.tsx');
const list=read('src/ui/screens/documents/DocumentsScreen.tsx');
const settings=read('src/ui/screens/documents/BusinessDocumentSettingsScreen.tsx');
const signers=read('src/ui/screens/documents/SignersScreen.tsx');
const series=read('src/ui/screens/LoadNumberSeriesScreen.tsx');
const loadTotals=read('src/ui/screens/CompanyLoadTotalsScreen.tsx');
const history=read('src/ui/screens/LoadHistoryScreen.tsx');
const corrections=read('src/ui/screens/LoadCorrectionsScreen.tsx');
const receipt=read('src/ui/screens/MakeReceiptScreen.tsx');
const panel=read('src/ui/components/RecordDocumentsPanel.tsx');
const newScreens=[company,explorer,parts,start,review,documentScreen,list,settings,signers,series,loadTotals,panel];

describe('entry points',()=>{
  it('puts Totals on Home as its own destination, and in the finance and setup groups',()=>{
    expect(home).toContain('onPress={props.onOpenTotals}');
    expect(home).toContain('accessibilityLabel="Totals.');
    for(const title of ['title="Invoices & Bills"','title="Company Load Totals"','title="Business documents"','title="Load number series"'])expect(home).toContain(title);
    for(const title of ['title="Totals"','title="Invoices & Bills"','title="Business documents"','title="Load number series"'])expect(hub).toContain(title);
    for(const route of ["screen==='companyTotals'","screen==='companyLoadTotals'","screen==='documents'","screen==='documentReview'","screen==='document'","screen==='documentSettings'","screen==='signers'","screen==='loadSeries'"])expect(app).toContain(route);
  });
  it('opens Invoices & Bills from every customer and supplier',()=>{
    expect(read('src/ui/screens/CustomersScreen.tsx')).toContain('Invoices & Bills');
    expect(read('src/ui/screens/QuarryPurchasesScreen.tsx')).toContain('Invoices & Bills — bills received and supplier statements');
    expect(app).toContain("openDocuments({side:'customer'");
    expect(app).toContain("openDocuments({side:'supplier'");
  });
  it('replaces the review with its draft so Back does not return to a saved review',()=>{
    expect(app).toContain("replaceWith('document')");
  });
});

describe('Company Totals',()=>{
  it('walks Material → Project → Supplier → records with Back stepping up one level',()=>{
    expect(company).toContain('stepUp(level,onBack,setLevel)');
    expect(explorer).toContain("title=\"By project\"");
    expect(explorer).toContain('title="Delivered by"');
    expect(explorer).toContain('title="Original records"');
    expect(explorer).toContain('Only projects with records for this material appear.');
  });
  it('shows every record’s document status in words, and aggregate summaries',()=>{
    expect(parts).toContain('inclusionLabel(state)');
    expect(parts).toContain('summarizeInclusionCounts(');
    expect(parts).toMatch(/pillDot/);
  });
  it('starts a document from current results, a date range or chosen records, for one party',()=>{
    for(const label of ["label:'Current results'","label:'Date range'","label:'Choose one by one'"])expect(start).toContain(label);
    expect(start).toContain('A document is for one customer or one supplier.');
    expect(start).toContain('will not be on this document');
    expect(start).toMatch(/does not check legal, tax or accounting requirements/);
    expect(start).not.toContain('<DatePickerField');
  });
  it('lets records be ticked for a document and opens each original record',()=>{
    expect(explorer).toContain("'Select records'");
    expect(explorer).toContain('Create document from ${selected.size} selected');
    expect(parts).toContain('accessibilityRole="checkbox"');
    expect(parts).toContain('accessibilityHint="Opens the original record"');
  });
});

describe('documents',()=>{
  it('reviews records before a draft exists, with unit totals and missing-price explanations',()=>{
    for(const text of ['Tick all','Untick all','Already on another document','Each unit is totalled on its own','have no recorded price','Save draft with'])expect(review).toContain(text);
    expect(review).toContain('reviewSplit(');
    expect(review).toContain('groupDocumentLines(');
  });
  it('asks before issuing, explains immutability, and needs a reason to cancel or discard',()=>{
    expect(documentScreen).toContain('Issued documents are permanent snapshots.');
    expect(documentScreen).toContain("label=\"Reason *\"");
    expect(documentScreen).toContain('disabled={!reason.trim()}');
    expect(documentScreen).toContain("'Discard draft'");
    expect(documentScreen).toContain("'Cancel document'");
  });
  it('shows Not configured honestly and never invents a currency',()=>{
    expect(documentScreen).toContain("'Not configured'");
    expect(documentScreen).toContain('USD — DROMEX records every amount in US dollars');
    expect(settings).toContain('Not configured — left off documents');
    expect(settings).toContain('Other currencies are not supported yet.');
  });
  it('labels payment status as live and never prints it',()=>{
    expect(documentScreen).toContain('Current payment status:');
    expect(documentScreen).toContain('never printed on the issued document');
  });
  it('uses plain-language tabs per party and the required filters',()=>{
    for(const tab of ["'Invoices issued'","'Customer statements'","'Bills received'","'Supplier statements'"])expect(list).toContain(tab);
    for(const label of ['label="Status"','label="Current payment"','label="Project"','label="Item"','accessibilityLabel="Search documents"'])expect(list).toContain(label);
  });
  it('locks scrolling while a signature is drawn and keeps signer history',()=>{
    expect(signers).toContain('scrollEnabled={!drawing}');
    expect(signers).toContain('onSigningChange={setDrawing}');
    expect(signers).toContain('listEvents(');
    expect(documentScreen).toContain('preserveAspectRatio="xMidYMid meet"');
  });
});

describe('Company Load Number Series',()=>{
  it('locks a used prefix, previews the format, and moves items between series',()=>{
    expect(series).toContain('Locked: loads already carry this prefix.');
    expect(series).toContain('Numbers will look like');
    expect(series).toContain('-00001');
    expect(series).toContain('The count never restarts.');
    expect(series).not.toContain('Numbering restarts each year');
    expect(series).toContain('now in {other.prefix}');
    expect(series).toContain('The default series is used by every item that has no series of its own.');
  });
  it('shows the load number on Make Company Load, Load History and Corrections, honestly for legacy loads',()=>{
    expect(receipt).toContain('Load number on confirmation');
    expect(receipt).toContain('previewNextLoadNumber(');
    expect(receipt).toContain('loadNumberLabel(record.loadNumber)');
    expect(history).toContain('loadNumberLabel(load.loadNumber)');
    expect(history).toContain('${load.loadNumber??\'\'}');
    expect(corrections).toContain('A correction never changes the load number.');
  });
  it('totals company loads by series or item, keeps cancelled loads apart, and exports a PDF',()=>{
    expect(loadTotals).toContain("label:'Number series'");
    expect(loadTotals).toContain('cancelled, not counted');
    expect(loadTotals).toContain('exportAndShareCompanyLoadTotals(');
  });
  it('shows document status on each original record from the shared links',()=>{
    expect(panel).toContain('inclusionFor([key])');
    expect(history).toContain('<RecordDocumentsPanel');
    expect(read('src/ui/screens/QuarryPurchasesScreen.tsx')).toContain('<RecordDocumentsPanel');
  });
});

describe('field-use quality floor',()=>{
  it('keeps explicit touch targets at 44 dp or more in every new screen',()=>{
    for(const source of newScreens)for(const match of source.matchAll(/minHeight:(\d+)/g))expect(Number(match[1])).toBeGreaterThanOrEqual(44);
  });
  it('uses no raw console output or debugger statements',()=>{
    for(const source of newScreens){expect(source).not.toMatch(/console\.(log|warn|error)/);expect(source).not.toContain('debugger');}
  });
});

describe('Totals PDF export',()=>{
  it('offers Export PDF on Company and Project Totals, asking Without prices or With prices',()=>{
    expect(explorer).toContain("label={exporting?'Preparing PDF…':'Export PDF'}");
    expect(explorer).toContain(`<SegmentedChoice label="Prices" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]}`);
    expect(explorer).toContain('label="Project column"');
    expect(explorer).toContain('primaryLabel="Export PDF"');
    expect(explorer).toContain('totals.getCompanyTotals(nodeFilters)');
    expect(company).toContain('profiles={profiles}');
    expect(read('src/ui/screens/ProjectTotalsScreen.tsx')).toContain('profiles={profiles}');
    expect(app).toContain('<CompanyTotalsScreen profiles={profileRepository}');
    expect(app).toContain('profiles={profileRepository} totals={companyTotalsRepository}');
  });
});

describe('Owner corrections after device testing',()=>{
  it('exports a Loads History with every record from the records level',()=>{
    expect(explorer).toContain("atRecords?totals.listRecords(nodeFilters,5000):Promise.resolve(undefined)");
    expect(explorer).toContain("atRecords?'Loads History'");
    expect(explorer).toContain('issuedTo:issuedTo(');
    expect(explorer).toContain('It is not an invoice or bill.');
  });
  it('shows each Totals item as its own card with space between',()=>{
    expect(parts).toContain('ledgerSeparate:{gap:10}');
    expect((explorer.match(/<Ledger separate/g)??[]).length).toBe(5);
    expect((explorer.match(/ card first=\{index===0\}/g)??[]).length).toBe(5);
  });
  it('returns to Totals when Back is pressed on a record opened from it, and never leaves Load History faded',()=>{
    expect(history).toContain('if(openedDirectly.current&&selected.id===initialLoadId)onBack();');
    expect(history).toContain("const listVisible=!selected&&source==='all';");
    expect(read('src/ui/screens/QuarryPurchasesScreen.tsx')).toContain('if(openedDirectly.current&&selected.id===initialPurchaseId){onBack();return;}');
  });
});

describe('fuel in the Project Totals PDF',()=>{
  it('offers a Fuel choice on the project’s top level and loads the fills only when chosen',()=>{
    expect(explorer).toContain('label="Fuel"');
    expect(explorer).toContain("{id:'leave',label:'Leave out'},{id:'include',label:'Include fuel list'}");
    expect(explorer).toContain("fuelChoiceShown?await loadFuelFills!({fromDate:filters.fromDate,toDate:filters.toDate}):undefined");
    expect(read('src/ui/screens/ProjectTotalsScreen.tsx')).toContain('loadFuelFills={range=>repository.listFuelFills(project.id,range)}');
  });
});
