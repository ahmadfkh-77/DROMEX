import { describe, expect, it } from 'vitest';

import { OwnerProvisioningError } from '../../src/provisioning/errors.ts';
import { AUTHENTICATOR_ACKNOWLEDGEMENT, RECOVERY_CODE_ACKNOWLEDGEMENT } from '../../src/provisioning/terminal-prompt.ts';
import { createOwnerRecoveryTerminal } from '../../src/provisioning/terminal-recovery-prompt.ts';
import {
  AUTHENTICATOR_AVAILABLE,
  NO_AUTHENTICATOR_AVAILABLE,
  RESET_CONFIRMATION,
  SHOW_ONE_CODE,
} from '../../src/provisioning/terminal-recovery.ts';
import { fakeTerminal, tick } from '../helpers/fake-terminal.ts';

const ESC = String.fromCharCode(0x1b);
const CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01';
const SECRET = 'MFRG-GZDF-MZTW-Q2LK-NNWG-23TP-OBYX-E43U';
const URI = 'otpauth://totp/DROMEX:owner%40synthetic.invalid?secret=MFRGGZDF&issuer=DROMEX&digits=6&period=30';

async function answer(io: ReturnType<typeof fakeTerminal>, text: string): Promise<void> {
  await tick();
  io.input.type(`${text}\r`);
}

describe('terminal Owner recovery prompts', () => {
  it('presents the masked target and environment as an emergency procedure', async () => {
    const io = fakeTerminal();

    await createOwnerRecoveryTerminal(io).presentTarget({ maskedEmail: 'o***@synthetic.invalid', environment: 'production' });

    expect(io.output.written).toContain('o***@synthetic.invalid');
    expect(io.output.written).toContain('production');
    expect(io.output.written).toMatch(/emergency/i);
  });

  it('reads the Owner email visibly and returns exactly what was typed', async () => {
    const io = fakeTerminal();
    const typed = createOwnerRecoveryTerminal(io).readOwnerEmail();
    await answer(io, 'owner@synthetic.invalid');

    await expect(typed).resolves.toBe('owner@synthetic.invalid');
    expect(io.output.written).toContain('owner@synthetic.invalid');
  });

  it('reads the password without echoing it', async () => {
    const io = fakeTerminal();
    const password = createOwnerRecoveryTerminal(io).readPassword();
    await answer(io, 'synthetic hidden passphrase');

    await expect(password).resolves.toBe('synthetic hidden passphrase');
    expect(io.output.written).not.toContain('synthetic hidden passphrase');
    expect(io.output.written).toMatch(/not shown/i);
  });

  it('reads codes from the existing and the new authenticator without echoing them', async () => {
    for (const authenticator of ['existing', 'new'] as const) {
      const io = fakeTerminal();
      const code = createOwnerRecoveryTerminal(io).readTotpCode({ attempt: 3, maxAttempts: 5, authenticator });
      await answer(io, '481516');

      await expect(code).resolves.toBe('481516');
      expect(io.output.written).toContain('3 of 5');
      expect(io.output.written).toMatch(authenticator === 'new' ? /new authenticator/i : /existing authenticator/i);
      expect(io.output.written).not.toContain('481516');
    }
  });

  it('shows both exact availability phrases and returns the raw answer', async () => {
    const io = fakeTerminal();
    const typed = createOwnerRecoveryTerminal(io).readAuthenticatorAvailability();
    await answer(io, 'maybe');

    await expect(typed).resolves.toBe('maybe');
    expect(io.output.written).toContain(AUTHENTICATOR_AVAILABLE);
    expect(io.output.written).toContain(NO_AUTHENTICATOR_AVAILABLE);
  });

  it('shows one retrieved code once with a sensitivity warning and the web recovery instruction', async () => {
    const io = fakeTerminal();
    const terminal = createOwnerRecoveryTerminal(io);
    const confirmation = terminal.readRetrievalConfirmation();
    await answer(io, SHOW_ONE_CODE);
    await expect(confirmation).resolves.toBe(SHOW_ONE_CODE);

    await terminal.presentRetrievedCode(CODE);

    expect(io.output.written.split(CODE)).toHaveLength(2);
    expect(io.output.written).toMatch(/sensitive/i);
    expect(io.output.written).toMatch(/once/i);
    expect(io.output.written).toMatch(/web recovery/i);
  });

  it('warns before a reset that sessions, the authenticator, and every recovery code are invalidated', async () => {
    const io = fakeTerminal();
    const terminal = createOwnerRecoveryTerminal(io);

    await terminal.presentResetWarning();
    const confirmation = terminal.readResetConfirmation();
    await answer(io, RESET_CONFIRMATION);
    await expect(confirmation).resolves.toBe(RESET_CONFIRMATION);
    const incident = terminal.readIncidentReference();
    await answer(io, 'INC-20260915-01');
    await expect(incident).resolves.toBe('INC-20260915-01');

    expect(io.output.written).toMatch(/every session/i);
    expect(io.output.written).toMatch(/authenticator/i);
    expect(io.output.written).toMatch(/every recovery code/i);
    expect(io.output.written).toContain(RESET_CONFIRMATION);
    expect(io.output.written).toContain('INC-YYYYMMDD-NN');
  });

  it('shows the enrolment secret and the new codes once and asks for both acknowledgements', async () => {
    const io = fakeTerminal();
    const terminal = createOwnerRecoveryTerminal(io);
    const codes = Array.from({ length: 10 }, (_, index) => `AAAA-BBBB-CCCC-DDDD-EEEE-FF${String(index).padStart(2, '0')}`);

    await terminal.presentEnrollment({ secret: SECRET, uri: URI });
    const devices = terminal.readAuthenticatorAcknowledgement();
    await answer(io, AUTHENTICATOR_ACKNOWLEDGEMENT);
    await expect(devices).resolves.toBe(AUTHENTICATOR_ACKNOWLEDGEMENT);
    await terminal.presentRecoveryCodes(codes);
    const recorded = terminal.readRecoveryCodeAcknowledgement();
    await answer(io, RECOVERY_CODE_ACKNOWLEDGEMENT);
    await expect(recorded).resolves.toBe(RECOVERY_CODE_ACKNOWLEDGEMENT);
    await terminal.clearScreen();

    expect(io.output.written.split(SECRET)).toHaveLength(2);
    expect(io.output.written.split(URI)).toHaveLength(2);
    expect(io.output.written).toMatch(/scrollback/i);
    for (const code of codes) expect(io.output.written.split(code)).toHaveLength(2);
    expect(io.output.written).toContain(`${ESC}[3J`);
  });

  it('refuses a non-interactive terminal for every prompt', async () => {
    const terminal = createOwnerRecoveryTerminal(fakeTerminal(false));

    for (const prompt of [
      () => terminal.readOwnerEmail(),
      () => terminal.readPassword(),
      () => terminal.readAuthenticatorAvailability(),
      () => terminal.readTotpCode({ attempt: 1, maxAttempts: 5, authenticator: 'new' }),
      () => terminal.readRetrievalConfirmation(),
      () => terminal.readResetConfirmation(),
      () => terminal.readIncidentReference(),
      () => terminal.readAuthenticatorAcknowledgement(),
      () => terminal.readRecoveryCodeAcknowledgement(),
    ]) {
      const error = await prompt().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OwnerProvisioningError);
      expect((error as OwnerProvisioningError).code).toBe('not_interactive');
    }
  });
});
