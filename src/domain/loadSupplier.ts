/**
 * Who issued the material is the supplier. On the company's own loads that is the Plant Company, printed by its
 * real name: the company name saved on the load when it was issued (so an old load keeps the name it was issued
 * with), else the current Plant Company name. "Plant Company" is only the label of the profile, never a name.
 */
export function plantSupplierName(issuedName: string | null | undefined, currentPlantName: string | null | undefined): string | null {
  return issuedName?.trim() || currentPlantName?.trim() || null;
}
