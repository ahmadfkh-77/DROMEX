import { StringDecoder } from 'node:string_decoder';

import { OwnerProvisioningError } from './errors.ts';
import type { OwnerDraft } from './owner-input.ts';

/**
 * Interactive terminal entry for Owner provisioning, built only on Node's own
 * raw-mode TTY support.
 *
 * A hidden entry echoes nothing at all, not even a mask character, so neither
 * the password nor its length reaches the screen, scrollback, or a recording.
 * Input is read in raw mode, so the terminal's own line editing and echo are
 * off, and a password manager's paste arrives as ordinary characters.
 *
 * There is no fallback. When input or output is not a terminal, the prompt
 * refuses rather than reading a piped stream, because a piped password is one
 * that exists in a file, a shell history, or another process's memory.
 *
 * Honest limit: a JavaScript string is immutable and cannot be zeroed. The
 * per-character scratch buffer is emptied as soon as an entry ends, but the
 * returned string lives until it is garbage collected.
 */

export interface PromptInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface PromptOutput {
  isTTY?: boolean;
  write(chunk: string): unknown;
}

export interface PromptTerminal {
  input: PromptInput;
  output: PromptOutput;
}

export interface LineOptions {
  hidden: boolean;
  /**
   * Caller-owned per-character buffer. It is emptied when the entry ends,
   * however it ends.
   */
  scratch?: string[];
}

/** Longer than any valid field; stops unbounded growth from a runaway paste. */
const MAX_ENTRY_LENGTH = 1024;

const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;
const CTRL_C = 0x03;
const CTRL_D = 0x04;
const BACKSPACE = 0x08;
const DELETE = 0x7f;
const FIRST_PRINTABLE = 0x20;

const ESC = String.fromCharCode(0x1b);
const ERASE_ONE = `${String.fromCharCode(BACKSPACE)} ${String.fromCharCode(BACKSPACE)}`;

/**
 * Terminal escape sequences: CSI (arrow keys, bracketed-paste markers,
 * function keys), SS3, or a lone escape. They are removed rather than stored,
 * so a paste wrapped in bracketed-paste markers yields only its content.
 */
const ESCAPE_SEQUENCE = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|O.|.)?`, 'gs');

export function readTerminalLine(
  terminal: PromptTerminal,
  label: string,
  options: LineOptions,
): Promise<string> {
  const { input, output } = terminal;

  if (input.isTTY !== true || typeof input.setRawMode !== 'function' || output.isTTY !== true) {
    return Promise.reject(new OwnerProvisioningError('not_interactive'));
  }

  const characters = options.scratch ?? [];
  characters.length = 0;
  const decoder = new StringDecoder('utf8');

  return new Promise<string>((resolve, reject) => {
    const settle = (outcome: { value: string } | { error: OwnerProvisioningError }): void => {
      input.removeListener('data', onData);
      input.setRawMode?.(false);
      input.pause();
      decoder.end();
      characters.fill('');
      characters.length = 0;
      output.write('\n');
      if ('value' in outcome) resolve(outcome.value);
      else reject(outcome.error);
    };

    const onData = (chunk: Buffer | string): void => {
      const text = (typeof chunk === 'string' ? chunk : decoder.write(chunk)).replace(
        ESCAPE_SEQUENCE,
        '',
      );

      for (const character of text) {
        const code = character.codePointAt(0) ?? 0;

        if (code === CARRIAGE_RETURN || code === LINE_FEED) {
          settle({ value: characters.join('') });
          return;
        }
        if (code === CTRL_C || code === CTRL_D) {
          settle({ error: new OwnerProvisioningError('cancelled') });
          return;
        }
        if (code === BACKSPACE || code === DELETE) {
          if (characters.length > 0) {
            characters.pop();
            if (!options.hidden) output.write(ERASE_ONE);
          }
          continue;
        }
        if (code < FIRST_PRINTABLE || characters.length >= MAX_ENTRY_LENGTH) continue;

        characters.push(character);
        if (!options.hidden) output.write(character);
      }
    };

    output.write(label);
    input.setRawMode?.(true);
    input.on('data', onData);
    input.resume();
  });
}

/**
 * Asks for the Owner's name and email visibly and for the password and its
 * confirmation hidden. Validation is not done here; it belongs to
 * `validateOwnerDraft`, which the provisioning service applies itself.
 */
export async function collectOwnerDraft(terminal: PromptTerminal): Promise<OwnerDraft> {
  const name = await readTerminalLine(terminal, 'Owner name: ', { hidden: false });
  const email = await readTerminalLine(terminal, 'Owner email: ', { hidden: false });
  const password = await readTerminalLine(terminal, 'Owner password (not shown): ', {
    hidden: true,
  });
  const passwordConfirmation = await readTerminalLine(
    terminal,
    'Confirm password (not shown): ',
    { hidden: true },
  );

  return { name, email, password, passwordConfirmation };
}
