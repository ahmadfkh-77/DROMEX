import {DatabaseSync} from 'node:sqlite';
import {afterEach, describe, expect, it} from 'vitest';

import {migrateDatabase} from '../src/data/database/migrations';
import {cyclopeanLiftFromRow, SqliteCyclopeanLiftRepository, type LiftRow} from '../src/data/repositories/SqliteCyclopeanLiftRepository';
import {SqliteWallRepository} from '../src/data/repositories/SqliteWallRepository';
import type {CyclopeanLiftDraft, ConcreteMatrixPhaseDraft, StonePhaseDraft} from '../src/domain/wallCyclopeanLift';

class TestDatabase {
  readonly raw: DatabaseSync;
  constructor() { this.raw = new DatabaseSync(':memory:'); }
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  runAsync(sql: string, ...params: unknown[]) { const result = this.raw.prepare(sql).run(...params as never[]); return Promise.resolve({changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid)}); }
  async withTransactionAsync(action: () => Promise<void>) { this.raw.exec('BEGIN'); try { await action(); this.raw.exec('COMMIT'); } catch (cause) { this.raw.exec('ROLLBACK'); throw cause; } }
  close() { this.raw.close(); }
}

const NOW = '2026-09-18T00:00:00.000Z';
const databases: TestDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

async function setup() {
  const db = new TestDatabase(); databases.push(db);
  await migrateDatabase(db as never);
  db.raw.exec(`
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('customer','company','Road Co',0,1,'${NOW}','${NOW}');
    INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('road','customer','Mountain Road','Aley','active','${NOW}','${NOW}',0);
    INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('bridge','customer','River Bridge','Zahle','active','${NOW}','${NOW}',0);
  `);
  const walls = new SqliteWallRepository(db as never);
  const lifts = new SqliteCyclopeanLiftRepository(db as never);
  const section = await walls.createConstructionSection({projectId: 'road', name: 'Section A', location: '', description: ''});
  const otherSection = await walls.createConstructionSection({projectId: 'bridge', name: 'Section B', location: '', description: ''});
  const foundation = await walls.createFoundation({
    projectId: 'road', constructionSectionId: section.id, reference: 'Foundation A', location: '', lengthM: 20, heightM: 3,
    bottomThicknessM: 1.5, topThicknessM: 1.5, deductionM3: 0, materialType: 'ready_mix', concretePurpose: 'footing',
    customPurposeId: null, quantity: 90, quantityUnit: 'm3', manualOverride: true, consumptionDate: '2026-09-01', notes: '',
  });
  const otherFoundation = await walls.createFoundation({
    projectId: 'bridge', constructionSectionId: otherSection.id, reference: 'Foundation B', location: '', lengthM: 10, heightM: 2,
    bottomThicknessM: 1, topThicknessM: 1, deductionM3: 0, materialType: 'ready_mix', concretePurpose: 'footing',
    customPurposeId: null, quantity: 20, quantityUnit: 'm3', manualOverride: true, consumptionDate: '2026-09-01', notes: '',
  });
  const wall = await walls.saveWall({
    projectId: 'road', name: 'Retaining wall A', system: 'cyclopean_concrete', purpose: 'retaining', lengthM: 20, heightM: 4,
    bottomThicknessM: 0.8, topThicknessM: 0.4, deductionM3: 0, allowancePercent: 0, notes: '', foundationId: foundation.id,
  });
  return {db, walls, lifts, section, foundation, otherFoundation, wall};
}

