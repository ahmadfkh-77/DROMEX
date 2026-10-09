import {readFileSync} from 'node:fs';
import {afterEach,describe,expect,it} from 'vitest';

import {SqliteCompanyHeaderRepository} from '../src/data/repositories/SqliteCompanyHeaderRepository';
import {SqliteDocumentSignerRepository} from '../src/data/repositories/SqliteDocumentSignerRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {applyHeaderCompany} from '../src/domain/companyHeaders';
import {emptyLoadDraft,type LoadDraft} from '../src/domain/loads';
import {buildLoadDocumentHtml} from '../src/services/documentTemplates';
import {buildLoadEscPos} from '../src/services/escpos';
import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * Phase 3 (after confirming). The Header company changes only what a preview, PDF or printed slip shows at the
 * top and the supplier signature line. The record, its numbers and its totals are never changed.
 */
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';
const DRIVER_STROKE='M 10.0 60.0 L 50.0 20.0 L 90.0 70.0';
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const database=await migratedDatabaseWithProject(databases);
  database.raw.exec(`
    INSERT INTO company_settings (id,company_name,address,phone,updated_at) VALUES ('company','DROMEX Asphalt Co.','Beirut industrial zone','+961 1 234 567','${SEED_TIME}');
    INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,created_at,updated_at) VALUES ('asphalt','cat','Asphalt','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const loads=new SqliteLoadRepository(database as never);
  const headers=new SqliteCompanyHeaderRepository(database as never);
  const signers=new SqliteDocumentSignerRepository(database as never);
  const owner=await signers.createSigner({name:'Ahmad Fakih',jobTitle:'Owner',department:'DROMEX'});await signers.saveSignature(owner.id,[STROKE]);
  await headers.savePlantExtras({registrationNumber:'',signerId:owner.id,signerDisplay:'name_with_signature'});
  const manager=await signers.createSigner({name:'Site Manager',jobTitle:'Manager',department:''});
  const draft:LoadDraft={...emptyLoadDraft,recordDate:'2026-08-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverName:'Walid Khoury',truckPlate:'B 884211',quantityMethod:'direct',directQuantity:'10',directUnitId:'unit_ton',unitPriceUsd:'180',driverSignaturePaths:[DRIVER_STROKE]};
  const load=await loads.confirmLoad(draft);
  const projectHeader=async(signerId:string|null)=>{await headers.saveProjectCompany({customerId:'customer',logoUri:null,address:'Zahle, Bekaa',phone:'+961 8 555 123',email:'',taxVatNumber:'',registrationNumber:'',receiptFooter:'',signerId,signerDisplay:signerId?'name_only':null});return headers.resolveHeader('project');};
  return {database,loads,headers,load,manager,projectHeader};
}

describe('applyHeaderCompany',()=>{
  it('returns the record exactly as confirmed for the Plant Company, so an old receipt reprints unchanged',async()=>{
    const {load,headers}=await setup();
    const plant=await headers.resolveHeader('plant');
    expect(applyHeaderCompany(load,plant)).toBe(load);
  });

  it('swaps only the header and the supplier line for the Project Company, and never touches the original',async()=>{
    const {load,projectHeader,manager}=await setup();
    const header=await projectHeader(manager.id);
    const before=JSON.parse(JSON.stringify(load));
    const shown=applyHeaderCompany(load,header);
    expect(shown).toMatchObject({companyName:'Road Co',companyAddress:'Zahle, Bekaa',companyPhone:'+961 8 555 123'});
    expect(shown.supplierSignature).toMatchObject({name:'Site Manager',display:'name_only'});
    for(const field of ['loadNumber','transactionNumber','billedQuantity','convertedQuantity','unitPriceUsd','subtotalUsd','finalTotalUsd','driverName','truckPlate','customerName','projectName','signaturePaths','confirmedAt'] as const)expect(shown[field]).toEqual(load[field]);
    expect(JSON.parse(JSON.stringify(load))).toEqual(before);
  });

  it('leaves the supplier signature line off when the Project Company has no signer',async()=>{
    const {load,projectHeader}=await setup();
    const shown=applyHeaderCompany(load,await projectHeader(null));
    expect(shown.supplierSignature).toBeNull();
    expect(load.supplierSignature).toMatchObject({name:'Ahmad Fakih'});
  });
});

describe('what prints under each header',()=>{
  it('shows the chosen company on the receipt, the authorization, and the printed slip, with the same numbers',async()=>{
    const {load,projectHeader,manager}=await setup();
    const shown=applyHeaderCompany(load,await projectHeader(manager.id));
    for(const kind of ['receipt','authorization'] as const){
      const html=buildLoadDocumentHtml(shown,kind,'58');
      expect(html).toContain('Road Co');expect(html).not.toContain('DROMEX Asphalt Co.');
      expect(html).toContain(load.loadNumber!);expect(html).toContain(load.transactionNumber);
    }
    const receipt=buildLoadDocumentHtml(shown,'receipt','80');
    expect(receipt).toContain('Final total');
    expect(buildLoadDocumentHtml(shown,'authorization','58')).toContain('Site Manager');
    const slip=buildLoadEscPos(shown,'authorization','58').toString('latin1');
    expect(slip).toContain('Road Co');expect(slip).not.toContain('DROMEX Asphalt');expect(slip).toContain('Site Manager');
  });
  it('keeps the Plant Company header and both signatures on the Plant choice',async()=>{
    const {load,headers}=await setup();
    const shown=applyHeaderCompany(load,await headers.resolveHeader('plant'));
    const html=buildLoadDocumentHtml(shown,'authorization','58');
    expect(html).toContain('DROMEX Asphalt Co.');expect(html).toContain('Supplier signature');expect(html).toContain('Ahmad Fakih');expect(html).toContain('Walid Khoury');
  });
  it('omits the supplier signature line when the chosen header has no signer',async()=>{
    const {load,projectHeader}=await setup();
    const html=buildLoadDocumentHtml(applyHeaderCompany(load,await projectHeader(null)),'authorization','58');
    expect(html).not.toContain('Supplier signature');
    expect(html).toContain('Walid Khoury');
  });
  it('changes nothing in the saved record: the load still reads back with its confirmed header and numbers',async()=>{
    const {load,loads,projectHeader,manager,database}=await setup();
    applyHeaderCompany(load,await projectHeader(manager.id));
    const stored=(await loads.listLoads()).find(value=>value.id===load.id)!;
    expect(stored).toMatchObject({companyName:'DROMEX Asphalt Co.',loadNumber:load.loadNumber,transactionNumber:load.transactionNumber,billedQuantity:load.billedQuantity,finalTotalUsd:load.finalTotalUsd});
    expect((database.raw.prepare('SELECT COUNT(*) n FROM loads').get() as {n:number}).n).toBe(1);
  });
});

describe('the Load confirmed screen',()=>{
  const screen=readFileSync('src/ui/screens/MakeReceiptScreen.tsx','utf8');
  const view=screen.slice(screen.indexOf('function ConfirmedView('),screen.indexOf('function PreviewView('));
  it('asks what to print, shows the Header company picker and a live preview of the choice',()=>{
    for(const text of ['What do you want to print?','Receipt','Delivery Authorization','<HeaderCompanyPicker','kind={kind} paper={paper}','applyHeaderCompany(record, header)'])expect(view).toContain(text);
  });
  it('orders print, share, then the explicit "what next" choices',()=>{
    const order=['Bluetooth Print','Share ','Done printing? Choose what is next.','Nothing starts until you tap.','Create Another Item for Same Delivery','Start Another Load'].map(text=>view.indexOf(text));
    expect(order.every(index=>index>0)).toBe(true);
    expect([...order].sort((a,b)=>a-b)).toEqual(order);
  });
  it('never starts a new load by itself: both actions run only from a tap',()=>{
    for(const name of ['onStartAnotherLoad','onCreateAnotherItem']){
      const uses=[...view.matchAll(new RegExp(name,'g'))].length;
      expect(uses).toBe(3);
      expect(view).toContain(`onPress={${name}}`);
    }
  });
  it('disables both buttons while one is running, offers Retry, and reassures that the record is saved',()=>{
    expect(view).toContain("disabled={busy !== null}");
    expect(view).toContain("'Retry Print'");
    expect(view).toContain('The confirmed record is still saved.');
  });
  it('remembers the header for the project only when the checkbox is ticked, and starts from the project default',()=>{
    expect(view).toContain('headers.getProjectHeaderDefault(projectId)');
    expect(view).toContain('if (headers && remember && projectId && header)');
    expect(readFileSync('src/ui/DromexApp.tsx','utf8')).toContain('headers={companyHeaderRepository}/></ReceiptEntrance>');
  });
  it('lets a parent own the document choice, and keeps the built-in toggles for Load History',()=>{
    const documents=readFileSync('src/ui/components/LoadDocuments.tsx','utf8');
    expect(documents).toContain('const controlled = kind !== undefined && controlledPaper !== undefined;');
    expect(documents).toContain('{controlled ? null : <View style={styles.controls}>');
  });
});
