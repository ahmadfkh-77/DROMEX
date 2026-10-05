import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract checks: there is no React Native renderer in the test stack.
const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');

describe('Load No. on the in-app receipt preview (DEC-504)',()=>{
  const documents=source('src/ui/components/LoadDocuments.tsx');
  const screen=source('src/ui/screens/MakeReceiptScreen.tsx');

  it('shows Load No. directly above Transaction, only when the load has a number',()=>{
    expect(documents).toContain('loadNumber?: string | null');
    expect(documents).toContain('{data.loadNumber ?');
    expect(documents.indexOf('label="Load No."')).toBeGreaterThan(0);
    expect(documents.indexOf('label="Load No."')).toBeLessThan(documents.indexOf('label="Transaction"'));
  });
  it('passes the saved number for a confirmed load and the number to be issued for a draft',()=>{
    expect(screen).toContain('loadNumber: record.loadNumber ?? null');
    expect(screen).toContain('nextNumber?.loadNumber ?? null');
    expect(screen).toContain('loadNumber, transactionNumber:');
  });
  it('uses the comfortable row spacing',()=>{
    expect(documents).toContain('padding: 16, gap: 3');
    expect(documents).toContain('gap: 8, paddingVertical: 4');
    expect(documents).toContain('marginVertical: 9');
  });
});
