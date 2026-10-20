import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqlitePavementRepository,parseAreaSections} from '../src/data/repositories/SqlitePavementRepository';
import {
  analyzePavementSections,calculatePavement,duplicateSectionText,isValidAreaSection,looseThickness,nextSectionWidthStart,sectionArea,totalSectionArea,truckLoads,validatePavementCalculation,
  type PavementAreaSection,type PavementCalculationDraft,type PavementSectionText,
} from '../src/domain/pavement';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Road sections for the paved area (DEC-518). Each section's area is length × (width 1 + width 2) ÷ 2 and the total of all sections is the net
 * area. The width is assumed to change in a straight line inside a section. Blank or invalid fields are errors, never zero.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

const road:PavementAreaSection[]=[{name:'Station 0+000–0+010',lengthM:10,widthStartM:4,widthEndM:4.4},{name:'Station 0+010–0+030',lengthM:20,widthStartM:4.4,widthEndM:6}];
const text=(length:string,widthStart:string,widthEnd:string,name=''):PavementSectionText=>({name,length,widthStart,widthEnd});

describe('the area of road sections (pure)',()=>{
  it('gives 42.0 m², 104.0 m² and a total of 146.0 m² for the example road',()=>{
    expect(sectionArea(road[0]!)).toBe(42);expect(sectionArea(road[1]!)).toBe(104);expect(totalSectionArea(road)).toBe(146);
  });
  it('allows a section that tapers to a point, and refuses a zero length or a negative or missing width',()=>{
    expect(sectionArea({name:'',lengthM:10,widthStartM:0,widthEndM:6})).toBe(30);
    expect(isValidAreaSection({name:'',lengthM:10,widthStartM:0,widthEndM:0})).toBe(true);
    expect(isValidAreaSection({name:'',lengthM:0,widthStartM:4,widthEndM:4})).toBe(false);
    expect(isValidAreaSection({name:'',lengthM:10,widthStartM:-1,widthEndM:4})).toBe(false);
    expect(isValidAreaSection({name:'',lengthM:10,widthStartM:Number.NaN,widthEndM:4})).toBe(false);
  });
  it('starts a new section at the last section\'s Width 2 and copies a section with its measurements',()=>{
    expect(nextSectionWidthStart([])).toBe('');
    expect(nextSectionWidthStart([text('10','4','4.4'),text('20','4.4','6')])).toBe('6');
    expect(duplicateSectionText(text('10','4','4.4','Bend'))).toEqual(text('10','4','4.4','Bend (copy)'));
    expect(duplicateSectionText(text('10','4','4.4'))).toEqual(text('10','4','4.4'));
  });
});

describe('checking the typed sections (pure)',()=>{
  it('accepts the example road, with commas as decimals, and reports each section\'s area and the total',()=>{
    const result=analyzePavementSections([text('10','4','4,4','A'),text('20','4.4','6','B')]);
    expect(result.errors).toEqual([]);expect(result.areas).toEqual([42,104]);expect(result.totalM2).toBe(146);
    expect(result.sections).toEqual([{name:'A',lengthM:10,widthStartM:4,widthEndM:4.4},{name:'B',lengthM:20,widthStartM:4.4,widthEndM:6}]);
  });
  it('never counts a blank field as zero: it names the section and gives no total',()=>{
    const result=analyzePavementSections([text('10','4','4.4'),text('20','4.4','6'),text('','6','')]);
    expect(result.errors).toEqual(['Section 3: enter a length greater than zero, or remove the section.','Section 3: enter Width 2 (zero or more).']);
    expect(result.totalM2).toBeNull();expect(result.sections).toBeNull();expect(result.areas).toEqual([42,104,null]);
  });
  it('refuses a zero or negative length, a negative or non-numeric width, and a list with nothing in it',()=>{
    expect(analyzePavementSections([text('0','4','4')]).errors[0]).toContain('Section 1: enter a length greater than zero');
    expect(analyzePavementSections([text('10','-1','4')]).errors).toEqual(['Section 1: enter Width 1 (zero or more).']);
    for(const bad of ['abc','1e3','4,4,4','--2'])expect(analyzePavementSections([text('10',bad,'4')]).errors,bad).toEqual(['Section 1: enter Width 1 (zero or more).']);
    expect(analyzePavementSections([]).errors).toEqual(['Add at least one road section.']);
  });
  it('refuses a total of zero, which two zero widths give',()=>{
    expect(analyzePavementSections([text('10','0','0')]).errors).toEqual(['The total area must be greater than zero.']);
  });
});

describe('what the total feeds (pure)',()=>{
  it('gives the same quantities as typing 146.0 m² directly',()=>{
    const result=calculatePavement(totalSectionArea(road),90,2.4,5);
    expect(result.theoreticalTonnes).toBeCloseTo(13.14,6);expect(result.plannedTonnes).toBeCloseTo(13.797,6);expect(result.thicknessMm).toBe(37.5);
    expect(looseThickness(result.thicknessMm,1.2)).toBe(45);expect(truckLoads(result.plannedTonnes,20)).toBe(1);
  });
});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  const repository=new SqlitePavementRepository(db as never);
  const draft=(extra:Partial<PavementCalculationDraft>={}):PavementCalculationDraft=>({projectId:'road',name:'Wearing course',lengthM:null,widthM:null,areaM2:146,spreadRateKgM2:90,densityTM3:2.4,looseThicknessFactor:1.2,allowancePercent:5,notes:'',areaSections:road,...extra});
  return{db,repository,draft};
}

