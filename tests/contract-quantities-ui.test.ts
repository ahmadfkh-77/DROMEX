import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// DEC-522 Phase D1. Static contract checks, following the established pattern: no React Native renderer is available, so these pin the
// wiring, the wording and the rule that the screens do no arithmetic. Calculations are covered by the domain and repository suites.
const read=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');
const app=read('src/ui/DromexApp.tsx');
const center=read('src/ui/screens/ProjectCommandCenterScreen.tsx');
const page=read('src/ui/screens/ContractQuantitiesScreen.tsx');
const form=read('src/ui/screens/ContractItemFormScreen.tsx');
const parts=read('src/ui/components/contracts/ContractParts.tsx');

describe('navigation',()=>{
  it('opens Quantity Targets from the Command Center and the item form from the project page',()=>{
    expect(app).toContain("screen==='contractQuantities'&&commandProject");
    expect(app).toContain("screen==='contractItemForm'&&commandProject");
    expect(app).toContain("onContracts:()=>navigate('contractQuantities')");
    expect(app).toContain('loadRepository={loadRepository} contracts={contractRepository} ');
  });
});

describe('Command Center card',()=>{
  it('is a closed-by-default section titled Quantity Targets, shown only when the repository is passed',()=>{
    expect(center).toContain('title="Quantity Targets"');
    expect(center).toContain("open={open.has('contracts')}");
    expect(center).toContain('{contracts&&routes.onContracts?<ExpandableMenuSection');
    expect(center).toContain('title="Open Quantity Targets"');
    expect(center).toContain('No targets yet · add the tender quantities to follow them.');
  });
});

describe('project page',()=>{
  it('has the empty state, the summary from the domain, and the Add button',()=>{
    expect(page).toContain('title="No targets yet"');
    expect(page).toContain('label="+ Add target"');
    for(const field of ['summary.overallPercentUsed','summary.completeCount','summary.itemCount','summary.totalSavingUsd','summary.overruns.length'])expect(page).toContain(field);
  });
  it('does no arithmetic of its own',()=>{
    for(const source of [page,parts])expect(source).not.toMatch(/\.reduce\(|usage\.used\s*[-+*/]|\.quantity\s*[-+*/]/);
  });
});

describe('item card parts',()=>{
  it('never draws the bar past its end and says Over target in words',()=>{
    expect(parts).toContain('Math.min(100,Math.max(0,usage.percentUsed))');
    expect(parts).toContain("'Over target'");
    expect(parts).toContain("label:'Over by'");
  });
  it('keeps the work status and the quantity used in two separate boxes (honesty rule)',()=>{
    expect(parts).toContain('>WORK<');
    expect(parts).toContain('>QUANTITY USED<');
    expect(parts).toContain('of target');
  });
});

describe('target form',()=>{
  it('validates with the domain rules, shows both units, and keeps Save disabled until the item is valid',()=>{
    expect(form).toContain('validateContractItemDraft(draft)');
    expect(form).toContain('material · item');
    expect(form).toContain('disabled={!canSave}');
    expect(form).toContain('Nothing is converted.');
  });
  it('asks for a reason once loads or adjustments count, shows what changes, and cancels with a reason instead of deleting',()=>{
    expect(form).toContain('detail?.editNeedsReason');
    expect(form).toContain('contractChangeLines(');
    expect(form).toContain('label="Reason for the change *"');
    expect(form).toContain('contracts.cancelItem(');
    expect(form).not.toMatch(/contracts.delete|DELETE FROM/);
  });
});

describe('Phase D2: the item page',()=>{
  const itemPage=read('src/ui/screens/ContractItemScreen.tsx');
  const sheets=read('src/ui/components/contracts/ContractItemSheets.tsx');
  it('is reached from a project-page card, and Edit item opens the form',()=>{
    expect(app).toContain("onOpenItem={id=>{setContractItemId(id);navigate('contractItem');}}");
    expect(app).toContain("screen==='contractItem'&&commandProject&&contractItemId");
    expect(app).toContain("onEdit={()=>navigate('contractItemForm')}");
  });
  it('opens a load through the existing screens: the reasoned correction to edit, the load itself to open',()=>{
    expect(app).toContain("setCorrectionLoadId(load.id);navigate('loadCorrections');");
    expect(app).toContain("navigate(load.source==='company'?'loads':'quarry')");
  });
  it('keeps From loads, Adjustments and Used apart, and the work status apart from the quantity used',()=>{
    for(const text of ['label={`From loads (','label={`Adjustments (','label="Used"','<ContractWorkAndUse'])expect(itemPage).toContain(text);
  });
  it('groups the loads counted by day with the domain helper, filters by source, and offers Link older loads',()=>{
    expect(itemPage).toContain('groupContractLoadsByDay(detail.item,');
    expect(itemPage).toContain("{id:'company' as const,label:'Company'}");
    expect(itemPage).toContain('label="Link older loads"');
    expect(itemPage).toContain("{open?'×':'+'}");
  });
  it('does no arithmetic of its own',()=>{
    for(const source of [itemPage,sheets])expect(source).not.toMatch(/\.reduce\(|usage\.used\s*[-+*/]|\.quantity\s*[-+*/]|leftover\s*\*/);
  });
  it('asks for a reason in every dialog that changes the record, and Finish says Used does not change',()=>{
    expect(sheets.split('label="Reason *"').length-1).toBe(4);
    expect(sheets).toContain('adjustmentPreview(usage,direction,amount)');
    expect(sheets).toContain('The used quantity does not change.');
    expect(sheets).toContain('the load itself is never deleted.');
    expect(sheets).toContain('label="Edit load (correction with a reason)"');
  });
});

describe('Phase E: the export sheet',()=>{
  const sheet=read('src/ui/components/contracts/ContractExportSheet.tsx');
  it('offers the same options as the other PDFs: Header company and Customize header (shared picker), then Without or With prices, Without by default',()=>{
    expect(sheet).toContain('useExportHeader(project.id)');
    expect(sheet).toContain('{picker}');
    expect(sheet).toContain("useState<'without'|'with'>('without')");
    expect(sheet).toContain('label="Export PDF"');
    expect(sheet).toContain('label="Export Excel"');
  });
  it('falls back to Company Settings when no header company is chosen, and is opened from the project page',()=>{
    expect(sheet).toContain('contracts.getCompanyIdentity()');
    expect(page).toContain('label="Export report (PDF / Excel)"');
    expect(page).toContain('<ContractExportSheet');
  });
});
