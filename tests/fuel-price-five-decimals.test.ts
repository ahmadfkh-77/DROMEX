import {describe,expect,it} from 'vitest';
import {calculateFuelDelivery,calculateFuelFillCost,formatFuelPrice,formatFuelPriceUsd,fuelPriceFromStored,fuelPriceToStored,validateFuelPrice} from '../src/domain/fuel';

describe('fuel price keeps five decimals',()=>{
  it('accepts up to five decimals and rejects six',()=>{
    expect(validateFuelPrice('1.43550')).toBe(1.4355);
    expect(validateFuelPrice('1,43551')).toBe(1.43551);
    expect(validateFuelPrice('1.44')).toBe(1.44);
    expect(()=>validateFuelPrice('1.435501')).toThrow('five decimals');
  });
  it('stores a price as cents with fractions and reads it back exactly',()=>{
    expect(fuelPriceToStored(1.4355)).toBe(143.55);
    expect(fuelPriceFromStored(143.55)).toBe(1.4355);
    expect(fuelPriceFromStored(144)).toBe(1.44);
    expect(fuelPriceFromStored(fuelPriceToStored(1.43551))).toBe(1.43551);
  });
  it('rounds only the money total, from the exact price',()=>{
    expect(calculateFuelFillCost(20000,'1.43550').consumptionCostUsd).toBe(28710);
    expect(calculateFuelFillCost(333,'1.43551').consumptionCostUsd).toBe(478.02);
    expect(calculateFuelDelivery(20000,'1.43550',0).finalTotalUsd).toBe(28710);
    expect(calculateFuelDelivery(1000,'1.43550',11).vatAmountUsd).toBe(157.91);
  });
  it('shows old prices with two decimals and long ones in full',()=>{
    expect(formatFuelPrice(1.44)).toBe('1.44');
    expect(formatFuelPrice(1.4355)).toBe('1.4355');
    expect(formatFuelPrice(1.43551)).toBe('1.43551');
    expect(formatFuelPriceUsd(2)).toBe('$2.00');
  });
});
