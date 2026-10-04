/**
 * The bounded in-process job queue behind the neutral reset request
 * (DEC-487 (5)).
 *
 * The request handler only enqueues and returns, so its response can never
 * depend on what the job finds. The queue holds at most `capacity` waiting
 * jobs and runs them one at a time; a job offered to a full queue is dropped
 * and reported, never run late. Jobs are lost if the process stops, which
 * means a requester simply asks again.
 *
 * Scheduling is injectable so tests can hold jobs back and prove the response
 * was already sent, and can wait for the queue to drain.
 */

export type ResetJob = () => Promise<void>;

export interface ResetQueue {
  /** `true` when accepted, `false` when dropped because the queue is full or closed. */
  offer(job: ResetJob): boolean;
  /** Resolves once every accepted job has finished. */
  drain(): Promise<void>;
  /** Stops accepting jobs and waits for the accepted ones. */
  close(): Promise<void>;
}

export interface ResetQueueOptions {
  capacity: number;
  /** How the next run is started. Production uses `setImmediate`. */
  schedule?: (run: () => void) => void;
  /** Called with an error's name only, never its message. */
  onError?: (errorName: string) => void;
}

export function createResetQueue(options: ResetQueueOptions): ResetQueue {
  const schedule = options.schedule ?? ((run: () => void) => void setImmediate(run));
  const waiting: ResetJob[] = [];
  const idle: Array<() => void> = [];
  let running = false;
  let closed = false;

  function settleIdle(): void {
    if (running || waiting.length > 0) return;
    for (const resolve of idle.splice(0)) resolve();
  }

  function pump(): void {
    if (running) return;
    const job = waiting.shift();
    if (job === undefined) {
      settleIdle();
      return;
    }
    running = true;
    void job()
      .catch((error: unknown) => options.onError?.(error instanceof Error ? error.name : 'UnknownError'))
      .finally(() => {
        running = false;
        schedule(pump);
      });
  }

  return {
    offer(job) {
      if (closed || waiting.length >= options.capacity) return false;
      waiting.push(job);
      schedule(pump);
      return true;
    },
    drain() {
      if (!running && waiting.length === 0) return Promise.resolve();
      return new Promise((resolve) => idle.push(resolve));
    },
    async close() {
      closed = true;
      await this.drain();
    },
  };
}
