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
  it('opens Contract Quantities from the Command Center and the item form from the project page',()=>{
    expect(app).toContain("screen==='contractQuantities'&&commandProject");
    expect(app).toContain("screen==='contractItemForm'&&commandProject");
    expect(app).toContain("onContracts:()=>navigate('contractQuantities')");
    expect(app).toContain('loadRepository={loadRepository} contracts={contractRepository} ');
  });
});

describe('Command Center card',()=>{
  it('is a closed-by-default section titled Contract Quantities, shown only when the repository is passed',()=>{
    expect(center).toContain('title="Contract Quantities"');
    expect(center).toContain("open={open.has('contracts')}");
    expect(center).toContain('{contracts&&routes.onContracts?<ExpandableMenuSection');
    expect(center).toContain('title="Open Contract Quantities"');
    expect(center).toContain('No contract items yet · add the tender quantities to follow them.');
  });
});

describe('project page',()=>{
  it('has the empty state, the summary from the domain, and the Add button',()=>{
    expect(page).toContain('title="No contract items yet"');
    expect(page).toContain('label="+ Add contract item"');
    for(const field of ['summary.overallPercentUsed','summary.completeCount','summary.itemCount','summary.totalSavingUsd','summary.overruns.length'])expect(page).toContain(field);
  });
  it('does no arithmetic of its own',()=>{
    for(const source of [page,parts])expect(source).not.toMatch(/\.reduce\(|usage\.used\s*[-+*/]|\.quantity\s*[-+*/]/);
  });
});

describe('item card parts',()=>{
  it('never draws the bar past its end and says Over contract in words',()=>{
    expect(parts).toContain('Math.min(100,Math.max(0,usage.percentUsed))');
    expect(parts).toContain("'Over contract'");
    expect(parts).toContain("label:'Over by'");
  });
  it('keeps the work status and the quantity used in two separate boxes (honesty rule)',()=>{
    expect(parts).toContain('>WORK<');
    expect(parts).toContain('>QUANTITY USED<');
    expect(parts).toContain('of contract');
  });
});

describe('contract item form',()=>{
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