const liftDraft = (parentType: 'foundation' | 'wall', parentId: string, overrides: Partial<CyclopeanLiftDraft> = {}): CyclopeanLiftDraft => ({
  parentType, parentId, sequence: 1, reference: 'Lift 1', startElevationM: 0,
  geometry: {lengthM: 20, heightM: 1, bottomThicknessM: 1.5, topThicknessM: 1.5, deductionM3: 0}, notes: '', ...overrides,
});
const stoneDraft = (overrides: Partial<StonePhaseDraft> = {}): StonePhaseDraft => ({
  calculationDimensions: {lengthM: 20, heightM: 1, bottomThicknessM: 0.9, topThicknessM: 0.9, deductionM3: 0},
  actualStoneQuantityM3: null, manualOverride: false, workDate: null, position: null, offsets: null, notes: '', ...overrides,
});
const concreteDraft = (overrides: Partial<ConcreteMatrixPhaseDraft> = {}): ConcreteMatrixPhaseDraft => ({
  calculationMethod: 'estimated_matrix', independentDimensions: null, actualReadyMixQuantityM3: null,
  manualOverride: false, purpose: 'structural', workDate: null, notes: '', ...overrides,
});

describe('create/read/list: foundation lifts', () => {
  it('creates a lift under a foundation and reads it back', async () => {
    const {lifts, foundation} = await setup();
    const lift = await lifts.createLift(liftDraft('foundation', foundation.id));
    expect(lift).toMatchObject({parentType: 'foundation', parentId: foundation.id, sequence: 1, reference: 'Lift 1', netLiftVolumeM3: 30, status: 'planned', concretePhase: null});
    expect(await lifts.getLift(lift.id)).toMatchObject({id: lift.id});
  });
  it('lists a foundation\'s lifts in deterministic sequence order regardless of creation order', async () => {
    const {lifts, foundation} = await setup();
    await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 2, reference: 'Lift 2', startElevationM: 1}));
    await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1, reference: 'Lift 1'}));
    const list = await lifts.listLiftsForFoundation(foundation.id);
    expect(list.map(l => l.reference)).toEqual(['Lift 1', 'Lift 2']);
  });
});

describe('create/read/list: wall lifts', () => {
  it('creates a lift under a wall and reads it back', async () => {
    const {lifts, wall} = await setup();
    const lift = await lifts.createLift(liftDraft('wall', wall.id, {geometry: {lengthM: 20, heightM: 1, bottomThicknessM: 0.8, topThicknessM: 0.6, deductionM3: 0}}));
    expect(lift).toMatchObject({parentType: 'wall', parentId: wall.id, status: 'planned'});
    const list = await lifts.listLiftsForWall(wall.id);
    expect(list.map(l => l.id)).toEqual([lift.id]);
  });
});

describe('exactly-one-parent and wrong-parent enforcement', () => {
  it('refuses a foundation-typed draft whose parentId does not exist as a foundation', async () => {
    const {lifts} = await setup();
    await expect(lifts.createLift(liftDraft('foundation', 'not-a-foundation'))).rejects.toThrow(/Foundation was not found/);
  });
  it('refuses a wall-typed draft whose parentId is actually a foundation id', async () => {
    const {lifts, foundation} = await setup();
    await expect(lifts.createLift(liftDraft('wall', foundation.id))).rejects.toThrow(/Wall was not found/);
  });
});

describe('cross-project refusal is not applicable at creation (a lift only ever targets one already-resolved parent), but reconciliation stays scoped to that parent alone', () => {
  it('does not mix lifts belonging to two different foundations in two different projects', async () => {
    const {lifts, foundation, otherFoundation} = await setup();
    await lifts.createLift(liftDraft('foundation', foundation.id, {reference: 'Road lift'}));
    await lifts.createLift(liftDraft('foundation', otherFoundation.id, {reference: 'Bridge lift', geometry: {lengthM: 10, heightM: 2, bottomThicknessM: 1, topThicknessM: 1, deductionM3: 0}}));
    expect((await lifts.listLiftsForFoundation(foundation.id)).map(l => l.reference)).toEqual(['Road lift']);
    expect((await lifts.listLiftsForFoundation(otherFoundation.id)).map(l => l.reference)).toEqual(['Bridge lift']);
  });
});

