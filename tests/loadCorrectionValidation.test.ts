import {describe,expect,it} from 'vitest';
import {correctionValidationError} from '../src/domain/loads';
import type {ConfirmedLoad,LoadCorrectionDraft} from '../src/domain/loads';

const weighbridgeLoad={quantityMethod:'weighbridge'} as unknown as ConfirmedLoad;
const directLoad={quantityMethod:'direct'} as unknown as ConfirmedLoad;

const baseDraft:LoadCorrectionDraft={requestedQuantityKg:'',emptyWeightKg:'10000',fullWeightKg:'30000',directQuantity:'',unitPriceUsd:'',destinationAddress:'',notes:'',correctionReason:'Fix weight'};

describe('correctionValidationError (mirrors correctLoad server-side validation)',()=>{
  it('accepts a valid weighbridge correction',()=>{
    expect(correctionValidationError(weighbridgeLoad,baseDraft)).toBeNull();
  });

  it('rejects a blank empty or full weight instead of silently treating it as unchanged',()=>{
    expect(correctionValidationError(weighbridgeLoad,{...baseDraft,emptyWeightKg:''})).toBe('Empty and full weights must be whole kilogram values.');
    expect(correctionValidationError(weighbridgeLoad,{...baseDraft,fullWeightKg:''})).toBe('Empty and full weights must be whole kilogram values.');
  });

  it('rejects a non-integer empty or full weight',()=>{
    expect(correctionValidationError(weighbridgeLoad,{...baseDraft,emptyWeightKg:'10000.5'})).toBe('Empty and full weights must be whole kilogram values.');
  });

  it('rejects a full weight that is not greater than the empty weight',()=>{
    expect(correctionValidationError(weighbridgeLoad,{...baseDraft,emptyWeightKg:'30000',fullWeightKg:'30000'})).toBe('Full weight must be greater than empty weight.');
    expect(correctionValidationError(weighbridgeLoad,{...baseDraft,emptyWeightKg:'30000',fullWeightKg:'20000'})).toBe('Full weight must be greater than empty weight.');
  });

  it('rejects a non-integer requested quantity when one is provided',()=>{
    expect(correctionValidationError(weighbridgeLoad,{...baseDraft,requestedQuantityKg:'12.5'})).toBe('Requested quantity must be a whole kilogram value.');
  });

  it('allows a blank requested quantity since it is optional',()=>{
    expect(correctionValidationError(weighbridgeLoad,{...baseDraft,requestedQuantityKg:''})).toBeNull();
  });

  it('accepts a valid direct-quantity correction',()=>{
    expect(correctionValidationError(directLoad,{...baseDraft,directQuantity:'12.5'})).toBeNull();
  });

  it('rejects a zero, negative, or malformed direct quantity',()=>{
    expect(correctionValidationError(directLoad,{...baseDraft,directQuantity:'0'})).toBe('Direct quantity must be greater than zero with no more than six decimals.');
    expect(correctionValidationError(directLoad,{...baseDraft,directQuantity:''})).toBe('Direct quantity must be greater than zero with no more than six decimals.');
    expect(correctionValidationError(directLoad,{...baseDraft,directQuantity:'1.1234567'})).toBe('Direct quantity must be greater than zero with no more than six decimals.');
  });

  it('rejects a malformed unit price regardless of quantity method',()=>{
    expect(correctionValidationError(weighbridgeLoad,{...baseDraft,unitPriceUsd:'12.999'})).toBe('Unit price must be zero or more with no more than two decimals.');
  });

  it('allows a blank unit price (Unpriced)',()=>{
    expect(correctionValidationError(weighbridgeLoad,{...baseDraft,unitPriceUsd:''})).toBeNull();
  });
});
