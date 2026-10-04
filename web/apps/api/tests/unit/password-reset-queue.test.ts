import { describe, expect, it } from 'vitest';

import { createResetQueue } from '../../src/password-reset/reset-queue.ts';

// DEC-487 (5): the neutral request response never waits for the job; the
// queue is bounded and drops, rather than delays, what does not fit.

function heldScheduler() {
  const runs: Array<() => void> = [];
  return {
    schedule: (run: () => void) => runs.push(run),
    step() {
      runs.shift()?.();
    },
    get pending() {
      return runs.length;
    },
  };
}

describe('reset job queue', () => {
  it('accepts a job without running it in the caller', () => {
    const scheduler = heldScheduler();
    const queue = createResetQueue({ capacity: 2, schedule: scheduler.schedule });
    let ran = false;
    expect(queue.offer(async () => void (ran = true))).toBe(true);
    expect(ran).toBe(false);
    expect(scheduler.pending).toBe(1);
  });

  it('drops a job offered to a full queue', () => {
    const scheduler = heldScheduler();
    const queue = createResetQueue({ capacity: 2, schedule: scheduler.schedule });
    expect(queue.offer(async () => undefined)).toBe(true);
    expect(queue.offer(async () => undefined)).toBe(true);
    expect(queue.offer(async () => undefined)).toBe(false);
  });

  it('runs jobs one at a time, in order, and drains', async () => {
    const queue = createResetQueue({ capacity: 10 });
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;
    for (const n of [1, 2, 3]) {
      queue.offer(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(n);
        active -= 1;
      });
    }
    await queue.drain();
    expect(order).toEqual([1, 2, 3]);
    expect(maxActive).toBe(1);
  });

  it('reports a failed job by error name only and keeps running the rest', async () => {
    const errors: string[] = [];
    const queue = createResetQueue({ capacity: 10, onError: (name) => errors.push(name) });
    let second = false;
    queue.offer(async () => {
      throw new TypeError('synthetic detail that must not be reported');
    });
    queue.offer(async () => void (second = true));
    await queue.drain();
    expect(errors).toEqual(['TypeError']);
    expect(second).toBe(true);
  });

  it('refuses new jobs once closed and waits for accepted ones', async () => {
    const queue = createResetQueue({ capacity: 10 });
    let finished = false;
    queue.offer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });
    await queue.close();
    expect(finished).toBe(true);
    expect(queue.offer(async () => undefined)).toBe(false);
  });
});
