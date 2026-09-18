/**
 * DEC-464. A Construction Section is a named, project-scoped site segment (e.g. "Section A",
 * "North Retaining Wall") that groups the Foundations built within it. It exists independently of
 * any wall: a section can hold several foundations, and a foundation can hold at most one wall.
 */
export type ConstructionSection={id:string;projectId:string;name:string;location:string;description:string;createdAt:string;updatedAt:string|null};
export type ConstructionSectionDraft={projectId:string;name:string;location:string;description:string};

export const normalizeSectionName=(value:string)=>value.trim().replace(/\s+/g,' ');
export const sectionNameKey=(value:string)=>normalizeSectionName(value).toLocaleLowerCase('en-US');

/** Case-insensitive uniqueness is scoped to one project; the same name is fine in another project. */
export function validateConstructionSectionDraft(draft:ConstructionSectionDraft,existing:ConstructionSection[]):string[]{
  const issues:string[]=[];
  if(!draft.projectId)issues.push('Choose the project this Construction Section belongs to.');
  const clean=normalizeSectionName(draft.name);
  if(!clean)issues.push('Enter a Construction Section name.');
  else if(clean.length>80)issues.push('Construction Section name must be 80 characters or fewer.');
  else{
    const key=sectionNameKey(clean);
    const duplicate=existing.some(section=>section.projectId===draft.projectId&&sectionNameKey(section.name)===key);
    if(duplicate)issues.push(`A Construction Section named "${clean}" already exists in this project.`);
  }
  return issues;
}
