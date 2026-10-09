import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks. The project has no React Native renderer in its test stack, so these read
// the component source to pin the accessibility, touch-target, reduced-motion, and wording rules the
// Fuel Destination feature must keep. Behaviour itself is covered by the domain and repository tests.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

describe('Fuel Destination UI contract',()=>{
  const screen=source('src/ui/screens/FuelTrackingScreen.tsx');
  const choice=source('src/ui/components/ChoiceField.tsx');
  // The Usage tab moved to the approved day-card design (DEC-505, amended 2026-10-03).
  const usage=source('src/ui/components/fuel/FuelUsageView.tsx');
  const parts=source('src/ui/components/fuel/FuelBatchParts.tsx');
  const sites=source('src/ui/components/CompanySitesManager.tsx');
  const destination=source('src/ui/components/FuelDestinationFields.tsx');

  it('replaces the fill-form Project field with Fuel destination and conditional selectors',()=>{
    expect(screen).not.toContain('label="Project (optional)"');
    // The fill form moved into FuelFillForm (DEC-505); the screen keeps the correction form.
    expect(screen.match(/<FuelDestinationFields/g)?.length).toBe(1);
    expect(source('src/ui/components/fuel/FuelFillForm.tsx').match(/<FuelDestinationFields/g)?.length).toBe(1);
    expect(destination).toContain('"Fuel destination *"');
    expect(destination).toContain('label="Select project *"');
    expect(destination).toContain('label="Select company site *"');
  });

  it('retires the inaccurate Fuel cost by project wording',()=>{
    expect(screen).not.toMatch(/Fuel cost by project/i);
    expect(usage).toContain('Fuel used by destination');
  });

  it('makes the destination choice an accessible, 48dp, reduced-motion-safe radio group',()=>{
    expect(choice).toContain('accessibilityRole="radiogroup"');
    expect(choice).toContain('accessibilityRole="radio"');
    expect(choice).toMatch(/accessibilityState=\{\{\s*checked/);
    expect(choice).toMatch(/accessibilityState=\{\{\s*expanded/);
    expect(choice).toMatch(/minHeight:\s*48/);
    expect(choice).toContain('useReducedMotion');
  });

  it('shows unpriced usage as Unpriced, never $0.00, with 48 pt targets and reduced-motion-safe groups',()=>{
    expect(usage).toContain("'Unpriced'");
    expect(usage).toContain('Unpriced</Text>');
    expect(usage).not.toContain('$0.00');
    expect(usage).toMatch(/destRow:\{minHeight:48/);
    expect(parts).toContain('useReducedMotion');
    expect(parts).toMatch(/accessibilityState=\{\{expanded:open\}\}/);
  });

  it('gives every site action an accessible label and a 48dp target',()=>{
    expect(sites).toMatch(/accessibilityLabel=\{`Rename /);
    expect(sites).toMatch(/accessibilityLabel=\{`(Deactivate|\$\{)/);
    expect(sites).toMatch(/minHeight:\s*48/);
    expect(sites).not.toMatch(/delete/i);
  });
});
