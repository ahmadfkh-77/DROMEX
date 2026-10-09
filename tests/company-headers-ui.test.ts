import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';

import {HEADER_COMPANY_LABELS,HEADER_PICKER_HELPER} from '../src/domain/companyHeaders';

/** Phase 1. The Header company picker is one shared component, worded identically wherever it appears. */
const read=(file:string)=>readFileSync(file,'utf8');
const sourceFiles=(dir:string):string[]=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?sourceFiles(path):/\.tsx?$/.test(name)?[path]:[];});

describe('Header company picker',()=>{
  it('uses the approved wording and the two choices',()=>{
    expect(HEADER_PICKER_HELPER).toBe('Its name, logo, contact details and signature go on this PDF. Records and numbers do not change. Remembered for this project.');
    expect(HEADER_COMPANY_LABELS).toEqual({plant:'Plant Company',project:'Project Company'});
    const picker=read('src/ui/components/HeaderCompanyPicker.tsx');
    expect(picker).toContain('Header company');
    expect(picker).toContain('Use for every export in this project');
    expect(picker).toContain('Project Company is not set up');
  });

  it('is defined once: no other file draws a "Header company" heading',()=>{
    const definers=sourceFiles('src/ui').filter(file=>read(file).includes('>Header company<'));
    expect(definers.map(file=>file.split('\\').join('/'))).toEqual(['src/ui/components/HeaderCompanyPicker.tsx']);
  });

  it('is used by the Totals Export PDF sheet, which resolves the chosen header without touching figures',()=>{
    const explorer=read('src/ui/components/totals/TotalsExplorer.tsx');
    expect(explorer).toContain('<HeaderCompanyPicker');
    expect(explorer).toContain('headers.resolveHeader(headerKind)');
    expect(explorer).toContain('setProjectHeaderDefault');
  });

  it('keeps the Plant Company as the existing Company profile and adds the Project Company beside it',()=>{
    const app=read('src/ui/DromexApp.tsx');
    expect(app).toContain("onOpenPlant={()=>navigate('settings')}");
    expect(app).toContain("onOpenProject={()=>navigate('projectCompany')}");
    const settings=read('src/ui/screens/SettingsScreen.tsx');
    expect(settings).toContain('title="Plant Company"');
    expect(settings).toContain('saveCompanySettings(draft)');
  });
});
