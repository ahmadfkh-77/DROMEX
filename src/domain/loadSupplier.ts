/**
 * Who issued the material is the supplier. On the company's own loads that is the Plant Company, printed by its real
 * name and always the CURRENT one: a PDF or Excel file made after the company was renamed shows the new name on every
 * load. The name saved on a load (what it was issued with) is only the fallback when no Plant Company name is set.
 * "Plant Company" is only the label of the profile, never a name.
 */
export function plantSupplierName(currentPlantName: string | null | undefined, issuedName: string | null | undefined): string | null {
  return currentPlantName?.trim() || issuedName?.trim() || null;
}
