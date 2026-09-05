import { describe, expect, it } from 'vitest';
import { summarizeSupplierDeliveries, unassignedDeliveriesLabel, type QuarryPurchase } from '../src/domain/quarry';

function at<T>(items: T[], index: number): T {
  const value = items[index];
  if (!value) throw new Error(`expected an entry at index ${index}, found ${items.length}`);
  return value;
}

let sequence = 0;
function purchase(overrides: Partial<QuarryPurchase> = {}): QuarryPurchase {
  sequence += 1;
  return {
    id: `purchase_${sequence}`, purchaseNumber: `SL-${sequence}`, confirmedAt: `2026-08-${String(10 + (sequence % 15)).padStart(2, '0')}T10:00:00.000Z`,
    supplierId: 'supplier_1', supplierName: 'Main Quarry', projectId: 'project_1', projectName: 'Mountain Road',
    itemId: 'item_gravel', itemName: 'Gravel', itemCode: null, categoryName: 'Quarry',
    unitId: 'unit_m3', unitName: 'Cubic metre', unitSymbol: 'm³', quantityCubicMetres: 1,
    deliveryMethod: 'company', driverId: 'driver_1', driverName: 'Ali', truckId: 'truck_1', truckPlate: '123456',
    supplierTicketNumber: null, priceBasis: 'per_unit', unitPriceUsd: null, subtotalUsd: null,
    vatMode: 'company', vatInclusive: false, vatRatePercent: null, vatAmountUsd: null, finalTotalUsd: null,
    paymentStatus: 'Unpriced', notes: null, photos: [], status: 'Active', cancellationReason: null,
    cancelledAt: null, correctionHistory: [], updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('supplier material delivery summary', () => {
  it('sums the worked example: four gravel loads become 14 m³ across 4 deliveries', () => {
    const summary = summarizeSupplierDeliveries([
      purchase({ quantityCubicMetres: 4 }), purchase({ quantityCubicMetres: 3 }),
      purchase({ quantityCubicMetres: 5 }), purchase({ quantityCubicMetres: 2 }),
    ]);
    expect(summary).toHaveLength(1);
    const supplier = at(summary, 0);
    expect(supplier.supplierName).toBe('Main Quarry');
    expect(supplier.deliveries).toBe(4);
    expect(supplier.materialTotals).toHaveLength(1);
    expect(at(supplier.materialTotals, 0)).toMatchObject({ itemName: 'Gravel', unitSymbol: 'm³', quantity: 14, deliveries: 4 });
    expect(at(at(supplier.projectGroups, 0).materials, 0)).toMatchObject({ quantity: 14, deliveries: 4 });
  });

  it('never combines the same material recorded in different units', () => {
    const summary = summarizeSupplierDeliveries([
      purchase({ quantityCubicMetres: 6 }),
      purchase({ quantityCubicMetres: 9, unitId: 'unit_t', unitName: 'Tonne', unitSymbol: 't' }),
      purchase({ quantityCubicMetres: 4, unitId: 'unit_t', unitName: 'Tonne', unitSymbol: 't' }),
    ]);
    const materials = at(summary, 0).materialTotals;
    expect(materials).toHaveLength(2);
    expect(materials.map((material) => [material.unitSymbol, material.quantity, material.deliveries])).toEqual([['m³', 6, 1], ['t', 13, 2]]);
  });

  it('separates different materials and keeps them ordered by name', () => {
    const summary = summarizeSupplierDeliveries([
      purchase({ itemId: 'item_sand', itemName: 'Sand', quantityCubicMetres: 8 }),
      purchase({ quantityCubicMetres: 5 }),
      purchase({ itemId: 'item_base', itemName: 'Base course', quantityCubicMetres: 2 }),
    ]);
    expect(at(summary, 0).materialTotals.map((material) => material.itemName)).toEqual(['Base course', 'Gravel', 'Sand']);
  });

  it('groups by project and puts unassigned deliveries last under their own label', () => {
    const summary = summarizeSupplierDeliveries([
      purchase({ projectId: null, projectName: null, quantityCubicMetres: 7 }),
      purchase({ projectId: 'project_2', projectName: 'Coastal Road', quantityCubicMetres: 3 }),
      purchase({ quantityCubicMetres: 5 }),
    ]);
    const groups = at(summary, 0).projectGroups;
    expect(groups.map((group) => group.projectName)).toEqual(['Coastal Road', 'Mountain Road', unassignedDeliveriesLabel]);
    expect(at(groups, 2).projectId).toBeNull();
    expect(at(at(groups, 2).materials, 0)).toMatchObject({ quantity: 7, deliveries: 1 });
  });

  it('rolls supplier totals across project-linked and unassigned deliveries', () => {
    const summary = summarizeSupplierDeliveries([
      purchase({ quantityCubicMetres: 4 }),
      purchase({ projectId: 'project_2', projectName: 'Coastal Road', quantityCubicMetres: 6 }),
      purchase({ projectId: null, projectName: null, quantityCubicMetres: 10 }),
    ]);
    const supplier = at(summary, 0);
    expect(at(supplier.materialTotals, 0)).toMatchObject({ quantity: 20, deliveries: 3 });
    expect(supplier.projectGroups.map((group) => group.deliveries)).toEqual([1, 1, 1]);
    const perGroup = supplier.projectGroups.reduce((sum, group) => sum + group.materials.reduce((inner, material) => inner + material.quantity, 0), 0);
    expect(perGroup).toBe(at(supplier.materialTotals, 0).quantity);
  });

  it('excludes cancelled loads from every total but reports how many were excluded', () => {
    const summary = summarizeSupplierDeliveries([
      purchase({ quantityCubicMetres: 4 }),
      purchase({ quantityCubicMetres: 100, status: 'Cancelled', cancellationReason: 'Recorded twice', cancelledAt: '2026-08-20T10:00:00.000Z' }),
      purchase({ quantityCubicMetres: 6 }),
    ]);
    const supplier = at(summary, 0);
    expect(supplier.deliveries).toBe(2);
    expect(supplier.cancelledDeliveries).toBe(1);
    expect(at(supplier.materialTotals, 0)).toMatchObject({ quantity: 10, deliveries: 2 });
  });

  it('keeps a supplier whose only deliveries were cancelled, with no active totals', () => {
    const summary = summarizeSupplierDeliveries([purchase({ quantityCubicMetres: 9, status: 'Cancelled' })]);
    const supplier = at(summary, 0);
    expect(supplier).toMatchObject({ supplierName: 'Main Quarry', deliveries: 0, cancelledDeliveries: 1 });
    expect(supplier.materialTotals).toEqual([]);
    expect(supplier.projectGroups).toEqual([]);
  });

  it('separates suppliers and orders them by name', () => {
    const summary = summarizeSupplierDeliveries([
      purchase({ supplierId: 'supplier_2', supplierName: 'Zahle Quarry', quantityCubicMetres: 5 }),
      purchase({ quantityCubicMetres: 3 }),
      purchase({ supplierId: 'supplier_2', supplierName: 'Zahle Quarry', quantityCubicMetres: 2 }),
    ]);
    expect(summary.map((entry) => entry.supplierName)).toEqual(['Main Quarry', 'Zahle Quarry']);
    expect(at(at(summary, 0).materialTotals, 0).quantity).toBe(3);
    expect(at(at(summary, 1).materialTotals, 0)).toMatchObject({ quantity: 7, deliveries: 2 });
  });

  it('sums fractional quantities without floating point artefacts', () => {
    const summary = summarizeSupplierDeliveries([
      purchase({ quantityCubicMetres: 0.1 }), purchase({ quantityCubicMetres: 0.2 }), purchase({ quantityCubicMetres: 4.5 }),
    ]);
    expect(at(at(summary, 0).materialTotals, 0).quantity).toBe(4.8);
  });

  it('records the delivery window for each material total', () => {
    const summary = summarizeSupplierDeliveries([
      purchase({ quantityCubicMetres: 1, confirmedAt: '2026-08-14T10:00:00.000Z' }),
      purchase({ quantityCubicMetres: 1, confirmedAt: '2026-08-02T10:00:00.000Z' }),
      purchase({ quantityCubicMetres: 1, confirmedAt: '2026-08-21T10:00:00.000Z' }),
    ]);
    const material = at(at(summary, 0).materialTotals, 0);
    expect(material.firstDeliveryAt).toBe('2026-08-02T10:00:00.000Z');
    expect(material.lastDeliveryAt).toBe('2026-08-21T10:00:00.000Z');
  });

  it('returns nothing for an empty history', () => {
    expect(summarizeSupplierDeliveries([])).toEqual([]);
  });

  it('falls back to a readable name when a linked project lost its snapshot name', () => {
    const summary = summarizeSupplierDeliveries([purchase({ projectId: 'project_9', projectName: null, quantityCubicMetres: 2 })]);
    expect(at(at(summary, 0).projectGroups, 0)).toMatchObject({ projectId: 'project_9', projectName: 'Historical project' });
  });
});
