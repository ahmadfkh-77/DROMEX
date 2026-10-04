import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { OwnerProvisioningError } from '../../src/provisioning/errors.ts';
import {
  collectOwnerDraft,
  readTerminalLine,
  type PromptInput,
  type PromptOutput,
} from '../../src/provisioning/terminal-prompt.ts';

const ESC = '\u001b';
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const DELETE = '\u007f';
const BACKSPACE = '\b';

/**
 * A scripted terminal. It records every raw-mode transition and every byte
 * written to the screen, so a test can prove what was and was not echoed.
 */
class FakeTerminalInput extends EventEmitter implements PromptInput {
  isTTY: boolean;
  rawModes: boolean[] = [];
  paused = true;

  constructor(isTTY = true) {
    super();
    this.isTTY = isTTY;
  }

  setRawMode(mode: boolean): this {
    this.rawModes.push(mode);
    return this;
  }

  resume(): this {
    this.paused = false;
    return this;
  }

  pause(): this {
    this.paused = true;
    return this;
  }

  type(text: string): void {
    this.emit('data', Buffer.from(text, 'utf8'));
  }
}

class FakeTerminalOutput implements PromptOutput {
  isTTY = true;
  written = '';

  write(chunk: string): boolean {
    this.written += chunk;
    return true;
  }
}

function terminal(isTTY = true) {
  return { input: new FakeTerminalInput(isTTY), output: new FakeTerminalOutput() };
}

/** Lets the prompt attach its listener before keys arrive. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

const SECRET = 'synthetic hidden phrase';

describe('terminal line prompt', () => {
  it('never echoes a hidden entry, and returns it exactly', async () => {
    const io = terminal();
    const line = readTerminalLine(io, 'Password: ', { hidden: true });
    await tick();
    io.input.type(`${SECRET}\r`);

    await expect(line).resolves.toBe(SECRET);
    expect(io.output.written).toContain('Password: ');
    for (const fragment of ['synthetic', 'hidden', 'phrase', '*']) {
      expect(io.output.written).not.toContain(fragment);
    }
  });

  it('echoes a visible entry', async () => {
    const io = terminal();
    const line = readTerminalLine(io, 'Name: ', { hidden: false });
    await tick();
    io.input.type('Synthetic Owner\r');

    await expect(line).resolves.toBe('Synthetic Owner');
    expect(io.output.written).toContain('Synthetic Owner');
  });

  it('applies backspace and delete to a hidden entry without revealing anything', async () => {
    const io = terminal();
    const line = readTerminalLine(io, 'Password: ', { hidden: true });
    await tick();
    io.input.type('synthetic hiddxx');
    io.input.type(`${DELETE}${BACKSPACE}`);
    io.input.type('en phrase\r');

    await expect(line).resolves.toBe(SECRET);
    expect(io.output.written).toBe('Password: \n');
  });

  it('accepts a password-manager paste in one chunk, with or without bracketed-paste markers', async () => {
    for (const chunk of [`${SECRET}\r\n`, `${ESC}[200~${SECRET}${ESC}[201~\r`]) {
      const io = terminal();
      const line = readTerminalLine(io, 'Password: ', { hidden: true });
      await tick();
      io.input.type(chunk);

      await expect(line).resolves.toBe(SECRET);
      expect(io.output.written).not.toContain('synthetic');
    }
  });

  it('ignores arrow-key escape sequences rather than storing them', async () => {
    const io = terminal();
    const line = readTerminalLine(io, 'Password: ', { hidden: true });
    await tick();
    io.input.type(`synthetic${ESC}[D${ESC}[C hidden phrase\r`);

    await expect(line).resolves.toBe(SECRET);
  });

  it('keeps a multi-byte character split across chunks intact', async () => {
    const io = terminal();
    const line = readTerminalLine(io, 'Password: ', { hidden: true });
    await tick();
    const bytes = Buffer.from('synthétique\r', 'utf8');
    const split = bytes.indexOf(0xc3) + 1;
    io.input.emit('data', bytes.subarray(0, split));
    io.input.emit('data', bytes.subarray(split));

    await expect(line).resolves.toBe('synthétique');
  });

  it.each([
    ['Ctrl+C', CTRL_C],
    ['Ctrl+D', CTRL_D],
  ])('cancels on %s, wipes the typed characters, and restores the terminal', async (_label, key) => {
    const io = terminal();
    const scratch: string[] = [];
    const line = readTerminalLine(io, 'Password: ', { hidden: true, scratch });
    await tick();
    io.input.type('synthetic partial');
    expect(scratch.length).toBeGreaterThan(0);
    io.input.type(key);

    const error = await line.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OwnerProvisioningError);
    expect((error as OwnerProvisioningError).code).toBe('cancelled');
    expect(`${(error as Error).message}${(error as Error).stack ?? ''}`).not.toContain('partial');

    expect(scratch).toEqual([]);
    expect(io.input.rawModes).toEqual([true, false]);
    expect(io.input.listenerCount('data')).toBe(0);
    expect(io.input.paused).toBe(true);
  });

  it('wipes its scratch buffer after a completed entry too', async () => {
    const io = terminal();
    const scratch: string[] = [];
    const line = readTerminalLine(io, 'Password: ', { hidden: true, scratch });
    await tick();
    io.input.type(`${SECRET}\r`);

    await expect(line).resolves.toBe(SECRET);
    expect(scratch).toEqual([]);
    expect(io.input.rawModes).toEqual([true, false]);
    expect(io.input.listenerCount('data')).toBe(0);
  });

  it('refuses a non-interactive input without reading anything', async () => {
    const io = terminal(false);

    const error = await readTerminalLine(io, 'Password: ', { hidden: true }).catch(
      (caught: unknown) => caught,
    );

    expect((error as OwnerProvisioningError).code).toBe('not_interactive');
    expect(io.input.rawModes).toEqual([]);
    expect(io.input.listenerCount('data')).toBe(0);
  });

  it('refuses when the output is not a terminal', async () => {
    const io = terminal();
    io.output.isTTY = false;

    const error = await readTerminalLine(io, 'Password: ', { hidden: true }).catch(
      (caught: unknown) => caught,
    );

    expect((error as OwnerProvisioningError).code).toBe('not_interactive');
    expect(io.input.rawModes).toEqual([]);
  });
});

describe('Owner draft collection', () => {
  async function answer(io: ReturnType<typeof terminal>, lines: string[]): Promise<void> {
    for (const text of lines) {
      await tick();
      io.input.type(`${text}\r`);
    }
  }

  it('asks for name and email visibly, and for the password and its confirmation hidden', async () => {
    const io = terminal();
    const collected = collectOwnerDraft(io);
    await answer(io, ['Synthetic Owner', 'owner@synthetic.invalid', SECRET, SECRET]);

    await expect(collected).resolves.toEqual({
      name: 'Synthetic Owner',
      email: 'owner@synthetic.invalid',
      password: SECRET,
      passwordConfirmation: SECRET,
    });
    expect(io.output.written).toContain('owner@synthetic.invalid');
    expect(io.output.written).not.toContain('hidden');
  });

  it('stops at cancellation and returns nothing', async () => {
    const io = terminal();
    const collected = collectOwnerDraft(io);
    await answer(io, ['Synthetic Owner', 'owner@synthetic.invalid']);
    await tick();
    io.input.type(`synthetic${CTRL_C}`);

    const error = await collected.catch((caught: unknown) => caught);
    expect((error as OwnerProvisioningError).code).toBe('cancelled');
    expect(io.input.rawModes.at(-1)).toBe(false);
    expect(io.input.listenerCount('data')).toBe(0);
  });
});
