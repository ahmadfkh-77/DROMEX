import { describe, expect, it } from 'vitest';

import { calculateLoad, createAnotherItemDraft, emptyLoadDraft, type ConversionOption, type LoadSetupOptions, validateLoadDraft } from '../src/domain/loads';

const conversion: ConversionOption = {
  id: 'conversion_kg_ton', name: 'Kilograms to metric tons', inputUnitId: 'kg',
  inputUnitName: 'Kilogram', inputUnitSymbol: 'kg', outputUnitId: 'ton',
  outputUnitName: 'Metric ton', outputUnitSymbol: 't', inputQuantity: 1000,
  outputQuantity: 1, decimalPlaces: 3, isActive: true,
};
const baseOptions: LoadSetupOptions = {
  customers: [{ id: 'outside', type: 'company', name: 'Outside Customer', phone: null, email: null, address: null, taxVatNumber: null, notes: null, isOwnCompany: false, isActive: true, mergedIntoId: null, createdAt: '', updatedAt: '' }],
  items: [{ id: 'asphalt', name: 'Asphalt', internalCode: null, categoryName: 'Produced', defaultPriceUsd: 90, defaultUnitId: 'unit_ton' }],
  projects: [], units: [{id:'unit_piece',name:'Piece',symbol:'pc',isActive:true}], conversions: [conversion],
  drivers: [{ id: 'driver_1', name: 'Ali', phone: null, licenseNumber: null, notes: null, isActive: true }],
  trucks: [{ id: 'truck_1', plate: 'B123', makeModel: null, capacityKg: null, ownerName: null, notes: null, isActive: true }],
  workers: [], machines: [],
  companySettings: { companyName: 'DROMEX', logoUri: null, address: null, phone: null, email: null, taxVatNumber: null, receiptFooter: null, ministryName: null, ministryLogoUri: null, consultingAgencyName: null, vatRatePercent: 11, updatedAt: '' },
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

  it('calculates a direct pipe quantity without scale weights or conversion', () => {
    const direct={...validDraft,quantityMethod:'direct' as const,directQuantity:'50',directUnitId:'unit_piece',emptyWeightKg:'',fullWeightKg:'',conversionId:'',unitPriceUsd:'4.25'};
    const result=calculateLoad(direct,undefined,11);
    expect(result).toMatchObject({netWeightKg:null,billedQuantity:50,subtotalUsd:212.5,vatAmountUsd:23.38,finalTotalUsd:235.88});
    expect(validateLoadDraft(direct,baseOptions)).toEqual([]);
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
  it('rejects prices with more than two decimals or scientific notation',()=>{
    expect(validateLoadDraft({...validDraft,unitPriceUsd:'10.999'},baseOptions)).toContain('Unit price must be zero or more with no more than two decimals.');
    expect(validateLoadDraft({...validDraft,unitPriceUsd:'1e3'},baseOptions)).toContain('Unit price must be zero or more with no more than two decimals.');
  });
  it('rejects decimal, negative, and scientific-notation scale weights',()=>{
    expect(validateLoadDraft({...validDraft,emptyWeightKg:'10000.5'},baseOptions)).toContain('Empty weight must be a whole kilogram value.');
    expect(validateLoadDraft({...validDraft,fullWeightKg:'-20000'},baseOptions)).toContain('Full weight must be a whole kilogram value.');
    expect(validateLoadDraft({...validDraft,fullWeightKg:'3e4'},baseOptions)).toContain('Full weight must be a whole kilogram value.');
  });
  it('rejects inactive or missing catalog selections',()=>{
    expect(validateLoadDraft({...validDraft,itemId:'missing'},baseOptions)).toContain('Select a load-enabled item.');
    expect(validateLoadDraft({...validDraft,conversionId:'missing'},baseOptions)).toContain('Select a conversion.');
  });
  it('requires a positive direct quantity and saved unit but not weights or conversion',()=>{
    const direct={...validDraft,quantityMethod:'direct' as const,directQuantity:'0',directUnitId:'missing',emptyWeightKg:'',fullWeightKg:'',conversionId:''};
    const issues=validateLoadDraft(direct,baseOptions);
    expect(issues).toContain('Direct quantity must be greater than zero with no more than six decimals.');
    expect(issues).toContain('Select the direct quantity unit.');
    expect(issues).not.toContain('Select a conversion.');
    expect(issues.some(issue=>issue.includes('weight'))).toBe(false);
  });
  it('rejects a project belonging to another customer',()=>{
    const options={...baseOptions,projects:[{id:'project_1',name:'Other job',customerId:'someone_else',customerName:'Other',location:'Beirut',status:'active' as const,notes:null}]};
    expect(validateLoadDraft({...validDraft,projectId:'project_1'},options)).toContain('The selected project belongs to another customer.');
  });
});

describe('createAnotherItemDraft (Create Another Item for Same Delivery)', () => {
  const confirmedDeliverySource = Object.freeze({
    ...validDraft,
    projectId: 'project_9',
    quantityMethod: 'direct' as const,
    directQuantity: '50',
    directUnitId: 'unit_piece',
    conversionId: conversion.id,
    unitPriceUsd: '90',
    notes: 'Fragile load, handle with care',
    requestedQuantityKg: '20000',
    emptyWeightKg: '10000',
    fullWeightKg: '30555',
  });

  it('copies every approved shared-delivery field', () => {
    const next = createAnotherItemDraft(confirmedDeliverySource);
    expect(next.recordDate).toBe(confirmedDeliverySource.recordDate);
    expect(next.customerId).toBe(confirmedDeliverySource.customerId);
    expect(next.projectId).toBe(confirmedDeliverySource.projectId);
    expect(next.destinationAddress).toBe(confirmedDeliverySource.destinationAddress);
    expect(next.driverId).toBe(confirmedDeliverySource.driverId);
    expect(next.driverName).toBe(confirmedDeliverySource.driverName);
    expect(next.truckId).toBe(confirmedDeliverySource.truckId);
    expect(next.truckPlate).toBe(confirmedDeliverySource.truckPlate);
  });

  it('returns the standard default quantity method, never the source method', () => {
    expect(confirmedDeliverySource.quantityMethod).toBe('direct');
    const next = createAnotherItemDraft(confirmedDeliverySource);
    expect(next.quantityMethod).toBe('weighbridge');
    expect(next.quantityMethod).toBe(emptyLoadDraft.quantityMethod);
  });

  it('resets every item, weight, quantity, conversion, price, and notes field to the empty-draft defaults', () => {
    const next = createAnotherItemDraft(confirmedDeliverySource);
    expect(next.itemId).toBe(emptyLoadDraft.itemId);
    expect(next.requestedQuantityKg).toBe(emptyLoadDraft.requestedQuantityKg);
    expect(next.emptyWeightKg).toBe(emptyLoadDraft.emptyWeightKg);
    expect(next.fullWeightKg).toBe(emptyLoadDraft.fullWeightKg);
    expect(next.conversionId).toBe(emptyLoadDraft.conversionId);
    expect(next.directQuantity).toBe(emptyLoadDraft.directQuantity);
    expect(next.directUnitId).toBe(emptyLoadDraft.directUnitId);
    expect(next.unitPriceUsd).toBe(emptyLoadDraft.unitPriceUsd);
    expect(next.notes).toBe(emptyLoadDraft.notes);
  });

  it('carries no confirmed-record identity or calculated data — the result is exactly a fresh LoadDraft', () => {
    const next = createAnotherItemDraft(confirmedDeliverySource);
    expect(Object.keys(next).sort()).toEqual(Object.keys(emptyLoadDraft).sort());
    expect(next).not.toHaveProperty('id');
    expect(next).not.toHaveProperty('transactionNumber');
    expect(next).not.toHaveProperty('confirmedAt');
    expect(next).not.toHaveProperty('billedQuantity');
    expect(next).not.toHaveProperty('convertedQuantity');
    expect(next).not.toHaveProperty('finalTotalUsd');
    expect(next).not.toHaveProperty('signaturePaths');
  });

  it('never mutates the source draft or confirmed record it reads from', () => {
    // confirmedDeliverySource is frozen: any attempted write inside createAnotherItemDraft throws immediately.
    expect(() => createAnotherItemDraft(confirmedDeliverySource)).not.toThrow();
    const before = { ...confirmedDeliverySource };
    const next = createAnotherItemDraft(confirmedDeliverySource);
    expect(confirmedDeliverySource).toEqual(before);
    next.notes = 'edited only on the new draft';
    next.itemId = 'a-different-item';
    expect(confirmedDeliverySource.notes).toBe(before.notes);
    expect(confirmedDeliverySource.itemId).toBe(before.itemId);
  });
});
