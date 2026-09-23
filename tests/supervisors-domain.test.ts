import {describe,expect,it} from 'vitest';

import {
  addSupervisorSignoff,buildSupervisorSignoff,moveSupervisorSignoff,normalizeSupervisorSignoffs,parseStoredSignature,
  removeSupervisorSignoff,setSupervisorSignoffDisplay,supervisorNameKey,validateSignatureStrokes,validateSupervisorDraft,
  type Supervisor,
} from '../src/domain/supervisors';

const STROKE='M 10.0 20.5 L 30.2 40.0 L 55.1 41.9';
const supervisor=(id:string,name:string,extra:Partial<Supervisor>={}):Supervisor=>({id,name,jobTitle:null,signature:[],signatureDamaged:false,signatureUpdatedAt:null,displayOrder:0,isActive:true,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',...extra});

describe('supervisor profiles (DEC-479)',()=>{
  it('normalizes the duplicate key and validates name and title length',()=>{
    expect(supervisorNameKey('  Nadim   AOUN ')).toBe('nadim aoun');
    expect(validateSupervisorDraft({name:' '})).toContain('Supervisor name is required.');
    expect(validateSupervisorDraft({name:'x'.repeat(81)})).toContain('Supervisor name must be 80 characters or fewer.');
    expect(validateSupervisorDraft({name:'Nadim',jobTitle:'t'.repeat(81)})).toContain('Job title must be 80 characters or fewer.');
    expect(validateSupervisorDraft({name:'نديم عون',jobTitle:'Resident Engineer'})).toEqual([]);
  });
});

describe('signature stroke validation',()=>{
  it('accepts the exact stroke form the signature pad produces, including off-pad negative points',()=>{
    expect(validateSignatureStrokes([STROKE,'M -3.1 150.2 L 330.0 -1.0'])).toEqual([]);
    expect(validateSignatureStrokes(['M 5 5'])).toEqual([]);
  });
  it('rejects anything that is not pure move/line stroke data',()=>{
    expect(validateSignatureStrokes(['M 1 1 L 2 2" onload="x'])).toContain('The signature data is not valid.');
    expect(validateSignatureStrokes(['<script>'])).toContain('The signature data is not valid.');
    expect(validateSignatureStrokes(['M 1 1 C 2 2 3 3 4 4'])).toContain('The signature data is not valid.');
    expect(validateSignatureStrokes('M 1 1' as never)).toContain('The signature data is not valid.');
    expect(validateSignatureStrokes([1] as never)).toContain('The signature data is not valid.');
  });
  it('rejects a signature that is too large to be a hand-drawn signature',()=>{
    expect(validateSignatureStrokes(Array.from({length:201},()=>'M 1 1'))).toContain('The signature is too large. Clear it and sign again.');
    expect(validateSignatureStrokes([`M 1 1${' L 100.0 100.0'.repeat(9000)}`])).toContain('The signature is too large. Clear it and sign again.');
  });
  it('reads a stored signature defensively and reports damage instead of throwing',()=>{
    expect(parseStoredSignature(JSON.stringify([STROKE]))).toEqual({strokes:[STROKE],damaged:false});
    expect(parseStoredSignature('[]')).toEqual({strokes:[],damaged:false});
    expect(parseStoredSignature('{broken')).toEqual({strokes:[],damaged:true});
    expect(parseStoredSignature(JSON.stringify(['<svg/>']))).toEqual({strokes:[],damaged:true});
  });
});

describe('Daily Report supervisor sign-off snapshots',()=>{
  const signed=supervisor('s1','Nadim Aoun',{jobTitle:'Resident Engineer',signature:[STROKE]});
  const unsigned=supervisor('s2','Lina Khoury');

  it('copies name, title, display choice and the signature strokes themselves into the snapshot',()=>{
    const snapshot=buildSupervisorSignoff(signed,'name_with_signature');
    expect(snapshot).toEqual({supervisorId:'s1',name:'Nadim Aoun',jobTitle:'Resident Engineer',display:'name_with_signature',signature:[STROKE]});
    expect(snapshot.signature).not.toBe(signed.signature);
  });

  it('never stores strokes for a name-only sign-off, and never claims a signature that does not exist',()=>{
    expect(buildSupervisorSignoff(signed,'name_only')).toMatchObject({display:'name_only',signature:[]});
    expect(buildSupervisorSignoff(unsigned,'name_with_signature')).toMatchObject({display:'name_only',signature:[]});
  });

  it('keeps the report copy unchanged when the profile signature is later replaced or removed',()=>{
    const list=addSupervisorSignoff([],signed,'name_with_signature');
    const replacedProfile={...signed,signature:['M 1 1 L 2 2'],name:'Nadim A. Aoun'};
    expect(list[0]).toMatchObject({name:'Nadim Aoun',signature:[STROKE]});
    expect(replacedProfile.signature).not.toEqual(list[0]!.signature);
  });

  it('preserves the selected order, refuses duplicates, and reorders explicitly',()=>{
    let list=addSupervisorSignoff([],unsigned,'name_only');
    list=addSupervisorSignoff(list,signed,'name_with_signature');
    list=addSupervisorSignoff(list,signed,'name_only');
    expect(list.map(value=>value.supervisorId)).toEqual(['s2','s1']);
    list=moveSupervisorSignoff(list,'s1',-1);
    expect(list.map(value=>value.supervisorId)).toEqual(['s1','s2']);
    expect(moveSupervisorSignoff(list,'s1',-1)).toEqual(list);
    expect(removeSupervisorSignoff(list,'s1').map(value=>value.supervisorId)).toEqual(['s2']);
  });

  it('switching to name-only drops the strokes; switching back re-copies them from the profile as a new deliberate choice',()=>{
    let list=addSupervisorSignoff([],signed,'name_with_signature');
    list=setSupervisorSignoffDisplay(list,'s1','name_only',[signed]);
    expect(list[0]).toMatchObject({display:'name_only',signature:[]});
    list=setSupervisorSignoffDisplay(list,'s1','name_with_signature',[signed]);
    expect(list[0]).toMatchObject({display:'name_with_signature',signature:[STROKE]});
  });

  it('cannot switch a sign-off to show a signature once its profile is gone or unsigned; the snapshot stays name-only',()=>{
    const list=addSupervisorSignoff([],unsigned,'name_only');
    expect(setSupervisorSignoffDisplay(list,'s2','name_with_signature',[unsigned])[0]).toMatchObject({display:'name_only'});
    expect(setSupervisorSignoffDisplay(list,'s2','name_with_signature',[])[0]).toMatchObject({display:'name_only'});
  });

  it('normalizes stored snapshots and drops any stroke that is not valid stroke data',()=>{
    expect(normalizeSupervisorSignoffs([
      {supervisorId:'s1',name:'Nadim',jobTitle:'',display:'name_with_signature',signature:[STROKE,'<svg/>']},
      {supervisorId:'s2',name:'  ',display:'name_only',signature:[]},
      {supervisorId:'s3',name:'Lina',jobTitle:null,display:'weird',signature:[STROKE]},
      null,
    ])).toEqual([
      {supervisorId:'s1',name:'Nadim',jobTitle:null,display:'name_with_signature',signature:[STROKE]},
      {supervisorId:'s3',name:'Lina',jobTitle:null,display:'name_only',signature:[]},
    ]);
  });
});
