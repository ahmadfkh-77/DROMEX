/**
 * The reason an Owner gives for disabling or re-enabling an Admin account
 * (checkpoint 4E): the only free text account management stores.
 *
 * It is kept in `dromex_account_status_change`, never in the audit trail,
 * whose `reason` column holds only short identifiers. A reason is one line of
 * 3 to 500 characters once surrounding whitespace is removed. Control
 * characters are refused because a line break could forge a log or report
 * line, and bidirectional embedding, override, and isolate characters are
 * refused because they can make stored text display as something else. Arabic
 * and mixed-direction text are otherwise accepted as typed.
 *
 * The database enforces the same rule (migration `0011`), so a caller that
 * skipped this function still could not store a refused value.
 */

export const STATUS_CHANGE_REASON_LIMITS = { min: 3, max: 500 } as const;

/** C0 and C1 controls, bidirectional formatting characters, and lone surrogates. */
const REFUSED = /[\p{Cc}\u202A-\u202E\u2066-\u2069\p{Cs}]/u;

/** The reason as stored, or `null` when it must be refused. Never throws, never echoes. */
export function parseStatusChangeReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (REFUSED.test(value)) return null;
  const reason = value.trim();
  const length = Array.from(reason).length;
  if (length < STATUS_CHANGE_REASON_LIMITS.min || length > STATUS_CHANGE_REASON_LIMITS.max) return null;
  return reason;
}
