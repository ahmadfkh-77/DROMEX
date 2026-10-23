import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteContractQuantitiesRepository} from '../src/data/repositories/SqliteContractQuantitiesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {contractChoiceIssue,type ContractItem} from '../src/domain/contractQuantities';
import {emptyLoadDraft,type LoadDraft} from '../src/domain/loads';
import {emptyQuarryPurchaseDraft,type QuarryPurchaseDraft} from '../src/domain/quarry';
import {buildLoadDocumentHtml} from '../src/services/documentTemplates';
import {buildLoadEscPos} from '../src/services/escpos';
import {SEED_TIME,type SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-522 Phase C. The target is chosen while recording a load in Make Receipt or New Supplier Load and is saved with the load in the
 * same transaction. A wrong choice saves nothing. The printed receipt, its PDF and the Delivery Authorization stay exactly as they are.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
    INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1000,'${SEED_TIME}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('other','customer','Coastal Road','Tyre','active','2026-08-10','${SEED_TIME}','${SEED_TIME}',0);
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,quarry_enabled,created_at,updated_at) VALUES
      ('asphalt','cat','Asphalt','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}'),('sand','cat','Sand','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Majbal Quarry',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${SEED_TIME}','${SEED_TIME}','driver');
  `);
  const loads=new SqliteLoadRepository(db as never),quarry=new SqliteQuarryRepository(db as never),contracts=new SqliteContractQuantitiesRepository(db as never);
  const loadDraft=(extra:Partial<LoadDraft>={}):LoadDraft=>({...emptyLoadDraft,vat:{mode:'none',ratePercent:''},recordDate:'2026-10-24',customerId:'customer',projectId:'road',itemId:'asphalt',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'weighbridge',emptyWeightKg:'10000',fullWeightKg:'29500',conversionId:'conversion_kg_ton',unitPriceUsd:'',...extra});
  const supplierDraft=(extra:Partial<QuarryPurchaseDraft>={}):QuarryPurchaseDraft=>({...emptyQuarryPurchaseDraft,recordDate:'2026-10-24',supplierId:'sup',destinationType:'project',projectId:'road',itemId:'asphalt',unitId:'unit_ton',quantityCubicMetres:'12',deliveryMethod:'supplier',supplierTruckPlate:'T-1',...extra});
  const binder=await contracts.createItem('road',{name:'Asphalt binder',unitId:'unit_ton',quantity:'300',unitPriceUsd:'',materialIds:['asphalt']});
  const count=(table:string)=>(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;
  const history=(itemId:string)=>db.raw.prepare('SELECT kind,reason,details_json FROM contract_item_history WHERE contract_item_id=? ORDER BY created_at,rowid').all(itemId) as {kind:string;reason:string|null;details_json:string}[];
  return {db,loads,quarry,contracts,loadDraft,supplierDraft,binder,count,history};
}

describe('Make Receipt saves the chosen target with the load',()=>{
  it('links the load in the same save, records it in the history without a reason, and counts it at once',async()=>{
    const {loads,contracts,loadDraft,binder,history}=await setup();
    const load=await loads.confirmLoad(loadDraft({contractItemId:binder.id}));
    expect(load.contractItemId).toBe(binder.id);
    expect((await contracts.getItem(binder.id)).usage.used).toBe(19.5);
    const last=history(binder.id).at(-1)!;
    expect(last).toMatchObject({kind:'load_linked',reason:null});
    expect(JSON.parse(last.details_json)).toMatchObject({source:'company',loadId:load.id,atConfirmation:true});
  });

  it('saves a load without a choice, or with Not linked, exactly as before',async()=>{
    const {loads,loadDraft}=await setup();
    expect((await loads.confirmLoad(loadDraft())).contractItemId).toBeNull();
    expect((await loads.confirmLoad(loadDraft({contractItemId:''}))).contractItemId).toBeNull();
  });

  it('refuses an item of another project, a material it does not list or a cancelled item, and then saves nothing',async()=>{
    const {loads,contracts,loadDraft,binder,count}=await setup();
    const coastal=await contracts.createItem('other',{name:'Coastal asphalt',unitId:'unit_ton',quantity:'50',unitPriceUsd:'',materialIds:['asphalt']});
    await expect(loads.confirmLoad(loadDraft({contractItemId:coastal.id}))).rejects.toThrow('another project');
    await expect(loads.confirmLoad(loadDraft({itemId:'sand',contractItemId:binder.id}))).rejects.toThrow('not one of the materials');
    await contracts.cancelItem(binder.id,'Mistake');
    await expect(loads.confirmLoad(loadDraft({contractItemId:binder.id}))).rejects.toThrow('cancelled');
    expect(count('loads')).toBe(0);
  });
});

describe('New Supplier Load saves the chosen target',()=>{
  it('gives every item of one delivery note its own choice',async()=>{
    const {quarry,contracts,supplierDraft,binder}=await setup();
    const [first,second]=await quarry.confirmDelivery([supplierDraft({contractItemId:binder.id}),supplierDraft({itemId:'sand',contractItemId:''})]);
    expect(first!.contractItemId).toBe(binder.id);
    expect(second!.contractItemId).toBeNull();
    expect((await contracts.getItem(binder.id)).usage.used).toBe(12);
  });

  it('saves none of the delivery note when one choice is wrong',async()=>{
    const {quarry,supplierDraft,binder,count}=await setup();
    await expect(quarry.confirmDelivery([supplierDraft({contractItemId:binder.id}),supplierDraft({itemId:'sand',contractItemId:binder.id})])).rejects.toThrow('not one of the materials');
    expect(count('quarry_purchases')).toBe(0);
  });

  it('a truck counter +1 Trip keeps the target of the trip it copies, and saves unlinked when that item was cancelled',async()=>{
    const {quarry,contracts,supplierDraft,binder}=await setup();
    const first=await quarry.confirmPurchase(supplierDraft({contractItemId:binder.id}));
    const trip=await quarry.incrementPurchase(first.id,14);
    expect(trip.contractItemId).toBe(binder.id);
    expect((await contracts.getItem(binder.id)).usage.used).toBe(26);
    await contracts.cancelItem(binder.id,'Mistake');
    expect((await quarry.incrementPurchase(first.id,10)).contractItemId).toBeNull();
  });

  it('a site delivery cannot count toward a project contract',async()=>{
    const {quarry,fuel,supplierDraft,binder}=await (async()=>{const base=await setup();const {SqliteFuelRepository}=await import('../src/data/repositories/SqliteFuelRepository');return {...base,fuel:new SqliteFuelRepository(base.db as never)};})();
    const yard=await fuel.createCompanySite('Yard B');
    await expect(quarry.confirmPurchase(supplierDraft({destinationType:'company_site',companySiteId:yard.id,contractItemId:binder.id}))).rejects.toThrow('another project');
  });
});

describe('the printed receipt stays exactly as it is',()=>{
  it('the receipt, the Delivery Authorization and the Bluetooth print are identical with and without a target',async()=>{
    const {loads,loadDraft,binder}=await setup();
    const linked=await loads.confirmLoad(loadDraft({contractItemId:binder.id}));
    const plain={...linked,contractItemId:null};
    for(const kind of ['receipt','authorization'] as const){
      expect(buildLoadDocumentHtml(linked,kind,'80')).toBe(buildLoadDocumentHtml(plain,kind,'80'));
      expect(buildLoadEscPos(linked,kind,'80').equals(buildLoadEscPos(plain,kind,'80'))).toBe(true);
    }
    expect(buildLoadDocumentHtml(linked,'receipt','80')).not.toMatch(/contract/i);
  });
});

describe('the choice on screen',()=>{
  const item=(id:string):ContractItem=>({id,projectId:'road',name:id,unitId:'unit_ton',unitSymbol:'t',quantity:10,unitPriceUsd:null,materialIds:['asphalt'],status:'in_progress',completedOn:null,cancelledAt:null});
  it('asks for a pick only when several items fit and none is chosen yet',()=>{
    expect(contractChoiceIssue([item('a'),item('b')],undefined)).toBe('Choose the target this load counts toward, or Not linked.');
    expect(contractChoiceIssue([item('a'),item('b')],'')).toBeNull();
    expect(contractChoiceIssue([item('a'),item('b')],'b')).toBeNull();
    expect(contractChoiceIssue([item('a')],undefined)).toBeNull();
    expect(contractChoiceIssue([],undefined)).toBeNull();
  });
});

describe('the choice is wired into both flows (static checks, no React Native renderer)',()=>{
  const read=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');
  const choice=read('src/ui/components/ContractItemChoice.tsx');
  it('shows nothing until the project has targets, so a project without contracts is unchanged',()=>{
    expect(choice).toContain('if(!rows||!rows.length||!materialId)return null;');
  });
  it('is in Make Receipt after Conversion and price, and blocks Confirm only for an unanswered pick',()=>{
    const receipt=read('src/ui/screens/MakeReceiptScreen.tsx');
    expect(receipt).toContain('<ContractItemChoice');
    expect(receipt).toContain('...(contractIssue ? [contractIssue] : [])');
    expect(receipt.indexOf('<ContractItemChoice')).toBeGreaterThan(receipt.indexOf('title="Conversion and price"'));
    expect(receipt.indexOf('<ContractItemChoice')).toBeLessThan(receipt.indexOf('title="Signatures"'));
  });
  it('is in step 2 of New Supplier Load for the main item and every extra item, and on the Review summary',()=>{
    const wizard=read('src/ui/screens/QuarryPurchasesScreen.tsx');
    expect(wizard.split('<ContractItemChoice').length-1).toBe(2);
    expect(wizard).toContain("contractItemId:extra.contractItemId");
    expect(wizard).toContain("['Target',");
  });
  it('gets its repository from the app shell, and the receipt templates never mention it',()=>{
    const app=read('src/ui/DromexApp.tsx');
    expect(app).toContain('<MakeReceiptScreen repository={loadRepository} contracts={contractRepository}');
    expect(app).toContain('<QuarryPurchasesScreen repository={quarryRepository} fuel={fuelRepository} contracts={contractRepository}');
    for(const template of ['src/services/documentTemplates.ts','src/services/escpos.ts'])expect(read(template)).not.toMatch(/contract/i);
  });
});
