import { StringDecoder } from 'node:string_decoder';

import { OwnerProvisioningError } from './errors.ts';
import type { OwnerDraft } from './owner-input.ts';
import type { OwnerActivationTerminal } from './owner-provisioning.ts';

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

/** Typed acknowledgements required during Owner activation (DEC-435). */
export const AUTHENTICATOR_ACKNOWLEDGEMENT = 'TWO DEVICES ENROLLED';
export const RECOVERY_CODE_ACKNOWLEDGEMENT = 'CODES RECORDED';

/** Clears the visible screen, asks the terminal to drop scrollback, and homes the cursor. */
const CLEAR_SCREEN = `${ESC}[2J${ESC}[3J${ESC}[H`;

/**
 * The terminal side of Owner activation. It displays and reads only what the
 * activation service hands it, and decides nothing: every refusal is the
 * service's. A secret or code written here is shown once and never logged;
 * scrollback, screen recording, and terminal logging can still retain it,
 * which the operator is told before anything sensitive appears.
 */
export function createActivationTerminal(terminal: PromptTerminal): OwnerActivationTerminal {
  const write = (lines: readonly string[]) => {
    terminal.output.write(`${lines.join('\n')}\n`);
  };

  return {
    async presentEnrollment({ secret, uri }) {
      write([
        '',
        'Authenticator enrolment',
        'Warning: terminal scrollback, screen recordings, and terminal logs may retain what follows.',
        'Enrol this secret on TWO authenticator devices before continuing.',
        'If an earlier interrupted run added a DROMEX entry to a device, delete that entry first.',
        '',
        `Secret for manual entry: ${secret}`,
        `otpauth URI: ${uri}`,
        '',
      ]);
    },

    async readTotpCode(attempt, maxAttempts) {
      return readTerminalLine(terminal, `Authenticator code, attempt ${attempt} of ${maxAttempts} (not shown): `, {
        hidden: true,
      });
    },

    async confirmAuthenticatorsAndStorage() {
      write([
        '',
        'Confirm that the secret is enrolled on two separate authenticator devices,',
        'and that you will keep two sealed paper copies of the recovery codes in separate physical locations.',
        `Type ${AUTHENTICATOR_ACKNOWLEDGEMENT} to continue.`,
      ]);
      const typed = await readTerminalLine(terminal, 'Confirmation: ', { hidden: false });
      return typed.trim() === AUTHENTICATOR_ACKNOWLEDGEMENT;
    },

    async presentRecoveryCodes(codes) {
      write([
        '',
        'Recovery codes. These are shown once and cannot be shown again.',
        'Write or print two copies, seal them, and store them in separate physical locations.',
        'Each code works once. Do not copy them to the clipboard or any file.',
        '',
        ...codes.map((code, index) => `${index + 1}. ${code}`),
        '',
      ]);
    },

    async confirmRecoveryCodesRecorded() {
      write([`Type ${RECOVERY_CODE_ACKNOWLEDGEMENT} once both copies are written down.`]);
      const typed = await readTerminalLine(terminal, 'Confirmation: ', { hidden: false });
      return typed.trim() === RECOVERY_CODE_ACKNOWLEDGEMENT;
    },

    async clearScreen() {
      terminal.output.write(CLEAR_SCREEN);
      write(['The screen was cleared. Some terminals keep scrollback anyway; close this terminal when finished.']);
    },
  };
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