describe('duplicate sequence refusal', () => {
  it('refuses a second lift with the same sequence on the same foundation', async () => {
    const {lifts, foundation} = await setup();
    await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1}));
    await expect(lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1, reference: 'Lift 1 again'}))).rejects.toThrow(/sequence/i);
  });
  it('allows the same sequence number reused on a different parent', async () => {
    const {lifts, foundation, wall} = await setup();
    await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1}));
    await expect(lifts.createLift(liftDraft('wall', wall.id, {sequence: 1, geometry: {lengthM: 20, heightM: 1, bottomThicknessM: 0.8, topThicknessM: 0.6, deductionM3: 0}}))).resolves.toMatchObject({sequence: 1});
  });
});

describe('lift allocation against the parent envelope', () => {
  it('refuses a lift whose structural volume would exceed the foundation\'s net volume', async () => {
    const {lifts, foundation} = await setup();
    await expect(lifts.createLift(liftDraft('foundation', foundation.id, {geometry: {lengthM: 20, heightM: 10, bottomThicknessM: 1.5, topThicknessM: 1.5, deductionM3: 0}})))
      .rejects.toThrow(/more than the available structural envelope/);
  });
});

describe('Stone-only pending lift and complete lift with concrete', () => {
  it('is stone_placed (concrete pending) once a Stone phase is saved with no concrete phase yet', async () => {
    const {lifts, foundation} = await setup();
    const lift = await lifts.createLift(liftDraft('foundation', foundation.id));
    const withStone = await lifts.saveStonePhase(lift.id, stoneDraft({actualStoneQuantityM3: 17, workDate: '2026-09-02'}));
    expect(withStone.status).toBe('stone_placed');
    expect(withStone.concretePhase).toBeNull();
    expect(withStone.stonePhase.calculatedStoneVolumeM3).toBe(18);
  });
  it('becomes completed once the concrete matrix phase is recorded', async () => {
    const {lifts, foundation} = await setup();
    const lift = await lifts.createLift(liftDraft('foundation', foundation.id));
    await lifts.saveStonePhase(lift.id, stoneDraft({actualStoneQuantityM3: 17, workDate: '2026-09-02'}));
    const completed = await lifts.saveConcreteMatrixPhase(lift.id, concreteDraft({actualReadyMixQuantityM3: 13, workDate: '2026-09-03'}));
    expect(completed.status).toBe('completed');
    expect(completed.concretePhase).toMatchObject({liftId: lift.id, estimatedMatrixVolumeM3: 12, actualReadyMixQuantityM3: 13});
  });
});

describe('concrete linked to the exact lift it was saved against', () => {
  it('never lets a second lift\'s concrete phase attach to the first lift\'s row', async () => {
    const {lifts, foundation} = await setup();
    const lift1 = await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1, reference: 'Lift 1'}));
    const lift2 = await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 2, reference: 'Lift 2', geometry: {lengthM: 20, heightM: 1, bottomThicknessM: 1, topThicknessM: 1, deductionM3: 0}}));
    await lifts.saveStonePhase(lift1.id, stoneDraft({actualStoneQuantityM3: 5}));
    await lifts.saveStonePhase(lift2.id, stoneDraft({actualStoneQuantityM3: 6, workDate: '2026-09-02'}));
    const lift2Concrete = await lifts.saveConcreteMatrixPhase(lift2.id, concreteDraft({actualReadyMixQuantityM3: 4}));
    expect(lift2Concrete.concretePhase?.liftId).toBe(lift2.id);
    const lift1Reread = await lifts.getLift(lift1.id);
    expect(lift1Reread?.concretePhase).toBeNull();
  });
});

