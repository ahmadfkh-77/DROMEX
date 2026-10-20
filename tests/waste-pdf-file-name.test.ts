import {describe,expect,it} from 'vitest';

describe('the Waste Dump History file name',()=>{
  const read=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;
  it('always ends in .pdf, because a shared file with no ending opens as an unknown file ("file corrupt")',()=>{
    const view=read('src/ui/components/WasteHistoryView.tsx'),exporter=read('src/services/documentExport.ts');
    expect(view).toContain("range.fromDate}.pdf`");
    expect(exporter).toContain(String.raw`/\.pdf$/i.test(input.fileName)?input.fileName:`+'`${input.fileName}.pdf`');
  });
  it('is the only report share that was missing the ending: every other export names its file with .pdf',()=>{
    const exporter=read('src/services/documentExport.ts');
    expect(exporter.match(/saveAndShare\(/g)!.length).toBeGreaterThan(10);
    expect(exporter).not.toMatch(/saveAndShare\(buildWasteHistoryHtml\(\{\.\.\.input,logo\}\),input\.fileName,/);
  });
});
