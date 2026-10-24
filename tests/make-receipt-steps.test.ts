import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {receiptEntrySteps,receiptIssueStep,receiptStepIssues} from '../src/domain/loads';
import {fitSignatureToBox,SIGNATURE_BOX} from '../src/domain/signatureFit';

const read=(path:string)=>readFileSync(path,'utf8');
const numbers=(path:string)=>[...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(match=>Number(match[0]));
const points=(paths:string[])=>paths.flatMap(path=>{const values=numbers(path);const out:{x:number;y:number}[]=[];for(let i=0;i<values.length;i+=2)out.push({x:values[i]!,y:values[i+1]!});return out;});

describe('DEC-524 Make Receipt steps',()=>{
  it('has the four approved steps',()=>{
    expect([...receiptEntrySteps]).toEqual(['Who and where','What left','Price (optional)','Review and sign']);
  });
  it('puts every validation message on the step that holds its field',()=>{
    const cases:[string,number][]=[
      ['Select a saved customer.',1],['Record date must be today or a valid past date.',1],['The record date must be within the selected project dates.',1],
      ['An own-company load requires a project.',1],['Select a project or enter a destination address.',1],['The selected project belongs to another customer.',1],
      ['Select a load-enabled item.',2],['Driver or operator name is required.',2],['Truck plate is required.',2],['Select a saved truck.',2],
      ['Empty weight must be a whole kilogram value.',2],['Full weight must be greater than empty weight.',2],['Requested quantity must be a whole kilogram value.',2],
      ['Direct quantity must be greater than zero with no more than six decimals.',2],['Select the direct quantity unit.',2],
      ['Select a conversion.',3],['Select a conversion or choose No conversion.',3],['The conversion must start from the unit entered.',3],
      ['Unit price must be zero or more with no more than two decimals.',3],['The VAT rate on the price must be a percentage from 0 to 100.',3],
      ['Save the required company name in Settings.',4],
    ];
    for(const [message,step] of cases)expect(receiptIssueStep(message),message).toBe(step);
  });
  it('Next stops only for the current step, and the last step rechecks everything',()=>{
    const issues=['Select a saved customer.','Select a load-enabled item.','Select a conversion.','Save the required company name in Settings.'];
    expect(receiptStepIssues(1,issues)).toEqual(['Select a saved customer.']);
    expect(receiptStepIssues(2,issues)).toEqual(['Select a load-enabled item.']);
    expect(receiptStepIssues(3,issues)).toEqual(['Select a conversion.']);
    expect(receiptStepIssues(4,issues)).toEqual(issues);
  });
});

describe('DEC-524 signature fitted to the printed box',()=>{
  const tall=['M 40 60 L 120 200 L 200 90 L 260 210'];
  it('keeps nothing for an empty pad',()=>{
    expect(fitSignatureToBox([])).toEqual([]);
    expect(fitSignatureToBox(['not a path'])).toEqual([]);
  });
  it('lands inside the 320 x 140 box with a margin, centred, and fills one direction',()=>{
    const fitted=points(fitSignatureToBox(tall));
    const xs=fitted.map(p=>p.x),ys=fitted.map(p=>p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(8-.1);expect(Math.max(...xs)).toBeLessThanOrEqual(SIGNATURE_BOX.width-8+.1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(8-.1);expect(Math.max(...ys)).toBeLessThanOrEqual(SIGNATURE_BOX.height-8+.1);
    expect((Math.min(...xs)+Math.max(...xs))/2).toBeCloseTo(SIGNATURE_BOX.width/2,0);
    expect((Math.min(...ys)+Math.max(...ys))/2).toBeCloseTo(SIGNATURE_BOX.height/2,0);
    expect(Math.max(...ys)-Math.min(...ys)).toBeCloseTo(SIGNATURE_BOX.height-16,0);
  });
  it('never stretches: the shape keeps its width to height ratio',()=>{
    const before=points(tall),after=points(fitSignatureToBox(tall));
    const ratio=(list:{x:number;y:number}[])=>(Math.max(...list.map(p=>p.x))-Math.min(...list.map(p=>p.x)))/(Math.max(...list.map(p=>p.y))-Math.min(...list.map(p=>p.y)));
    expect(ratio(after)).toBeCloseTo(ratio(before),1);
  });
  it('enlarges a small signature and keeps separate strokes and their commands',()=>{
    const fitted=fitSignatureToBox(['M 10 10 L 30 20','M 40 12 L 50 30']);
    expect(fitted).toHaveLength(2);
    expect(fitted[0]).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    const all=points(fitted);expect(Math.max(...all.map(p=>p.x))-Math.min(...all.map(p=>p.x))).toBeGreaterThan(40);
  });
  it('centres a single dot and handles a straight line',()=>{
    expect(points(fitSignatureToBox(['M 5 5']))[0]).toEqual({x:160,y:70});
    const line=points(fitSignatureToBox(['M 10 50 L 110 50']));
    expect(line[0]!.y).toBeCloseTo(70,0);expect(line[1]!.x-line[0]!.x).toBeCloseTo(SIGNATURE_BOX.width-16,0);
  });
});

describe('DEC-524 Make Receipt screen structure (static checks)',()=>{
  const screen=read('src/ui/screens/MakeReceiptScreen.tsx');
  it('shows one step at a time with the same TOTAL / Back / Next bar as New Supplier Load',()=>{
    for(const text of ['step === 1 ?','step === 2 ?','step === 3 ?','step === 4 ?','styles.stepBar','TOTAL','not priced yet',"step === 1 ? 'Cancel' : 'Back'","'Confirm load'",'Step {step} of 4'])expect(screen).toContain(text);
  });
  it('step 4 lists every detail, each opening its own step, and keeps the preview as a link',()=>{
    for(const text of ["['Date',","['Customer',","['Location',","['Item',","'Weighing'","'Quantity'","'Truck'","['Price',","'Subtotal'","'VAT'","'Load No.'",'Tap a line to change it.','Preview documents · Receipt and Authorization','goToStep(target)'])expect(screen).toContain(text);
  });
  it('uses the bigger pad and saves the fitted signature',()=>{
    expect(screen).toContain('<SignaturePad large');
    expect(screen).toContain('fitSignatureToBox(draft.driverSignaturePaths)');
    expect(screen).toContain('repository.confirmLoad(fittedDraft)');
    expect(read('src/ui/components/SignaturePad.tsx')).toContain('padLarge:{height:240}');
  });
  it('Next checks only the current step, and the draft and confirmation rules are unchanged',()=>{
    expect(screen).toContain('receiptStepIssues(forStep,');
    expect(screen).toContain("scrollEnabled={!signing}");
    expect(screen).toContain('Confirmation assigns the permanent load number and transaction number. The record cannot return to Draft.');
    expect(screen).toContain('repository.saveDraft(draft)');
  });
  it('does not touch the printed documents or the other screens that use the pad',()=>{
    expect(read('src/ui/components/LoadCorrectionForm.tsx')).not.toContain('SignaturePad large');
    expect(read('src/ui/screens/LoadHistoryScreen.tsx')).not.toContain('SignaturePad large');
  });
});

describe('DEC-524 signature pad stays steady at the walls (static checks)',()=>{
  const pad=read('src/ui/components/SignaturePad.tsx');
  it('children ignore touches so the point is always measured on the pad itself',()=>{
    expect(pad).toContain('<Svg pointerEvents="none"');
    expect(pad).toContain('<Text pointerEvents="none"');
  });
  it('clamps every point into the pad, so a finger on or past a wall cannot make the line jump',()=>{
    expect(pad).toContain('const clamp = (value: number, max: number)');
    expect(pad).toContain('clamp(rawX, size.current.width)');
    expect(pad).toContain('clamp(rawY, size.current.height)');
  });
});
