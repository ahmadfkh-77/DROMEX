import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import {ANDROID_VERSION_CODE,APP_VERSION,appVersionLabel} from '../src/appVersion';

/**
 * DEC-475. The Home screen shows the release identity, and `src/appVersion.ts` has to restate it
 * because `resolveJsonModule` is off. These tests are what make that duplication safe: bumping the
 * release in app.json or package.json without updating appVersion.ts fails the suite.
 */
const readJson=(path:string)=>JSON.parse(readFileSync(join(__dirname,'..',path),'utf8')) as Record<string,unknown>;

describe('the displayed app version matches the release metadata',()=>{
  it('agrees with app.json',()=>{
    const app=readJson('app.json') as {expo:{version:string;android:{versionCode:number}}};
    expect(APP_VERSION).toBe(app.expo.version);
    expect(ANDROID_VERSION_CODE).toBe(app.expo.android.versionCode);
  });

  it('agrees with package.json',()=>{
    expect(APP_VERSION).toBe((readJson('package.json') as {version:string}).version);
  });

  it('formats one readable label',()=>{
    expect(appVersionLabel()).toBe(`v${APP_VERSION} · build ${ANDROID_VERSION_CODE}`);
    expect(appVersionLabel()).toMatch(/^v\d+\.\d+\.\d+ · build \d+$/);
  });

  it('is shown on the Home screen',()=>{
    const home=readFileSync(join(__dirname,'..','src/ui/screens/HomeScreen.tsx'),'utf8');
    expect(home).toContain('appVersionLabel');
  });
});
