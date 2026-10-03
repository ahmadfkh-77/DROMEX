import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks, as for the other fuel screens: the project has no React Native renderer in its
// test stack, so these read the component source to pin the approved Screen B design (DEC-492). The
// wording and numbers themselves are covered by fuel-fill-form.test.ts.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

describe('Record Fill form (approved Screen B)',()=>{
  const form=source('src/ui/components/fuel/FuelFillForm.tsx');
  const screen=source('src/ui/screens/FuelTrackingScreen.tsx');

  it('is five numbered step cards in the approved order',()=>{
    const order=['title="Fuel source"','title="Batch"','title="Equipment"','title="Destination"','title="Quantity and date"'].map(title=>form.indexOf(title));
    expect(order.every(index=>index>=0)).toBe(true);
    expect([...order].sort((a,b)=>a-b)).toEqual(order);
    expect(form).toContain('title="Station"');
    expect(form).toMatch(/number=\{1\}/);expect(form).toMatch(/number=\{5\}/);
    expect(form).toContain('title.toUpperCase()');
  });

  it('offers From tank and Outside station as one segmented choice with the approved labels',()=>{
    expect(form).toContain('label="Fuel source *"');
    expect(form).toContain("label:'From tank'");
    expect(form).toContain("label:'Outside station'");
  });

  it('pre-selects the oldest open batch, says so, and lets the user change it',()=>{
    expect(form).toContain('label="Batch *"');
    expect(form).toContain('Pre-selected automatically. You can change it to another open batch.');
    expect(form).toContain('draft.batchId||oldest');
    expect(form).toContain('id===oldest?');
  });

  it('chooses the station from a saved list, with an inline add, and never from free text',()=>{
    expect(form).toContain('label="Station *"');
    expect(form).toContain('+ Add new station');
    expect(form).toContain('createFuelStation');
    expect(form).toContain('Receipt number (optional)');
    expect(form).toContain('Price (optional · cost history only)');
    expect(form).toContain('placeholder="Unpriced"');
  });

  it('chooses equipment only from saved profiles',()=>{
    expect(form).toContain('label="Equipment type *"');
    expect(form).toMatch(/SearchableSelect label=\{`\$\{draft\.equipmentType==='truck'\?'Truck':'Machine'\} \*`\}/);
    expect(form).not.toMatch(/AppField label="(Machine|Truck|Equipment)/);
  });

  it('keeps one destination, as DEC-438 says, and shows a locked project on a project screen',()=>{
    expect(form).toContain('<FuelDestinationFields');
    expect(form).toContain('Fuel destination (locked)');
  });

  it('puts litres and date side by side, with odometer and note optional',()=>{
    expect(form).toContain('label="Litres *"');
    expect(form).toContain('label="Date *"');
    expect(form).toContain('Odometer (optional, reference only)');
    expect(form).toContain('placeholder="Not recorded"');
    expect(form).toContain('placeholder="Add a note"');
  });

  it('shows the Before you save panel with every line in words, an alert for an overfill, and Save Fill last',()=>{
    expect(form).toContain('BEFORE YOU SAVE');
    expect(form).toContain('accessibilityRole="alert"');
    expect(form).toContain('overfillMessage');
    expect(form).toContain('tankFillPreviewLines');
    expect(form).toContain('stationFillPreviewLines');
    const save=form.indexOf('label="Save Fill"');
    expect(save).toBeGreaterThan(form.indexOf('<Preview lines={stationLines}'));
    expect(save).toBeGreaterThan(form.indexOf('number={5}'));
    expect(form).toContain('tone="primary"');
  });

  it('keeps touch targets at 48 and never relies on colour alone for the overfill',()=>{
    expect(form).toMatch(/link:\{minHeight:48/);
    // The words live in the form logic so they are tested once and shared.
    const words=source('src/domain/fuelFillForm.ts');
    expect(words).toContain('Overfill Alert:');
    expect(words).toContain('still saved, with an Overfill Alert');
  });

  it('is used by the fuel screen, which keeps the correction form and adds a Stations tab',()=>{
    expect(screen).toContain('<FuelFillForm');
    expect(screen).not.toContain('title="Record equipment fill"');
    expect(screen).toContain("'stations'");
    expect(screen).toContain('<FuelStationsManager');
    expect(screen).toContain('getBatchOverview');
    expect(screen).toContain("tabLabel(value:Tab,locked?:string|null){");
  });
});

describe('Fuel Stations manager',()=>{
  const manager=source('src/ui/components/fuel/FuelStationsManager.tsx');
  it('deactivates and reactivates stations, never deletes them, and says there is no payment',()=>{
    expect(manager).toContain('Deactivate');
    expect(manager).toContain('Reactivate');
    expect(manager).not.toMatch(/delete/i);
    expect(manager).toContain('there is no payment or balance for a station');
    expect(manager).toContain('Fills already recorded from it keep showing its name.');
  });
  it('keeps renamed stations from rewriting the fills already recorded',()=>{
    expect(manager).toContain('Fills already recorded keep the name they were saved with.');
  });
  it('keeps 48 pt touch targets, an accessible inactive group, and reduced motion',()=>{
    expect(manager).toMatch(/minHeight:48/);
    expect(manager).toContain('useReducedMotion');
    expect(manager).toContain('accessibilityState={{expanded:inactiveOpen}}');
  });
});
