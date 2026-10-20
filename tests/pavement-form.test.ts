import {afterEach,describe,expect,it} from 'vitest';

import {SqlitePavementRepository} from '../src/data/repositories/SqlitePavementRepository';
import {calculatePavement} from '../src/domain/pavement';
import {
  areaOfPavementForm,areaPageIssue,blankSection,defaultTruckPayloadTonnes,draftFromPavementForm,emptyPavementForm,looseFactorOfPavementForm,pavementFormFromRecord,ratePageIssue,rateOfPavementForm,trucksForPlanned,
  type PavementForm,
} from '../src/domain/pavementForm';
import {SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/** The Asphalt Calculator form: the three ways to give the area, how a form becomes a draft, and how a saved calculation reopens (DEC-518, DEC-519). */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

const road=[{name:'Station 0+000–0+010',length:'10',widthStart:'4',widthEnd:'4.4'},{name:'Station 0+010–0+030',length:'20',widthStart:'4.4',widthEnd:'6'}];
const form=(extra:Partial<PavementForm>={}):PavementForm=>({...emptyPavementForm('road'),name:'Wearing course',...extra});

describe('the three ways to give the area',()=>{
  it('reads Length × width, a Direct net area, or the total of the Road sections, each from its own fields',()=>{
    const all=form({length:'500',width:'7',directArea:'3480',sections:road});
    expect(areaOfPavementForm({...all,areaMode:'lw'}).areaM2).toBe(3500);
    expect(areaOfPavementForm({...all,areaMode:'direct'}).areaM2).toBe(3480);
    const sections=areaOfPavementForm({...all,areaMode:'sections'});
    expect(sections.areaM2).toBe(146);expect(sections.sections?.areas).toEqual([42,104]);expect(sections.sections?.errors).toEqual([]);
  });
  it('gives no area while a section has a problem, and says which',()=>{
    const result=areaOfPavementForm(form({areaMode:'sections',sections:[...road,{name:'',length:'',widthStart:'6',widthEnd:''}]}));
    expect(result.areaM2).toBe(0);expect(result.sections?.errors[0]).toBe('Section 3: enter a length greater than zero, or remove the section.');
  });
  it('starts with one blank section, which is a problem until it is filled in',()=>{
    expect(emptyPavementForm().sections).toEqual([blankSection()]);
    expect(areaOfPavementForm({...emptyPavementForm(),areaMode:'sections'}).areaM2).toBe(0);
  });
});

describe('from the form to a draft',()=>{
  it('keeps length and width for Length × width, and leaves the road sections out',()=>{
    expect(draftFromPavementForm(form({length:'500',width:'7',sections:road}))).toMatchObject({lengthM:500,widthM:7,areaM2:3500,areaSections:null,spreadRateKgM2:90,densityTM3:2.4});
  });
  it('leaves length and width empty for a Direct net area',()=>{
    expect(draftFromPavementForm(form({areaMode:'direct',directArea:'3480',length:'500',width:'7'}))).toMatchObject({lengthM:null,widthM:null,areaM2:3480,areaSections:null});
  });
  it('carries the sections and the total for Road sections',()=>{
    const draft=draftFromPavementForm(form({areaMode:'sections',sections:road,rateId:'custom',customRate:'95',allowance:'5',looseFactorId:'1.20'}));
    expect(draft).toMatchObject({lengthM:null,widthM:null,areaM2:146,spreadRateKgM2:95,allowancePercent:5,looseThicknessFactor:1.2});
    expect(draft.areaSections).toEqual([{name:'Station 0+000–0+010',lengthM:10,widthStartM:4,widthEndM:4.4},{name:'Station 0+010–0+030',lengthM:20,widthStartM:4.4,widthEndM:6}]);
  });
  it('carries no sections while one has a problem',()=>{
    const draft=draftFromPavementForm(form({areaMode:'sections',sections:[...road,blankSection()]}));
    expect(draft.areaSections).toBeNull();expect(draft.areaM2).toBe(0);
  });
});

describe('what stops a page from moving on',()=>{
  it('needs a project, a name and a usable area on the Area page, and names a section\'s problem',()=>{
    const issue=(value:PavementForm)=>areaPageIssue(value,areaOfPavementForm(value));
    expect(issue(form({projectId:'',length:'500',width:'7'}))).toBe('Choose a project.');
    expect(issue(form({name:' ',length:'500',width:'7'}))).toBe('Enter a section or layer name.');
    expect(issue(form())).toBe('Enter a length and a width above zero.');
    expect(issue(form({areaMode:'direct'}))).toBe('Enter a net area above zero.');
    expect(issue(form({areaMode:'sections',sections:[blankSection()]}))).toBe('Section 1: enter a length greater than zero, or remove the section.');
    expect(issue(form({length:'500',width:'7'}))).toBeNull();expect(issue(form({areaMode:'sections',sections:road}))).toBeNull();
  });
  it('needs a spread rate, a density, a non-negative allowance and a factor above 1.00 up to 2.00 on the Rate page',()=>{
    expect(ratePageIssue(form())).toBeNull();
    expect(ratePageIssue(form({rateId:'custom',customRate:''}))).toBe('Enter a spread rate above zero.');
    expect(ratePageIssue(form({density:'0'}))).toBe('Compacted density must be greater than zero.');
    expect(ratePageIssue(form({allowance:'-1'}))).toBe('Allowance cannot be negative.');
    expect(ratePageIssue(form({looseFactorId:'custom',customLooseFactor:'2.5'}))).toBe('Loose-thickness factor must be greater than 1.00 and no more than 2.00.');
    expect(rateOfPavementForm(form({rateId:'120'}))).toBe(120);expect(looseFactorOfPavementForm(form())).toBeNull();
  });
});

describe('trucks for the planned quantity',()=>{
  it('divides the planned tonnes by the payload and rounds up, and gives nothing without a payload or a quantity',()=>{
    const planned=calculatePavement(146,90,2.4,5).plannedTonnes;
    expect(trucksForPlanned(planned,defaultTruckPayloadTonnes)).toBe(1);expect(trucksForPlanned(441,20)).toBe(23);
    expect(trucksForPlanned(planned,0)).toBeNull();expect(trucksForPlanned(0,20)).toBeNull();
  });
});

describe('saving and reopening in each way',()=>{
  async function roundTrip(value:PavementForm){
    const db=await migratedDatabaseWithProject(databases);
    const repository=new SqlitePavementRepository(db as never);
    const saved=await repository.saveCalculation(draftFromPavementForm(value));
    return pavementFormFromRecord(saved);
  }
  it('reopens a Road sections calculation in Road sections, with its sections and rate',async()=>{
    const back=await roundTrip(form({areaMode:'sections',sections:road,rateId:'custom',customRate:'95',allowance:'5',looseFactorId:'custom',customLooseFactor:'1.22',notes:'Bend at 0+020'}));
    expect(back).toMatchObject({areaMode:'sections',sections:road,rateId:'custom',customRate:'95',allowance:'5',looseFactorId:'custom',customLooseFactor:'1.22',notes:'Bend at 0+020',length:'',width:'',directArea:''});
  });
  it('reopens a Length × width calculation in Length × width',async()=>{
    expect(await roundTrip(form({length:'500',width:'7',looseFactorId:'1.20'}))).toMatchObject({areaMode:'lw',length:'500',width:'7',directArea:'',looseFactorId:'1.20',rateId:'90'});
  });
  it('reopens a Direct net area calculation in Direct net area',async()=>{
    expect(await roundTrip(form({areaMode:'direct',directArea:'3480'}))).toMatchObject({areaMode:'direct',directArea:'3480',length:'',width:''});
  });
});