describe('manual overrides and actual variance', () => {
  it('keeps the calculated Stone volume even when the actual quantity is overridden', async () => {
    const {lifts, foundation} = await setup();
    const lift = await lifts.createLift(liftDraft('foundation', foundation.id));
    const withStone = await lifts.saveStonePhase(lift.id, stoneDraft({actualStoneQuantityM3: 20, manualOverride: true, workDate: '2026-09-02'}));
    expect(withStone.stonePhase).toMatchObject({calculatedStoneVolumeM3: 18, actualStoneQuantityM3: 20, manualOverride: true});
  });
  it('reports variance between the estimated matrix requirement and the actual Ready Mix recorded', async () => {
    const {lifts, foundation} = await setup();
    const lift = await lifts.createLift(liftDraft('foundation', foundation.id));
    await lifts.saveStonePhase(lift.id, stoneDraft({actualStoneQuantityM3: 18, workDate: '2026-09-02'}));
    const withConcrete = await lifts.saveConcreteMatrixPhase(lift.id, concreteDraft({actualReadyMixQuantityM3: 15, manualOverride: true, workDate: '2026-09-03'}));
    expect(withConcrete.concretePhase).toMatchObject({estimatedMatrixVolumeM3: 12, actualReadyMixQuantityM3: 15, manualOverride: true});
  });
});

describe('correction history', () => {
  it('records a reasoned correction to the lift geometry with before/after values', async () => {
    const {lifts, foundation} = await setup();
    const lift = await lifts.createLift(liftDraft('foundation', foundation.id));
    const corrected = await lifts.correctLift(lift.id, {reference: 'Lift 1 (corrected)', startElevationM: 0, geometry: lift.geometry, notes: 'renamed', correctionReason: 'Site survey renamed the lift'});
    expect(corrected.reference).toBe('Lift 1 (corrected)');
    expect(corrected.correctionHistory).toHaveLength(1);
    expect(corrected.correctionHistory[0]).toMatchObject({reason: 'Site survey renamed the lift'});
    expect(corrected.correctionHistory[0]?.changes).toEqual(expect.arrayContaining([{field: 'Reference', originalValue: 'Lift 1', newValue: 'Lift 1 (corrected)'}]));
  });
  it('refuses a correction with no reason', async () => {
    const {lifts, foundation} = await setup();
    const lift = await lifts.createLift(liftDraft('foundation', foundation.id));
    await expect(lifts.correctLift(lift.id, {reference: 'Renamed', startElevationM: 0, geometry: lift.geometry, notes: '', correctionReason: '  '})).rejects.toThrow(/correction reason/i);
  });
  it('refuses a correction that changes nothing', async () => {
    const {lifts, foundation} = await setup();
    const lift = await lifts.createLift(liftDraft('foundation', foundation.id));
    await expect(lifts.correctLift(lift.id, {reference: lift.reference, startElevationM: lift.startElevationM, geometry: lift.geometry, notes: lift.notes, correctionReason: 'no-op'})).rejects.toThrow(/Nothing changed/);
  });
});

describe('transaction rollback', () => {
  it('leaves no partial lift row behind when saving an invalid Stone phase fails', async () => {
    const {db, lifts, foundation} = await setup();
    const lift = await lifts.createLift(liftDraft('foundation', foundation.id));
    await expect(lifts.saveStonePhase(lift.id, stoneDraft({calculationDimensions: {lengthM: 20, heightM: 10, bottomThicknessM: 1.5, topThicknessM: 1.5, deductionM3: 0}})))
      .rejects.toThrow(/cannot exceed this lift's net structural volume/);
    const row = db.raw.prepare('SELECT stone_calculated_volume_m3 FROM cyclopean_lifts WHERE id=?').get(lift.id) as {stone_calculated_volume_m3: number};
    expect(row.stone_calculated_volume_m3).toBe(0);
  });
});

describe('duplicate creation is refused, not silently deduplicated', () => {
  it('two lifts submitted with the same sequence for the same parent: the second is refused, the first stands', async () => {
    const {lifts, foundation} = await setup();
    const first = await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1}));
    await expect(lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1}))).rejects.toThrow(/sequence/i);
    expect((await lifts.listLiftsForFoundation(foundation.id)).map(l => l.id)).toEqual([first.id]);
  });
});

