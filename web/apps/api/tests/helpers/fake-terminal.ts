import { EventEmitter } from 'node:events';

import type { PromptInput, PromptOutput } from '../../src/provisioning/terminal-prompt.ts';

/**
 * A scripted terminal. It records every raw-mode transition and every byte
 * written to the screen, so a test can prove what was and was not echoed.
 */
export class FakeTerminalInput extends EventEmitter implements PromptInput {
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

export class FakeTerminalOutput implements PromptOutput {
  isTTY = true;
  written = '';

  write(chunk: string): boolean {
    this.written += chunk;
    return true;
  }
}

export function fakeTerminal(isTTY = true) {
  return { input: new FakeTerminalInput(isTTY), output: new FakeTerminalOutput() };
}

/** Lets a prompt attach its listener before keys arrive. */
export async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
