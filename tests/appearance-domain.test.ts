import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import {
  DEFAULT_SKYLINE_STYLE,
  SKYLINE_IMAGE_KEY,
  SKYLINE_IMAGE_MAX_CHARS,
  SKYLINE_STYLES,
  SKYLINE_STYLE_KEY,
  isSkylineImageValue,
  parseSkylineStyle,
  resolveSkylineStyle,
  skylineOptions,
} from '../src/domain/appearance';

const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

describe('Home skyline appearance (DEC-530)',()=>{
  it('offers every style exactly once, in a fixed order, with the full skyline first',()=>{
    expect(skylineOptions.map(option=>option.style)).toEqual([...SKYLINE_STYLES]);
    expect(skylineOptions[0]!.style).toBe('full');
    expect(new Set(skylineOptions.map(option=>option.label)).size).toBe(skylineOptions.length);
  });

  it('falls back to the full skyline for a missing or unknown saved value',()=>{
    expect(DEFAULT_SKYLINE_STYLE).toBe('full');
    expect(parseSkylineStyle(null)).toBe('full');
    expect(parseSkylineStyle(undefined)).toBe('full');
    expect(parseSkylineStyle('')).toBe('full');
    expect(parseSkylineStyle('sunset')).toBe('full');
    for(const style of SKYLINE_STYLES)expect(parseSkylineStyle(style)).toBe(style);
  });

  it('accepts only a small image data URL as the owner picture',()=>{
    const png='data:image/png;base64,iVBORw0KGgo=';
    expect(isSkylineImageValue(png)).toBe(true);
    expect(isSkylineImageValue('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isSkylineImageValue(null)).toBe(false);
    expect(isSkylineImageValue('file:///data/user/0/photo.png')).toBe(false);
    expect(isSkylineImageValue('data:text/html;base64,PGh0bWw+')).toBe(false);
    expect(isSkylineImageValue(`data:image/png;base64,${'A'.repeat(SKYLINE_IMAGE_MAX_CHARS)}`)).toBe(false);
  });

  it('draws the full skyline instead of an empty header when My own picture has no usable picture',()=>{
    const png='data:image/png;base64,iVBORw0KGgo=';
    expect(resolveSkylineStyle('custom',null)).toBe('full');
    expect(resolveSkylineStyle('custom','not-an-image')).toBe('full');
    expect(resolveSkylineStyle('custom',png)).toBe('custom');
    expect(resolveSkylineStyle('hidden',null)).toBe('hidden');
    expect(resolveSkylineStyle('quarry',null)).toBe('quarry');
  });

  it('keeps both saved keys inside the dromex. namespace so a backup carries them',()=>{
    expect(SKYLINE_STYLE_KEY.startsWith('dromex.')).toBe(true);
    expect(SKYLINE_IMAGE_KEY.startsWith('dromex.')).toBe(true);
    const backup=source('src/data/repositories/SqliteBackupRepository.ts');
    expect(backup).toContain("key.startsWith('dromex.')");
  });
});

// Static contract checks: there is no React Native renderer in the test stack.
describe('Appearance screens and the Home header (DEC-530, DEC-532)',()=>{
  const home=source('src/ui/screens/HomeScreen.tsx');
  const app=source('src/ui/DromexApp.tsx');
  const hub=source('src/ui/screens/WorkspaceHubScreen.tsx');
  const screen=source('src/ui/screens/AppearanceScreen.tsx');

  it('removes Search and the Offline ready badge from Home while keeping Account & Cloud and Global Search reachable',()=>{
    expect(home).not.toContain('onSearch');
    expect(home).not.toContain('Offline ready');
    expect(home).not.toContain('accessibilityLabel="Search"');
    expect(home).not.toContain('searchButton');
    expect(home).toContain('title="Account & Cloud"');
    expect(hub).toContain('title="Global Search"');
  });

  it('puts PLANT MANAGEMENT under the logo and the date as plain text',()=>{
    expect(home).toContain('<View style={styles.brandColumn}><DromexWordmark');
    expect(home.indexOf('PLANT MANAGEMENT')).toBeGreaterThan(home.indexOf('<DromexWordmark logoUri={companyLogoUri}/>'));
    expect(home).toContain('styles.dateColumn');
  });

  it('opens Appearance from the Home Setup list and the More hub, and routes it in the app',()=>{
    expect(home).toContain('title="Appearance"');
    expect(hub).toContain('title="Appearance"');
    expect(app).toContain("screen==='appearance'");
    expect(app).toContain('<AppearanceScreen onBack={()=>goBack(');
  });

  it('saves each choice as soon as it is tapped, with no database change',()=>{
    expect(screen).toContain('saveSkylineStyle(style)');
    expect(screen).not.toContain('AppButton label="Save');
    expect(source('src/data/database/migrations.ts')).not.toContain('appearance');
  });
});
