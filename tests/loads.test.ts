import { describe, expect, it } from 'vitest';

import { calculateLoad, emptyLoadDraft, type ConversionOption, type LoadSetupOptions, validateLoadDraft } from '../src/domain/loads';

const conversion: ConversionOption = {
  id: 'conversion_kg_ton', name: 'Kilograms to metric tons', inputUnitId: 'kg',
  inputUnitName: 'Kilogram', inputUnitSymbol: 'kg', outputUnitId: 'ton',
  outputUnitName: 'Metric ton', outputUnitSymbol: 't', inputQuantity: 1000,
  outputQuantity: 1, decimalPlaces: 3, isActive: true,
};
const baseOptions: LoadSetupOptions = {
  customers: [{ id: 'outside', type: 'company', name: 'Outside Customer', phone: null, email: null, address: null, taxVatNumber: null, notes: null, isOwnCompany: false, isActive: true, mergedIntoId: null, createdAt: '', updatedAt: '' }],
  items: [{ id: 'asphalt', name: 'Asphalt', internalCode: null, categoryName: 'Produced', defaultPriceUsd: 90 }],
  projects: [], units: [], conversions: [conversion],
  drivers: [{ id: 'driver_1', name: 'Ali', phone: null, licenseNumber: null, notes: null, isActive: true }],
  trucks: [{ id: 'truck_1', plate: 'B123', makeModel: null, capacityKg: null, ownerName: null, notes: null, isActive: true }],
  workers: [], machines: [],
  companySettings: { companyName: 'DROMEX', logoUri: null, address: null, phone: null, email: null, taxVatNumber: null, receiptFooter: null, vatRatePercent: 11, updatedAt: '' },
};
const validDraft = { ...emptyLoadDraft, customerId: 'outside', destinationAddress: 'Beirut', itemId: 'asphalt', driverId: 'driver_1', truckId: 'truck_1', driverName: 'Ali', truckPlate: 'B123', emptyWeightKg: '10000', fullWeightKg: '30555', conversionId: conversion.id, unitPriceUsd: '90' };

describe('load calculations', () => {
  it('calculates whole-kilogram net weight and preserves three-decimal tons', () => {
    const result = calculateLoad(validDraft, conversion, 11);
    expect(result.netWeightKg).toBe(20555);
    expect(result.billedQuantity).toBe(20.555);
    expect(result.subtotalUsd).toBe(1849.95);
    expect(result.vatAmountUsd).toBe(203.49);
    expect(result.finalTotalUsd).toBe(2053.44);
  });

  it('distinguishes a blank price from an intentional zero price', () => {
    expect(calculateLoad({ ...validDraft, unitPriceUsd: '' }, conversion, 11).finalTotalUsd).toBeNull();
    expect(calculateLoad({ ...validDraft, unitPriceUsd: '0' }, conversion, 11).finalTotalUsd).toBe(0);
  });
});

describe('load confirmation validation', () => {
  it('accepts a complete outside-customer load with a destination', () => {
    expect(validateLoadDraft(validDraft, baseOptions)).toEqual([]);
  });

  it('requires destination context and rejects invalid weight relationships', () => {
    const issues = validateLoadDraft({ ...validDraft, destinationAddress: '', fullWeightKg: '9000' }, baseOptions);
    expect(issues).toContain('Select a project or enter a destination address.');
    expect(issues).toContain('Full weight must be greater than empty weight.');
  });

  it('requires an own-company customer to use its saved project', () => {
    const own = { ...baseOptions.customers[0]!, id: 'own', name: 'DROMEX', isOwnCompany: true };
    const options = { ...baseOptions, customers: [own] };
    expect(validateLoadDraft({ ...validDraft, customerId: 'own' }, options)).toContain('An own-company load requires a project.');
  });

  it('requires saved driver and truck selections rather than free text alone', () => {
    const issues = validateLoadDraft({ ...validDraft, driverId: '', truckId: '' }, baseOptions);
    expect(issues).toContain('Select a saved driver.');
    expect(issues).toContain('Select a saved truck.');
  });
});
