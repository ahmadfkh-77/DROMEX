import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks, following fuel-destination-ui.test.ts: the test stack has no React Native
// renderer, so these read component source to pin structure, wording, accessibility and the rule that
// the UI never re-implements People logic. Behaviour is covered by people-domain and directory-profiles.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');
const exists=(path:string)=>existsSync(join(__dirname,'..',path));

describe('People & Equipment: one People directory (DEC-476)',()=>{
  const screen=source('src/ui/screens/PeopleEquipmentScreen.tsx');
  it('replaces the separate Workers and Drivers tabs with one People tab beside Trucks and Machines',()=>{
    expect(screen).toContain('<PeopleDirectory');
    expect(screen).toMatch(/<Tab label="People"/);
    expect(screen).toMatch(/<Tab label="Trucks"/);
    expect(screen).toMatch(/<Tab label="Machines"/);
    expect(screen).not.toMatch(/<Tab label="Workers"/);
    expect(screen).not.toMatch(/createWorker|createDriver|setWorkerActive|setDriverActive/);
  });
  it('keeps a clear route to Custom Directories from People & Equipment',()=>{
    expect(screen).toContain('onOpenCustomDirectories');
    expect(screen).toContain('Custom directories');
  });
});

describe('People directory component',()=>{
  it('exists as its own focused component with a shared editor sheet and segmented control',()=>{
    expect(exists('src/ui/components/PeopleDirectory.tsx')).toBe(true);
    expect(exists('src/ui/components/FocusedSheet.tsx')).toBe(true);
    expect(exists('src/ui/components/SegmentedChoice.tsx')).toBe(true);
  });
  const directory=exists('src/ui/components/PeopleDirectory.tsx')?source('src/ui/components/PeopleDirectory.tsx'):'';
  it('filters All, Workers, Drivers and Operators through the domain helpers, never its own arithmetic',()=>{
    for(const label of ["'All'",'personRolePluralLabels'])expect(directory).toContain(label);
    expect(directory).toContain('filterPeople(');
    expect(directory).toContain('peopleRoleCounts(');
    expect(directory).toContain('possibleDuplicatePersonIds(');
    expect(directory).not.toMatch(/toLocaleLowerCase/);
  });
  it('edits in a focused sheet with a single-select Role and one primary action',()=>{
    expect(directory).toContain('<FocusedSheet');
    expect(directory).toMatch(/<SegmentedChoice[^>]*label="Role \*"/);
    expect(directory).toContain('Add person');
    expect(directory).toContain('Save person');
  });
  it('asks for confirmation before any role change and explains the effect on history',()=>{
    expect(directory).toContain('describeRoleChange(');
    expect(directory).toMatch(/Alert\.alert\(\s*'Change role\?'/);
  });
  it('states the role and duplicate status in words, not colour alone, and keeps inactive people separate',()=>{
    expect(directory).toContain('personRoleLabels[person.role]');
    expect(directory).toContain('Possible duplicate');
    expect(directory).toContain('Inactive people');
  });
  it('shows a person\'s recorded role changes',()=>{
    expect(directory).toContain('roleHistory');
    expect(directory).toContain('Role history');
  });
});

describe('shared primitives',()=>{
  const segmented=exists('src/ui/components/SegmentedChoice.tsx')?source('src/ui/components/SegmentedChoice.tsx'):'';
  const sheet=exists('src/ui/components/FocusedSheet.tsx')?source('src/ui/components/FocusedSheet.tsx'):'';
  it('makes the segmented choice an accessible radio group with 48dp targets',()=>{
    expect(segmented).toContain("accessibilityRole=\"radiogroup\"");
    expect(segmented).toContain("accessibilityRole={mode==='tabs'?'tab':'radio'}");
    expect(segmented).toContain('minHeight:48');
  });
  it('keeps the sheet keyboard-safe and reduced-motion aware',()=>{
    expect(sheet).toContain("animationType={reducedMotion?'none':'slide'}");
    expect(sheet).toContain('KeyboardAvoidingView');
    expect(sheet).toContain('keyboardShouldPersistTaps="handled"');
  });
});