describe('reordering planned lifts', () => {
  it('reassigns sequence numbers only among lifts that are still planned', async () => {
    const {lifts, foundation} = await setup();
    const a = await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1, reference: 'A'}));
    const b = await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 2, reference: 'B', startElevationM: 1}));
    const reordered = await lifts.reorderPlannedLifts('foundation', foundation.id, [b.id, a.id]);
    expect(reordered.map(l => l.reference)).toEqual(['B', 'A']);
    expect(reordered.map(l => l.sequence)).toEqual([1, 2]);
  });
  it('refuses to reorder when a stone_placed or completed lift is included', async () => {
    const {lifts, foundation} = await setup();
    const a = await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1, reference: 'A'}));
    const b = await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 2, reference: 'B', startElevationM: 1}));
    await lifts.saveStonePhase(a.id, stoneDraft({actualStoneQuantityM3: 5, workDate: '2026-09-02'}));
    await expect(lifts.reorderPlannedLifts('foundation', foundation.id, [b.id, a.id])).rejects.toThrow(/planned/i);
  });
  it('refuses a reorder that omits one of the parent\'s current planned lifts', async () => {
    const {lifts, foundation} = await setup();
    const a = await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1, reference: 'A'}));
    await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 2, reference: 'B', startElevationM: 1}));
    await expect(lifts.reorderPlannedLifts('foundation', foundation.id, [a.id])).rejects.toThrow(/exactly/i);
  });
});

describe('parent totals through the approved domain functions', () => {
  it('reconciles a foundation\'s allocated volume, remaining capacity, and material totals', async () => {
    const {lifts, foundation} = await setup();
    const lift1 = await lifts.createLift(liftDraft('foundation', foundation.id, {sequence: 1, geometry: {lengthM: 20, heightM: 1, bottomThicknessM: 1.5, topThicknessM: 1.5, deductionM3: 0}}));
    await lifts.saveStonePhase(lift1.id, stoneDraft({actualStoneQuantityM3: 18, workDate: '2026-09-02'}));
    await lifts.saveConcreteMatrixPhase(lift1.id, concreteDraft({actualReadyMixQuantityM3: 12, workDate: '2026-09-03'}));
    const reconciliation = await lifts.reconcileFoundation(foundation.id);
    expect(reconciliation).toMatchObject({totalAllocatedLiftVolumeM3: 30, remainingUnallocatedVolumeM3: 60, totalCalculatedStoneM3: 18, totalActualStoneM3: 18, totalEstimatedConcreteM3: 12, totalActualReadyMixM3: 12, totalVarianceM3: 0});
  });
  it('reconciles a wall the same way', async () => {
    const {lifts, wall} = await setup();
    await lifts.createLift(liftDraft('wall', wall.id, {geometry: {lengthM: 20, heightM: 1, bottomThicknessM: 0.8, topThicknessM: 0.6, deductionM3: 0}}));
    const reconciliation = await lifts.reconcileWall(wall.id);
    expect(reconciliation.totalAllocatedLiftVolumeM3).toBe(14);
  });
});

