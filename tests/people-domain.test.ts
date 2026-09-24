import {describe,expect,it} from 'vitest';

import {
  describeRoleChange,filterPeople,findPersonNameConflict,isTruckCrewEligible,peopleRoleCounts,personNameKey,
  possibleDuplicatePersonIds,truckCrewRoleLabel,validatePersonDraft,type PersonProfile,
} from '../src/domain/people';

const person=(id:string,name:string,role:PersonProfile['role'],extra:Partial<PersonProfile>={}):PersonProfile=>({
  id,name,role,jobTitle:null,phone:null,licenseNumber:null,notes:null,isActive:true,roleHistory:[],createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',...extra,
});

describe('person name normalization (DEC-476)',()=>{
  it('trims, collapses internal whitespace and case-folds for the duplicate key',()=>{
    expect(personNameKey('  Ali   MANSOUR ')).toBe('ali mansour');
    expect(personNameKey('Élie\tKhoury')).toBe('élie khoury');
  });
  it('keeps Arabic names intact apart from whitespace',()=>{
    expect(personNameKey('  علي   منصور ')).toBe('علي منصور');
  });
});

describe('validatePersonDraft',()=>{
  it('requires a name and one of the three standard roles',()=>{
    expect(validatePersonDraft({name:'  ',role:'worker'})).toContain('Name is required.');
    expect(validatePersonDraft({name:'Ali',role:'foreman' as never})).toContain('Choose Worker, Driver, or Operator.');
    expect(validatePersonDraft({name:'Ali',role:'operator'})).toEqual([]);
  });
  it('rejects an excessively long name',()=>{
    expect(validatePersonDraft({name:'x'.repeat(81),role:'driver'})).toContain('Name must be 80 characters or fewer.');
    expect(validatePersonDraft({name:'x'.repeat(80),role:'driver'})).toEqual([]);
  });
});

describe('duplicate prevention across every role',()=>{
  const people=[person('p1','Ali Mansour','worker'),person('p2','Omar Haddad','driver',{isActive:false})];
  it('finds a person with the same normalized name whatever their role or active state',()=>{
    expect(findPersonNameConflict({name:' ali  mansour',role:'operator'},people)?.id).toBe('p1');
    expect(findPersonNameConflict({name:'OMAR HADDAD',role:'worker'},people)?.id).toBe('p2');
    expect(findPersonNameConflict({name:'New Person',role:'worker'},people)).toBeNull();
  });
  it('lets a person keep their own name while editing',()=>{
    expect(findPersonNameConflict({name:'Ali Mansour',role:'driver'},people,'p1')).toBeNull();
  });
  it('lets an existing legacy duplicate be edited without renaming it, but never creates a new one',()=>{
    const legacy=[person('w','Karim Nasser','worker'),person('d','Karim Nasser','driver')];
    expect(findPersonNameConflict({name:'Karim Nasser',role:'operator'},legacy,'d')).toBeNull();
    expect(findPersonNameConflict({name:'Karim Nasser',role:'operator'},legacy)).not.toBeNull();
    expect([...possibleDuplicatePersonIds(legacy)].sort()).toEqual(['d','w']);
    expect(possibleDuplicatePersonIds(people).size).toBe(0);
  });
});

describe('filtering and counting the People directory',()=>{
  const people=[
    person('a','Ali Mansour','worker',{jobTitle:'Steel fixer',phone:'71 000 000'}),
    person('b','Omar Haddad','driver',{licenseNumber:'L-77'}),
    person('c','Rami Saad','operator',{isActive:false}),
    person('d','Zein Operator','operator'),
  ];
  it('filters by role and searches name, job title, phone and licence',()=>{
    expect(filterPeople(people,'all','').map(value=>value.id)).toEqual(['a','b','c','d']);
    expect(filterPeople(people,'operator','').map(value=>value.id)).toEqual(['c','d']);
    expect(filterPeople(people,'all','steel').map(value=>value.id)).toEqual(['a']);
    expect(filterPeople(people,'all','l-77').map(value=>value.id)).toEqual(['b']);
    expect(filterPeople(people,'all','71000').map(value=>value.id)).toEqual(['a']);
    expect(filterPeople(people,'driver','ali')).toEqual([]);
  });
  it('counts active people per role for the filter chips',()=>{
    expect(peopleRoleCounts(people)).toEqual({all:3,worker:1,driver:1,operator:1});
  });
});

describe('role change confirmation',()=>{
  it('explains that history keeps the recorded role and only new selections change',()=>{
    const text=describeRoleChange(person('a','Ali Mansour','worker'),'driver');
    expect(text).toContain('Ali Mansour');
    expect(text).toContain('Worker');
    expect(text).toContain('Driver');
    expect(text).toMatch(/existing Daily Reports and receipts keep/i);
  });
  it('returns null when the role is unchanged',()=>{
    expect(describeRoleChange(person('a','Ali','worker'),'worker')).toBeNull();
  });
});

describe('truck crew eligibility for Make Receipt (DEC-477)',()=>{
  it('admits only active Drivers and Operators',()=>{
    expect(isTruckCrewEligible(person('a','A','driver'))).toBe(true);
    expect(isTruckCrewEligible(person('b','B','operator'))).toBe(true);
    expect(isTruckCrewEligible(person('c','C','worker'))).toBe(false);
    expect(isTruckCrewEligible(person('d','D','operator',{isActive:false}))).toBe(false);
  });
  it('labels a legacy receipt with no role snapshot as Driver, the only role it could have had',()=>{
    expect(truckCrewRoleLabel(null)).toBe('Driver');
    expect(truckCrewRoleLabel(undefined)).toBe('Driver');
    expect(truckCrewRoleLabel('driver')).toBe('Driver');
    expect(truckCrewRoleLabel('operator')).toBe('Operator');
  });
});
