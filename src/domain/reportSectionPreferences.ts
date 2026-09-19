/**
 * DEC-471. Whether the Foundation Construction section is included in issued Daily Report output.
 *
 * The Owner asked to be able to keep foundation data out of the PDF and workbook while that part of
 * the workflow is still being finished. This is a stored app preference rather than a per-report
 * column so that no database migration is needed for a temporary switch; it uses the same
 * `expo-sqlite/kv-store` mechanism the app already uses for local preferences and drafts.
 *
 * The default is **on**: turning the feature off must be a deliberate choice, never something a
 * missing or unreadable preference does silently. Only the exact stored value `'off'` disables it, so
 * a corrupt or partially written value fails safe by still including the section.
 */
export const FOUNDATION_SECTION_PREFERENCE_KEY='dromex.reports.includeFoundationSection.v1';

export function parseFoundationSectionPreference(raw:string|null|undefined):boolean{
  return raw!=='off';
}

export function serializeFoundationSectionPreference(included:boolean):string{
  return included?'on':'off';
}

/** The one sentence shown beside the switch, so the editor and any later surface describe it identically. */
export function describeFoundationSectionPreference(included:boolean):string{
  return included
    ?'Foundation Construction is included in the PDF and Excel exports.'
    :'Foundation Construction is excluded from the PDF and Excel exports. It is still recorded and still shown here.';
}