describe('migration 66',()=>{
  it('adds the sections column, and an older calculation keeps NULL and reads back as before',async()=>{
    const {db,repository}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(66);
    expect((db.raw.prepare('PRAGMA table_info(pavement_calculations)').all() as {name:string}[]).some(column=>column.name==='area_sections_json')).toBe(true);
    db.raw.exec(`INSERT INTO pavement_calculations (id,project_id,name,length_m,width_m,area_m2,spread_rate_kg_m2,density_t_m3,allowance_percent,theoretical_kg,allowance_kg,planned_kg,thickness_mm,created_at,updated_at)
      VALUES ('old','road','Older layer',500,7,3500,120,2.4,5,420000,21000,441000,50,'${SEED_TIME}','${SEED_TIME}')`);
    const [old]=await repository.listCalculations('road');
    expect(old).toMatchObject({name:'Older layer',lengthM:500,widthM:7,areaM2:3500,areaSections:null});
    expect(db.raw.prepare("SELECT area_sections_json s FROM pavement_calculations WHERE id='old'").get()).toEqual({s:null});
  });
});

describe('saving a calculation with road sections',()=>{
  it('stores the sections and their total, leaves length and width empty, and reads them back',async()=>{
    const {db,repository,draft}=await setup();
    const saved=await repository.saveCalculation(draft());
    expect(saved).toMatchObject({areaM2:146,lengthM:null,widthM:null,theoreticalKg:13140,plannedKg:13797,thicknessMm:37.5,looseThicknessMm:45});
    expect(saved.areaSections).toEqual(road);
    expect(db.raw.prepare('SELECT area_m2 a,length_m l,width_m w FROM pavement_calculations WHERE id=?').get(saved.id)).toEqual({a:146,l:null,w:null});
    expect((await repository.listCalculations('road'))[0]!.areaSections).toEqual(road);
  });
  it('works the total out from the sections, so a stored area can never disagree with them',async()=>{
    const {repository,draft}=await setup();
    const saved=await repository.saveCalculation(draft({areaM2:999}));
    expect(saved.areaM2).toBe(146);
  });
  it('updates the sections of a saved calculation, and clears them when it goes back to a typed area',async()=>{
    const {repository,draft}=await setup();
    const saved=await repository.saveCalculation(draft());
    const changed=await repository.saveCalculation(draft({areaSections:[{name:'',lengthM:30,widthStartM:5,widthEndM:5}]}),saved.id);
    expect(changed).toMatchObject({id:saved.id,areaM2:150,areaSections:[{name:'',lengthM:30,widthStartM:5,widthEndM:5}]});
    const typed=await repository.saveCalculation({...draft({areaSections:null,lengthM:500,widthM:7,areaM2:3500}),notes:'typed'},saved.id);
    expect(typed).toMatchObject({areaM2:3500,lengthM:500,widthM:7,areaSections:null});
  });
  it('refuses an empty list, an invalid section, and saves nothing',async()=>{
    const {db,repository,draft}=await setup();
    await expect(repository.saveCalculation(draft({areaSections:[]}))).rejects.toThrow('Add at least one road section.');
    await expect(repository.saveCalculation(draft({areaSections:[{name:'',lengthM:0,widthStartM:4,widthEndM:4}]}))).rejects.toThrow('Every road section needs a length above zero');
    expect(db.raw.prepare('SELECT COUNT(*) n FROM pavement_calculations').get()).toEqual({n:0});
  });
  it('queues the sections with the calculation for sync',async()=>{
    const {db,repository,draft}=await setup();
    const saved=await repository.saveCalculation(draft());
    const row=db.raw.prepare("SELECT payload_json p FROM sync_outbox WHERE entity_type='pavementCalculation' AND entity_id=?").get(saved.id) as {p:string};
    expect(JSON.parse(row.p).areaSections).toEqual(road);
  });
  it('keeps the project\'s combined area right: the total of the sections is what the project sums',async()=>{
    const {db,repository,draft}=await setup();
    await repository.saveCalculation(draft());
    await repository.saveCalculation(draft({name:'Binder',areaSections:null,lengthM:500,widthM:7,areaM2:3500}));
    expect(db.raw.prepare("SELECT SUM(area_m2) a FROM pavement_calculations WHERE project_id='road'").get()).toEqual({a:3646});
  });
});

describe('checking a calculation with sections',()=>{
  const projects=[{id:'road',status:'active'}] as never;
  const base={projectId:'road',name:'X',lengthM:null,widthM:null,areaM2:146,spreadRateKgM2:90,densityTM3:2.4,looseThicknessFactor:null,allowancePercent:0,notes:''} as PavementCalculationDraft;
  it('passes the example road and refuses an area that is not the total of its sections',()=>{
    expect(validatePavementCalculation({...base,areaSections:road},projects)).toEqual([]);
    expect(validatePavementCalculation({...base,areaSections:road,areaM2:150},projects)).toContain('The area must equal the total of the road sections.');
  });
  it('leaves a calculation without sections exactly as before',()=>{
    expect(validatePavementCalculation({...base,areaM2:3500},projects)).toEqual([]);
    expect(validatePavementCalculation({...base,areaM2:0},projects)).toContain('Area must be greater than zero.');
  });
});

describe('reading saved sections',()=>{
  it('reads none for nothing, for damaged data, and for sections that are not usable, and never throws',()=>{
    for(const value of [null,undefined,'','not json','{}','[]','[{"lengthM":0,"widthStartM":4,"widthEndM":4}]','[{"lengthM":"x","widthStartM":4,"widthEndM":4}]'])expect(parseAreaSections(value),String(value)).toBeNull();
    expect(parseAreaSections(JSON.stringify(road))).toEqual(road);
  });
});
