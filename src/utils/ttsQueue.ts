export class NonRetryableTtsError extends Error {
  httpStatus?: number;
  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = 'NonRetryableTtsError';
    this.httpStatus = httpStatus;
  }
}

export function isRetryableTtsError(message: string, httpStatus?: number): boolean {
  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403 || httpStatus === 413) {
    return false;
  }
  const lower = (message || '').toLowerCase();
  if (
    lower.includes('api key') &&
    (lower.includes('tidak valid') ||
      lower.includes('belum diisi') ||
      lower.includes('belum dikonfigurasi') ||
      lower.includes('ditolak'))
  ) {
    return false;
  }
  if (
    lower.includes('tidak boleh kosong') ||
    lower.includes('terlalu panjang')
  ) {
    return false;
  }
  return true;
}

export function computeRetryDelayMs(
  attempt: number,
  baseDelayMs = 2200,
  maxDelayMs = 15000,
  jitterRatio = 0.15
): number {
  const safeAttempt = Math.max(1, attempt);
  const raw = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, safeAttempt - 1));
  if (jitterRatio <= 0) return Math.round(raw);
  const jitter = raw * jitterRatio * Math.random();
  return Math.round(Math.min(maxDelayMs, raw + jitter));
}

export interface RetryAttemptInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: string;
}

export async function runWithTtsRetry<T>(
  task: (attempt: number) => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
    onRetry?: (info: RetryAttemptInfo) => void;
    sleepFn?: (ms: number) => Promise<void>;
  }
): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 5);
  const baseDelayMs = options?.baseDelayMs ?? 2200;
  const maxDelayMs = options?.maxDelayMs ?? 15000;
  const jitterRatio = options?.jitterRatio ?? 0.15;
  const sleepFn =
    options?.sleepFn ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await task(attempt);
    } catch (err) {
      lastErr = err;
      if (err instanceof NonRetryableTtsError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const httpStatus = (err as { httpStatus?: number })?.httpStatus;
      if (!isRetryableTtsError(msg, httpStatus) || attempt >= maxAttempts) {
        throw err;
      }

      const delayMs = computeRetryDelayMs(
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitterRatio
      );
      options?.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        reason: msg,
      });
      await sleepFn(delayMs);
    }
  }
  throw lastErr;
}

interface QueueEntry {
  key: string;
  run: () => Promise<void>;
}

/**
 * Sequential FIFO queue with inter-request spacing to avoid bursting AI provider rate limits.
 */
export class SequentialTtsQueue {
  private queue: QueueEntry[] = [];
  private activeKey: string | null = null;
  private isDraining = false;
  private spacingMs: number;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(
    spacingMs = 1000,
    sleepFn: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {
    this.spacingMs = spacingMs;
    this.sleepFn = sleepFn;
  }

  enqueue(key: string, run: () => Promise<void>): boolean {
    if (this.activeKey === key || this.queue.some((q) => q.key === key)) {
      return false;
    }
    this.queue.push({ key, run });
    if (!this.isDraining) {
      void this.drain();
    }
    return true;
  }

  getPendingKeys(): string[] {
    return this.queue.map((q) => q.key);
  }

  isBusy(): boolean {
    return this.isDraining || this.queue.length > 0;
  }

  clear(): void {
    this.queue = [];
  }

  private async drain(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        this.activeKey = next.key;
        try {
          await next.run();
        } catch {
          // Individual job handlers manage their own state
        } finally {
          this.activeKey = null;
        }
        if (this.queue.length > 0 && this.spacingMs > 0) {
          await this.sleepFn(this.spacingMs);
        }
      }
    } finally {
      this.isDraining = false;
      this.activeKey = null;
    }
  }
}
