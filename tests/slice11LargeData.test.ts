import {describe,expect,it,vi} from 'vitest';
import {removeSlice11LargeData,seedSlice11LargeData,slice11LargeDataCounts} from '../src/data/testing/slice11LargeData';

function fakeDatabase(){
  const execStatements:string[]=[];
  const runStatements:{sql:string;args:unknown[]}[]=[];
  const db={
    execAsync:vi.fn(async(sql:string)=>{execStatements.push(sql);}),
    getFirstAsync:vi.fn(async()=>({count:4000})),
    runAsync:vi.fn(async(sql:string,...args:unknown[])=>{expect(args).toHaveLength((sql.match(/\?/g)??[]).length);runStatements.push({sql,args});return{};}),
    withTransactionAsync:vi.fn(async(action:()=>Promise<void>)=>action()),
  };
  return{db:db as never,execStatements,runStatements};
}

describe('Slice 11 large dashboard dataset',()=>{
  it('builds isolated bulk records for every dashboard relationship',async()=>{
    const{db,execStatements,runStatements}=fakeDatabase();
    const counts=await seedSlice11LargeData(db);
    const sql=execStatements.join('\n');
    expect(counts).toEqual({...slice11LargeDataCounts,payments:2669});
    expect(runStatements.filter(value=>value.sql.startsWith('INSERT INTO customers'))).toHaveLength(8);
    expect(runStatements.filter(value=>value.sql.startsWith('INSERT INTO projects'))).toHaveLength(12);
    expect(sql).toContain('n<4000');
    expect(sql).toContain('n<1000');
    expect(sql).toContain('n<800');
    expect(sql).toContain('n<900');
    expect(sql).toContain("'slice11_test_load_'");
    expect(sql).toContain("'slice11_test_payment_fuel_'");
  });

  it('removes only reserved Slice 11 test IDs',async()=>{
    const{db,execStatements}=fakeDatabase();
    await expect(removeSlice11LargeData(db)).resolves.toBe(4000);
    const deletes=execStatements.join('\n');
    expect(deletes).toContain("LIKE 'slice11_test_%'");
    expect(deletes).not.toMatch(/DELETE FROM \w+\s*;/);
  });
});
