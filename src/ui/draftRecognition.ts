const hasText = (payload: Record<string, unknown>, fields: string[]) =>
  fields.some((field) => typeof payload[field] === 'string' && Boolean(String(payload[field]).trim()));

const hasItems = (payload: Record<string, unknown>, fields: string[]) =>
  fields.some((field) => Array.isArray(payload[field]) && payload[field].length > 0);

/**
 * Treat project/customer values supplied by persistent context as setup, not user
 * work. A draft becomes visible only after an operational value is entered.
 */
export function isMeaningfulStoredDraft(key: string, payload: Record<string, unknown>): boolean {
  if (key === 'dromex.draft.quarry.v1') {
    return hasText(payload, [
      'supplierId', 'itemId', 'quantityCubicMetres', 'driverId', 'truckId',
      'supplierTicketNumber', 'unitPriceUsd', 'notes',
    ]) || hasItems(payload, ['photos']);
  }

  if (key === 'dromex.draft.quick-text.v1') {
    const customTitle = typeof payload.title === 'string'
      && payload.title.trim().toLocaleLowerCase('en-US') !== 'quick text';
    return customTitle
      || hasText(payload, ['reference', 'message', 'preparedBy'])
      || payload.showSignatureLine === true;
  }

  if (key === 'dromex.draft.fuel.v1') {
    const activeTab = String(payload.tab ?? 'history');
    const active = payload[activeTab];
    if (!active || typeof active !== 'object' || Array.isArray(active)) return false;
    const values = active as Record<string, unknown>;
    if (activeTab === 'delivery') return hasText(values, ['litres', 'supplierId', 'ticketNumber', 'pricePerLitreUsd', 'notes']);
    if (activeTab === 'fill') return hasText(values, ['litres', 'equipmentId', 'odometerReading', 'notes']);
    if (activeTab === 'gauge') return hasText(values, ['actualLitres', 'reason', 'notes']);
    return false;
  }

  if (key.startsWith('dromex.draft.daily-report.')) {
    return hasText(payload, [
      'workDescription', 'notes', 'problemsDelaysIncidents', 'weatherSiteConditions',
      'workStartTime', 'workEndTime', 'breakMinutes', 'nextWorkPlanned',
    ]) || hasItems(payload, ['workers', 'drivers', 'truckPlates', 'machines', 'materials', 'photos']);
  }

  return false;
}

export function countMeaningfulStoredDrafts(entries: Array<[string, string | null]>): number {
  let count = 0;
  for (const [key, value] of entries) {
    if (!key.startsWith('dromex.draft.') || key === 'dromex.draft.trash.v1' || !value) continue;
    try {
      if (isMeaningfulStoredDraft(key, JSON.parse(value) as Record<string, unknown>)) count += 1;
    } catch {
      // A damaged autosave is not surfaced as actionable work.
    }
  }
  return count;
}
