/**
 * Rebuilds `src/auth/common-passwords.txt` from a reviewed source list
 * (DEC-488). Development-time only: it reads a local file, never the network.
 *
 *   node tools/derive-common-password-blocklist.ts <path to source list>
 *
 * The source must match the pinned SHA-256 in `COMMON_PASSWORD_BLOCKLIST_SOURCE`.
 * Changing the source is a reviewed repository change: update the pinned
 * commit and hash, run this, then update `COMMON_PASSWORD_BLOCKLIST_ENTRIES_SHA256`
 * to the value printed here.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../src/auth/config.ts';
import { COMMON_PASSWORD_BLOCKLIST_SOURCE, deriveCommonPasswordBlocklist } from '../src/auth/password-policy.ts';

const sourcePath = process.argv[2];
if (sourcePath === undefined) {
  process.stderr.write('Usage: node tools/derive-common-password-blocklist.ts <source list>\n');
  process.exit(2);
}

const source = readFileSync(sourcePath);
const sourceDigest = createHash('sha256').update(source).digest('hex');
if (sourceDigest !== COMMON_PASSWORD_BLOCKLIST_SOURCE.sha256) {
  process.stderr.write('The source list does not match the pinned SHA-256. Nothing was written.\n');
  process.exit(1);
}

const entries = deriveCommonPasswordBlocklist(source.toString('utf8'));
const header = [
  '# DROMEX common-password blocklist (DEC-488). Generated; do not edit by hand.',
  `# Source: ${COMMON_PASSWORD_BLOCKLIST_SOURCE.name}`,
  `#   https://github.com/danielmiessler/SecLists/blob/${COMMON_PASSWORD_BLOCKLIST_SOURCE.commit}/${COMMON_PASSWORD_BLOCKLIST_SOURCE.path}`,
  `#   Licence ${COMMON_PASSWORD_BLOCKLIST_SOURCE.licence}; source SHA-256 ${COMMON_PASSWORD_BLOCKLIST_SOURCE.sha256}`,
  `# Rule: Unicode NFKC, lower case, ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} UTF-16 code units, unique, sorted.`,
  '# Regenerate with tools/derive-common-password-blocklist.ts.',
];
const target = fileURLToPath(new URL('../src/auth/common-passwords.txt', import.meta.url));
writeFileSync(target, `${[...header, ...entries].join('\n')}\n`, 'utf8');

const entriesDigest = createHash('sha256').update(entries.join('\n'), 'utf8').digest('hex');
process.stdout.write(`Wrote ${entries.length} entries. Entries SHA-256: ${entriesDigest}\n`);