describe('hydration fails closed on a stored status that disagrees with the phase data', () => {
  const row = (overrides: Partial<LiftRow> = {}): LiftRow => ({
    id: 'lift-x', parent_type: 'foundation', foundation_id: 'foundation-x', wall_id: null, sequence: 1, reference: 'Lift X', start_elevation_m: 0,
    length_m: 10, height_m: 1, bottom_thickness_m: 1, top_thickness_m: 1, deduction_m3: 0, net_lift_volume_m3: 10, status: 'planned',
    stone_calc_length_m: null, stone_calc_height_m: null, stone_calc_bottom_thickness_m: null, stone_calc_top_thickness_m: null,
    stone_calc_deduction_m3: null, stone_calc_gross_volume_m3: null, stone_calc_net_volume_m3: null,
    stone_calculated_volume_m3: 0, stone_actual_quantity_m3: null, stone_manual_override: 0, stone_work_date: null,
    stone_position_x: null, stone_position_y: null, stone_offsets_json: null, stone_notes: null,
    concrete_calculation_method: null, concrete_estimated_matrix_volume_m3: null,
    concrete_calc_length_m: null, concrete_calc_height_m: null, concrete_calc_bottom_thickness_m: null, concrete_calc_top_thickness_m: null,
    concrete_calc_deduction_m3: null, concrete_calc_gross_volume_m3: null, concrete_calc_net_volume_m3: null,
    concrete_actual_ready_mix_m3: null, concrete_manual_override: 0, concrete_purpose: null, concrete_work_date: null, concrete_notes: null,
    notes: null, correction_history_json: '[]', created_at: NOW, updated_at: null, ...overrides,
  });
  it('accepts a genuinely consistent planned row', () => { expect(() => cyclopeanLiftFromRow(row())).not.toThrow(); });
  it('accepts a genuinely consistent stone_placed row', () => { expect(() => cyclopeanLiftFromRow(row({status: 'stone_placed', stone_actual_quantity_m3: 6}))).not.toThrow(); });
  it('accepts a genuinely consistent completed row', () => { expect(() => cyclopeanLiftFromRow(row({status: 'completed', stone_actual_quantity_m3: 6, concrete_calculation_method: 'estimated_matrix', concrete_actual_ready_mix_m3: 4}))).not.toThrow(); });
  it('throws (fails closed) for a row stored as planned but carrying Stone fields', () => {
    expect(() => cyclopeanLiftFromRow(row({status: 'planned', stone_actual_quantity_m3: 6}))).toThrow(/disagrees with the Stone\/concrete phase data/);
  });
  it('throws (fails closed) for a row stored as stone_placed with no Stone recorded', () => {
    expect(() => cyclopeanLiftFromRow(row({status: 'stone_placed'}))).toThrow(/disagrees with the Stone\/concrete phase data/);
  });
  it('throws (fails closed) for a row stored as completed with no concrete phase recorded', () => {
    expect(() => cyclopeanLiftFromRow(row({status: 'completed', stone_actual_quantity_m3: 6}))).toThrow(/disagrees with the Stone\/concrete phase data/);
  });
});

describe('legacy read representation', () => {
  it('exposes an existing single-core foundation as an imported legacy composite stage without inventing lifts', async () => {
    const {walls, lifts, foundation} = await setup();
    await walls.setFoundationMode(foundation.id, 'composite', 'simple');
    await walls.addFoundationCompositionRecord({foundationId: foundation.id, materialType: 'stone', quantityM3: 20, recordedOn: '2026-09-02', notes: ''});
    await walls.addFoundationCompositionRecord({foundationId: foundation.id, materialType: 'ready_mix', quantityM3: 65, recordedOn: '2026-09-03', notes: ''});
    const legacy = await lifts.getLegacyCompositeStage(foundation.id);
    expect(legacy).toMatchObject({label: 'Imported legacy composite stage', netFoundationVolumeM3: 90, activeStoneM3: 20, estimatedConcreteM3: 70, activeReadyMixM3: 65});
    expect(await lifts.listLiftsForFoundation(foundation.id)).toEqual([]);
  });
  it('returns null for a foundation that has never used the single-core composite model', async () => {
    const {lifts, foundation} = await setup();
    expect(await lifts.getLegacyCompositeStage(foundation.id)).toBeNull();
  });
  it('leaves the legacy composition records unchanged after new lift work is recorded on the same foundation', async () => {
    const {walls, lifts, foundation} = await setup();
    await walls.setFoundationMode(foundation.id, 'composite', 'simple');
    const record = await walls.addFoundationCompositionRecord({foundationId: foundation.id, materialType: 'stone', quantityM3: 10, recordedOn: '2026-09-02', notes: ''});
    await lifts.createLift(liftDraft('foundation', foundation.id));
    const stillThere = (await walls.getFoundationComposition(foundation.id))!.records.find(r => r.id === record.id);
    expect(stillThere).toMatchObject({quantityM3: 10});
  });
});
