import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks: there is no React Native renderer in the test stack. The lines, totals and target rules are covered by
// load-correction-page.test.ts and company-load-correction-target.test.ts.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

describe('DEC-536 Company Load correction page (static checks)',()=>{
  const page=source('src/ui/components/LoadCorrectionPage.tsx');
  const form=source('src/ui/components/LoadCorrectionForm.tsx');
  const screen=source('src/ui/screens/LoadCorrectionsScreen.tsx');
  const app=source('src/ui/DromexApp.tsx');
  const supplier=source('src/ui/components/SupplierLoadCorrectionPage.tsx');

  it('is the same page and workflow as the Supplier Load correction: a list, one sheet per line, a bar with Back and Review',()=>{
    for(const text of ['Tap Edit on a line to correct it.','openSheet(line.sheet)','loadCorrectionBarLabel(changeCount)','Review changes','Save correction','Leave without saving?','Keep editing','Cancel this load','Entered by mistake or a duplicate?','sheetIssues','discardSheet'])expect(page).toContain(text);
    for(const text of ['Tap Edit on a line to correct it.','Review changes','Leave without saving?','Cancel this load','discardSheet'])expect(supplier).toContain(text);
    expect(page).toContain('disabled={busy || !changeCount}');
  });

  it('shows a changed line with the old value crossed out beside the new one, and a locked line as Locked',()=>{
    expect(page).toContain('<Text style={styles.was}>{original?.value ?? was.was}  </Text>');
    expect(page).toContain("line.locked ? '  Locked' : '  Edit'");
    expect(page).toContain('disabled={line.locked}');
  });

  it('has a sheet for every line, with Make Receipt controls',()=>{
    for(const key of ["case 'date'","case 'customer'","case 'place'","case 'item'","case 'target'","case 'quantity'","case 'conversion'","case 'driver'","case 'truck'","case 'price'","case 'notes'","case 'signatures'","case 'preview'"])expect(form).toContain(key);
    expect(form).toContain('<OpenSwitch label="Delivered to *" options={[{id:\'project\' as const,label:\'Project\'},{id:\'address\' as const,label:\'Other address\'}]}');
    expect(form).toContain('<SegmentedChoice mode="tabs" options={crewFilterOptions}');
    expect(form).toContain("{id:'operator' as const,label:'Operators',count:");
    expect(form).toContain('Load-enabled item *');
  });

  it('adds Counts toward target, offering only the targets of the corrected project and item, and dropping a stale choice',()=>{
    expect(form).toContain('contracts.candidatesFor(effective.projectId||null,effective.itemId)');
    expect(form).toContain("onSelect={id=>set('contractItemId',id)} allowClear");
    expect(form).toContain('const resetTarget={contractItemId:undefined}');
    for(const handler of ['function selectProject','function selectItem','function chooseDestMode'])expect(form.slice(form.indexOf(handler),form.indexOf(handler)+260)).toContain('resetTarget');
    expect(form).toContain('correctionChanges(selected,form,options,signerLabel,targetChange)');
  });

  it('uses the bigger pad and fits the strokes into the printed box before saving and previewing',()=>{
    expect(form).toContain('<SignaturePad large value={form.driverSignaturePaths??[]}');
    expect(form).toContain('fitSignatureToBox(value.driverSignaturePaths)');
    expect(form).toContain('repository.correctLoad(selected.id,fitted(form))');
    expect(form).toContain('correctionToLoadDraft(selected,fitted(form))');
    expect(form).toContain('onSigningChange={setSigning}');
    expect(page).toContain('scrollEnabled={!signing}');
  });

  it('previews the receipt and the Delivery Authorization with the corrected values, and saves nothing',()=>{
    expect(form).toContain('<LoadDocuments data={previewData()} isDraft/>');
    expect(form).toContain('draftDocument(options!,eff,calc,selected.loadNumber??null)');
    expect(page).toContain('Preview documents · Receipt and Authorization');
    const preview=form.slice(form.indexOf('function previewData'),form.indexOf('function renderSheet'));
    expect(preview).not.toContain('repository.');
  });

  it('cancels a load with a reason, keeps the existing no-reactivation rule, and returns to a read-only cancelled load',()=>{
    for(const text of ['Cancel this confirmed load?','there is no reactivation','Cancellation reason *','Keep load active','Cancel Load'])expect(page).toContain(text);
    expect(form).toContain('repository.cancelLoad(selected.id,reason)');
    expect(screen).toContain("setStage('blocked')");
    expect(screen).toContain('This load is now cancelled. It remains fully visible in Load History.');
    expect(page).not.toContain('Reactivate');
  });

  it('keeps the payment locks, the saved original and the same saving call',()=>{
    expect(form).toContain('correctionLocks(payments)');
    expect(form).toContain('validateLoadCorrection(selected,form,options,payments)');
    expect(form).toContain('LOCKED · PAYMENTS');
    expect(page).toContain('ORIGINAL SAVED · VERSION');
  });

  it('fills the screen like the supplier page and receives the targets',()=>{
    expect(screen).toContain("if(stage==='edit'&&selected)return <LoadCorrectionForm");
    expect(screen).toContain('contracts={contracts}');
    expect(app).toContain('contracts={contractRepository} initialLoadId={correctionLoadId}');
  });

  it('needs no database change',()=>{
    expect(source('src/data/database/migrations.ts')).not.toContain('DEC-536');
  });
});
