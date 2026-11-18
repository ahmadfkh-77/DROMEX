import * as fs from 'node:fs';
import {describe,expect,it} from 'vitest';

/** Wiring of the Bitumen Record Fill screens (DEC-557) against the approved mockup. The numbers and words are tested in bitumen-fill-views.test.ts. */
const read=(file:string)=>fs.readFileSync(file,'utf8');
const screen=read('src/ui/screens/BitumenScreen.tsx'),panels=read('src/ui/components/BitumenFillPanels.tsx');

describe('the Bitumen screen',()=>{
  it('has Record Fill on the batches list and on every open batch, and none on a closed batch',()=>{
    expect(screen).toContain('label="Record Fill"');
    expect(screen).toMatch(/isOpenBatch\(batch\)\?<AppButton label="Record Fill" onPress=\{onRecordFill\}/);
    expect(screen).toContain("{kind:'fill';batchId:string;backTo:'list'|'detail'}");
  });
  it('shows fills by day on the batch page, with cancel by reason and no edit or delete',()=>{
    expect(screen).toContain('<FillsByDayCard');
    expect(screen).toContain('repository.cancelFill(fillId,why)');
    expect(panels).toContain('Cancel this fill');
    expect(panels).not.toMatch(/deleteFill|editFill/);
  });
  it('keeps the existing Use from asphalt loads section',()=>{expect(screen).toContain('<UseFromLoadsCard');});
});

describe('the Record Fill form',()=>{
  it('has the five parts of the mockup in order, with a Before you save preview',()=>{
    const order=['title="Batch"','title="Truck"','title="Destination"','title="Quantity and date"'].map(text=>panels.indexOf(text));
    expect(order.every(index=>index>0)).toBe(true);
    expect([...order].sort((a,b)=>a-b)).toEqual(order);
    expect(panels).toContain('<Preview lines={lines}');
  });
  it('reuses the saved-truck and destination selectors of the diesel fill',()=>{
    expect(panels).toContain('FuelDestinationFields');
    expect(panels).toContain('SearchableSelect');
    expect(panels).toContain("from './fuel/FuelFillForm'");
  });
  it('blocks Save when the fill is over the limit, keeps the field editable and offers Record bitumen delivery',()=>{
    expect(panels).toContain("plan?.issue==='over_limit'");
    expect(panels).toContain('disabled={!ready}');
    expect(panels).toContain('Record bitumen delivery');
    expect(panels).toContain('This fill is more than what is left');
    expect(panels).not.toMatch(/Bitumen \(kg\) \*[^>]*disabled/);
  });
});
