import { describe, expect, it } from 'vitest';

import { OwnerProvisioningError } from '../../src/provisioning/errors.ts';
import { createActivationTerminal } from '../../src/provisioning/terminal-prompt.ts';
import { fakeTerminal, tick } from '../helpers/fake-terminal.ts';

const ESC = String.fromCharCode(0x1b);
const SECRET = 'MFRG-GZDF-MZTW-Q2LK-NNWG-23TP-OBYX-E43U-OR2X-M5TY-PB4X-U6RQ-GIZT-GNJW-GY3T-QOJQ';
const URI = 'otpauth://totp/DROMEX:owner%40synthetic.invalid?secret=MFRGGZDF&issuer=DROMEX&digits=6&period=30';

async function answer(io: ReturnType<typeof fakeTerminal>, text: string): Promise<void> {
  await tick();
  io.input.type(`${text}\r`);
}

describe('Owner activation terminal', () => {
  it('shows the secret and URI once, with the scrollback and two-device instructions', async () => {
    const io = fakeTerminal();

    await createActivationTerminal(io).presentEnrollment({ secret: SECRET, uri: URI });

    expect(io.output.written).toContain(SECRET);
    expect(io.output.written).toContain(URI);
    expect(io.output.written).toMatch(/scrollback/i);
    expect(io.output.written).toMatch(/two authenticator devices/i);
    expect(io.output.written.split(SECRET)).toHaveLength(2);
  });

  it('reads a TOTP code without echoing it and states the attempt number', async () => {
    const io = fakeTerminal();
    const code = createActivationTerminal(io).readTotpCode(2, 5);
    await answer(io, '481516');

    await expect(code).resolves.toBe('481516');
    expect(io.output.written).toContain('2 of 5');
    expect(io.output.written).not.toContain('481516');
  });

  it('accepts the device acknowledgement only as the exact phrase', async () => {
    for (const [typed, expected] of [
      ['TWO DEVICES ENROLLED', true],
      ['two devices enrolled', false],
      ['TWO DEVICES ENROLLED ', true],
      ['YES', false],
      ['', false],
    ] as const) {
      const io = fakeTerminal();
      const confirmed = createActivationTerminal(io).confirmAuthenticatorsAndStorage();
      await answer(io, typed);

      await expect(confirmed, JSON.stringify(typed)).resolves.toBe(expected);
      expect(io.output.written).toContain('TWO DEVICES ENROLLED');
      expect(io.output.written).toMatch(/two sealed/i);
    }
  });

  it('lists every recovery code exactly once, numbered, with the storage instructions', async () => {
    const io = fakeTerminal();
    const codes = Array.from({ length: 10 }, (_, index) => `AAAA-BBBB-CCCC-DDDD-EEEE-FF${String(index).padStart(2, '0')}`);

    await createActivationTerminal(io).presentRecoveryCodes(codes);

    codes.forEach((code, index) => {
      expect(io.output.written.split(code)).toHaveLength(2);
      expect(io.output.written).toContain(`${index + 1}. ${code}`);
    });
    expect(io.output.written).toMatch(/shown once/i);
    expect(io.output.written).toMatch(/separate/i);
  });

  it('accepts the recovery-code acknowledgement only as the exact phrase', async () => {
    for (const [typed, expected] of [
      ['CODES RECORDED', true],
      ['codes recorded', false],
      ['CODES', false],
    ] as const) {
      const io = fakeTerminal();
      const confirmed = createActivationTerminal(io).confirmRecoveryCodesRecorded();
      await answer(io, typed);

      await expect(confirmed, typed).resolves.toBe(expected);
    }
  });

  it('clears the visible screen and the scrollback where the terminal honours it', async () => {
    const io = fakeTerminal();

    await createActivationTerminal(io).clearScreen();

    expect(io.output.written).toContain(`${ESC}[2J`);
    expect(io.output.written).toContain(`${ESC}[3J`);
    expect(io.output.written).toContain(`${ESC}[H`);
  });

  it('refuses a non-interactive terminal for every prompt', async () => {
    const io = fakeTerminal(false);
    const terminal = createActivationTerminal(io);

    for (const prompt of [
      () => terminal.readTotpCode(1, 5),
      () => terminal.confirmAuthenticatorsAndStorage(),
      () => terminal.confirmRecoveryCodesRecorded(),
    ]) {
      const error = await prompt().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OwnerProvisioningError);
      expect((error as OwnerProvisioningError).code).toBe('not_interactive');
    }
  });
});
