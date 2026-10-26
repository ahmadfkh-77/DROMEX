import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

const root=join(__dirname,'..');
const config=JSON.parse(readFileSync(join(root,'app.json'),'utf8')) as {expo:{icon:string;android:{adaptiveIcon:{foregroundImage:string;monochromeImage:string;backgroundColor:string}}}};
const png=(relative:string)=>{const bytes=readFileSync(join(root,relative));return{signature:bytes.subarray(1,4).toString('latin1'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),colorType:bytes[25]!};};

/** DEC-535: the asphalt-plant app icon. A PNG colour type of 2 is RGB (no transparency) and 6 is RGBA. */
describe('app icon (DEC-535)',()=>{
  it('uses the asphalt-plant icon files, all square 1024 PNGs',()=>{
    const {icon,android:{adaptiveIcon}}=config.expo;
    expect(icon).toBe('./assets/dromex-icon.png');
    expect(adaptiveIcon.foregroundImage).toBe('./assets/dromex-icon-foreground.png');
    expect(adaptiveIcon.monochromeImage).toBe('./assets/dromex-icon-monochrome.png');
    for(const path of [icon,adaptiveIcon.foregroundImage,adaptiveIcon.monochromeImage]){
      const info=png(path.replace('./',''));
      expect(info.signature).toBe('PNG');
      expect([info.width,info.height]).toEqual([1024,1024]);
    }
  });

  it('keeps the main icon opaque (iOS rejects transparency) and the adaptive layers transparent',()=>{
    expect(png('assets/dromex-icon.png').colorType).toBe(2);
    expect(png('assets/dromex-icon-foreground.png').colorType).toBe(6);
    expect(png('assets/dromex-icon-monochrome.png').colorType).toBe(6);
  });

  it('puts the navy behind the adaptive icon',()=>{
    expect(config.expo.android.adaptiveIcon.backgroundColor).toBe('#0B2A5B');
  });
});
