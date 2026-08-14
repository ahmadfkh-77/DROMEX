import {describe, expect, it, vi} from 'vitest';

import {removeLinkedDemoData, seedLinkedDemoData} from '../src/data/testing/linkedDemoData';

type RecordedStatement={sql:string;args:unknown[]};

function fakeDatabase(){
  const statements:RecordedStatement[]=[];
  const db={
    getFirstAsync:vi.fn(async(sql:string)=>sql.includes('COUNT(*)')?{count:0}:{
      company_name:'DROMEX',address:null,phone:null,email:null,tax_vat_number:null,receipt_footer:null,logo_uri:null,
    }),
    runAsync:vi.fn(async(sql:string,...args:unknown[])=>{
      expect(args).toHaveLength((sql.match(/\?/g)??[]).length);
      statements.push({sql,args});
      return{};
    }),
    withTransactionAsync:vi.fn(async(action:()=>Promise<void>)=>action()),
  };
  return{db:db as never,statements};
}

describe('Slice 8 Tests representative records',()=>{
  it('creates a complete linked and clearly labelled workbook test set',async()=>{
    const{db,statements}=fakeDatabase();
    const counts=await seedLinkedDemoData(db);

    expect(counts).toEqual({customers:2,suppliers:2,projects:3,reports:7,loads:22,quarryPurchases:4,fuelMovements:4,wasteDumps:7,payments:20,openingBalances:2});
    expect(statements.filter(v=>v.sql.startsWith('INSERT INTO suppliers'))).toHaveLength(2);
    expect(statements.filter(v=>v.sql.startsWith('INSERT INTO quarry_purchases'))).toHaveLength(4);
    expect(statements.filter(v=>v.sql.startsWith('INSERT INTO fuel_movements'))).toHaveLength(4);
    expect(statements.filter(v=>v.sql.startsWith('INSERT INTO payment_entries'))).toHaveLength(20);
    expect(statements.flatMap(v=>v.args).filter(v=>typeof v==='string')).toContain('Slice 8 Tests - Riverside Drainage Upgrade');
    expect(statements.flatMap(v=>v.args).filter(v=>typeof v==='string')).toContain('Slice 8 Tests - Cedar Quarry');
  });

  it('removes new Slice 8 IDs and legacy demo IDs without broad production deletes',async()=>{
    const{db,statements}=fakeDatabase();
    await removeLinkedDemoData(db);
    const deletes=statements.filter(v=>v.sql.startsWith('DELETE FROM')).map(v=>v.sql).join('\n');

    expect(deletes).toContain("id LIKE 'slice8_test_%'");
    expect(deletes).toContain("id LIKE 'demo_linked_%'");
    expect(deletes).not.toMatch(/DELETE FROM \w+\s*$/m);
  });
});
