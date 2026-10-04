import {
  AUTHENTICATOR_ACKNOWLEDGEMENT,
  RECOVERY_CODE_ACKNOWLEDGEMENT,
  readTerminalLine,
  type PromptTerminal,
} from './terminal-prompt.ts';
import {
  AUTHENTICATOR_AVAILABLE,
  NO_AUTHENTICATOR_AVAILABLE,
  RESET_CONFIRMATION,
  SHOW_ONE_CODE,
  type OwnerRecoveryTerminal,
} from './terminal-recovery.ts';

/**
 * The terminal side of emergency Owner recovery (DEC-437), built on the same
 * raw-mode prompt as Owner activation: hidden entries echo nothing, and a
 * non-interactive input or output is refused rather than read.
 *
 * It displays and reads only; every decision belongs to the recovery
 * service. The one retrieved code, the new enrolment secret, and the new
 * recovery codes are written only to this terminal, once each, and never
 * logged. Scrollback, screen recording, and terminal logging can still retain
 * them, which the operator is told before anything sensitive appears.
 */

const ESC = String.fromCharCode(0x1b);
/** Clears the visible screen, asks the terminal to drop scrollback, and homes the cursor. */
const CLEAR_SCREEN = `${ESC}[2J${ESC}[3J${ESC}[H`;

export function createOwnerRecoveryTerminal(terminal: PromptTerminal): OwnerRecoveryTerminal {
  const write = (lines: readonly string[]) => {
    terminal.output.write(`${lines.join('\n')}\n`);
  };
  const visible = (label: string) => readTerminalLine(terminal, label, { hidden: false });
  const hidden = (label: string) => readTerminalLine(terminal, label, { hidden: true });

  return {
    async presentTarget({ maskedEmail, environment }) {
      write([
        '',
        'DROMEX terminal emergency Owner recovery',
        'This is a break-glass procedure for an Owner who knows the current password.',
        'It does not reset a forgotten password.',
        '',
        `Environment: ${environment}`,
        `Owner account: ${maskedEmail}`,
        '',
      ]);
    },

    readOwnerEmail() {
      return visible('Type the full Owner email address to confirm the target: ');
    },

    readPassword() {
      return hidden('Current Owner password (not shown): ');
    },

    async readAuthenticatorAvailability() {
      write([
        '',
        'Can you read a current code from an existing DROMEX authenticator for this Owner?',
        `Type ${AUTHENTICATOR_AVAILABLE} if you can, or ${NO_AUTHENTICATOR_AVAILABLE} if you cannot.`,
      ]);
      return visible('Answer: ');
    },

    readTotpCode({ attempt, maxAttempts, authenticator }) {
      const which = authenticator === 'new' ? 'new authenticator' : 'existing authenticator';
      return hidden(`Code from the ${which}, attempt ${attempt} of ${maxAttempts} (not shown): `);
    },

    async readRetrievalConfirmation() {
      write([
        '',
        'An unused recovery code is stored for this Owner.',
        'This command can show exactly one of them, once. Anyone who sees it can use it with the password.',
        `Type ${SHOW_ONE_CODE} to show it.`,
      ]);
      return visible('Confirmation: ');
    },

    async presentRetrievedCode(code) {
      write([
        '',
        'Warning: this recovery code is sensitive. It is shown once and this command stores it nowhere.',
        'Terminal scrollback, screen recordings, and terminal logs may retain it.',
        '',
        `Recovery code: ${code}`,
        '',
        'Use it now in web recovery: sign in with the password, enter this recovery code, and replace the authenticator.',
        'Business access stays blocked until web recovery completes.',
        '',
      ]);
    },

    async presentResetWarning() {
      write([
        '',
        'EMERGENCY RESET (DEC-437)',
        'No authenticator is available and no usable recovery code is stored.',
        "Continuing removes the Owner's authenticator and every recovery code, revokes every session,",
        'and enrols a new authenticator now, in this terminal.',
        'Business access stays blocked until the new authenticator is verified and recovery completes.',
        'Record a dated incident note for this use before continuing.',
        `Type ${RESET_CONFIRMATION} to continue.`,
      ]);
    },

    readResetConfirmation() {
      return visible('Confirmation: ');
    },

    readIncidentReference() {
      return visible('Incident reference (INC-YYYYMMDD-NN): ');
    },

    async presentEnrollment({ secret, uri }) {
      write([
        '',
        'New authenticator enrolment',
        'Warning: terminal scrollback, screen recordings, and terminal logs may retain what follows.',
        'Enrol this secret on TWO authenticator devices, and delete any older DROMEX entry from them first.',
        '',
        `Secret for manual entry: ${secret}`,
        `otpauth URI: ${uri}`,
        '',
      ]);
    },

    async readAuthenticatorAcknowledgement() {
      write([
        '',
        'Confirm that the secret is enrolled on two separate authenticator devices,',
        'and that you will keep two sealed paper copies of the new recovery codes in separate physical locations.',
        `Type ${AUTHENTICATOR_ACKNOWLEDGEMENT} to continue.`,
      ]);
      return visible('Confirmation: ');
    },

    async presentRecoveryCodes(codes) {
      write([
        '',
        'New recovery codes. These are shown once and cannot be shown again. Every older code no longer works.',
        'Write or print two copies, seal them, and store them in separate physical locations.',
        '',
        ...codes.map((code, index) => `${index + 1}. ${code}`),
        '',
      ]);
    },

    async readRecoveryCodeAcknowledgement() {
      write([`Type ${RECOVERY_CODE_ACKNOWLEDGEMENT} once both copies are written down.`]);
      return visible('Confirmation: ');
    },

    async clearScreen() {
      terminal.output.write(CLEAR_SCREEN);
      write([
        'The screen was cleared. Some terminals keep scrollback anyway; close this terminal when finished.',
        'Sign in normally with the password and the new authenticator.',
      ]);
    },
  };
}
