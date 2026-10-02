import {afterEach,describe,expect,it} from 'vitest';

import {SqliteDocumentSignerRepository} from '../src/data/repositories/SqliteDocumentSignerRepository';
import {signerSnapshot,validateSignerDraft} from '../src/domain/documentSigners';
import {migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/** DEC-487 (5). Reusable authorized signers with a change history; documents keep their own copy. */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';

async function setup(){const db=await migratedDatabaseWithProject(databases);return {db,signers:new SqliteDocumentSignerRepository(db as never)};}

describe('signer rules',()=>{
  it('requires a name and bounds every field',()=>{
    expect(validateSignerDraft({name:'  ',jobTitle:'',department:''})).toEqual(['Enter the signer’s printed name.']);
    expect(validateSignerDraft({name:'Rana Haddad',jobTitle:'x'.repeat(81),department:''})).toEqual(['Job title must be 80 characters or fewer.']);
    expect(validateSignerDraft({name:'رنا حداد',jobTitle:'المديرة المالية',department:'Finance'})).toEqual([]);
  });

  it('snapshots a signer as Name only or with the signature strokes',()=>{
    const signer={id:'s',name:'Rana',jobTitle:'CFO',department:null,signature:[STROKE],signatureDamaged:false,signatureUpdatedAt:null,isActive:true,createdAt:'',updatedAt:''};
    expect(signerSnapshot(signer,'name_only')).toEqual({signerId:'s',name:'Rana',jobTitle:'CFO',department:null,display:'name_only',signature:[]});
    expect(signerSnapshot(signer,'name_with_signature')).toEqual({signerId:'s',name:'Rana',jobTitle:'CFO',department:null,display:'name_with_signature',signature:[STROKE]});
    expect(()=>signerSnapshot({...signer,signature:[]},'name_with_signature')).toThrow('Rana has no saved signature. Choose Name only or draw the signature first.');
  });
});

describe('signer repository',()=>{
  it('creates, edits, signs, disables and re-enables, recording each event',async()=>{
    const {signers}=await setup();
    const created=await signers.createSigner({name:' Rana   Haddad ',jobTitle:'Finance Manager',department:'Accounts'});
    expect(created).toMatchObject({name:'Rana Haddad',jobTitle:'Finance Manager',department:'Accounts',signature:[],isActive:true});
    await signers.updateSigner(created.id,{name:'Rana Haddad',jobTitle:'Chief Financial Officer',department:''});
    await signers.saveSignature(created.id,[STROKE]);
    await signers.setSignerActive(created.id,false);
    await signers.setSignerActive(created.id,true);
    expect((await signers.listEvents(created.id)).map(value=>value.event)).toEqual(['created','updated','signature_changed','disabled','enabled']);
    expect((await signers.listSigners())[0]).toMatchObject({jobTitle:'Chief Financial Officer',department:null,signature:[STROKE]});
  });

  it('keeps names unique and rejects signature data the pad never produces',async()=>{
    const {signers}=await setup();
    const a=await signers.createSigner({name:'Rana Haddad',jobTitle:'',department:''});
    await expect(signers.createSigner({name:'rana haddad',jobTitle:'',department:''})).rejects.toThrow('A signer named "Rana Haddad" already exists.');
    await expect(signers.saveSignature(a.id,['<script>'])).rejects.toThrow('The signature data is not valid.');
  });

  it('never puts signature strokes in the sync queue',async()=>{
    const {db,signers}=await setup();
    const a=await signers.createSigner({name:'Rana Haddad',jobTitle:'',department:''});
    await signers.saveSignature(a.id,[STROKE]);
    const payloads=(db.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='documentSigner'").all() as {payload_json:string}[]).map(row=>row.payload_json);
    expect(payloads.length).toBe(2);
    expect(payloads.join('')).not.toContain('80.5');
  });
});
