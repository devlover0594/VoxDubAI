import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRetryDelayMs,
  isRetryableTtsError,
  NonRetryableTtsError,
  runWithTtsRetry,
  SequentialTtsQueue,
} from './ttsQueue.ts';
import {
  buildAssSubtitles,
  hexToAssColor,
  opacityToAssAlpha,
  secondsToAssTime,
} from './assSubtitle.ts';
import type { DubSegment, SubtitleStyle } from '../types/dubbing.ts';

test('isRetryableTtsError retries 429/503/network errors and stops on 401/403/400 auth errors', () => {
  assert.equal(isRetryableTtsError('Kuota permintaan penuh (429)', 429), true);
  assert.equal(isRetryableTtsError('Layanan sedang sibuk (503)', 503), true);
  assert.equal(isRetryableTtsError('Failed to fetch'), true);
  assert.equal(isRetryableTtsError('API Key tidak valid', 403), false);
  assert.equal(isRetryableTtsError('Teks segmen terlalu panjang', 400), false);
});

test('computeRetryDelayMs grows exponentially and caps at maxDelayMs', () => {
  assert.equal(computeRetryDelayMs(1, 1000, 10000, 0), 1000);
  assert.equal(computeRetryDelayMs(2, 1000, 10000, 0), 2000);
  assert.equal(computeRetryDelayMs(3, 1000, 10000, 0), 4000);
  assert.equal(computeRetryDelayMs(5, 1000, 10000, 0), 10000);
});

test('runWithTtsRetry retries transient failures multiple times until TTS succeeds', async () => {
  let calls = 0;
  const retries: number[] = [];

  const result = await runWithTtsRetry(
    async () => {
      calls++;
      if (calls < 4) {
        const err = new Error('429 rate limit') as Error & { httpStatus?: number };
        err.httpStatus = 429;
        throw err;
      }
      return 'ok-audio';
    },
    {
      maxAttempts: 5,
      baseDelayMs: 10,
      jitterRatio: 0,
      sleepFn: async () => {},
      onRetry: (info) => retries.push(info.attempt),
    }
  );

  assert.equal(result, 'ok-audio');
  assert.equal(calls, 4);
  assert.deepEqual(retries, [1, 2, 3]);
});

test('runWithTtsRetry does not retry NonRetryableTtsError', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runWithTtsRetry(
        async () => {
          calls++;
          throw new NonRetryableTtsError('API key invalid', 403);
        },
        { maxAttempts: 5, sleepFn: async () => {} }
      ),
    (err: unknown) => err instanceof NonRetryableTtsError
  );
  assert.equal(calls, 1);
});

test('SequentialTtsQueue processes queued segments strictly one by one in FIFO order', async () => {
  const order: string[] = [];
  let inFlight = 0;
  let maxConcurrent = 0;

  const queue = new SequentialTtsQueue(1, async () => {});

  const p1 = new Promise<void>((resolve) => {
    queue.enqueue('s1', async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      order.push('start-1');
      await new Promise((r) => setTimeout(r, 15));
      order.push('end-1');
      inFlight--;
      resolve();
    });
  });

  const p2 = new Promise<void>((resolve) => {
    queue.enqueue('s2', async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      order.push('start-2');
      order.push('end-2');
      inFlight--;
      resolve();
    });
  });

  // Duplicate key while active/queued should be deduplicated
  const dup = queue.enqueue('s2', async () => {});
  assert.equal(dup, false);

  await Promise.all([p1, p2]);
  assert.equal(maxConcurrent, 1);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('buildAssSubtitles generates valid ASS colors, timestamps, classic, karaoke, and word-popup events', () => {
  assert.equal(hexToAssColor('#FDE047', '00'), '&H0047E0FD');
  assert.equal(opacityToAssAlpha(1), '00');
  assert.equal(opacityToAssAlpha(0), 'FF');
  assert.equal(secondsToAssTime(65.5), '0:01:05.50');

  const segments: DubSegment[] = [
    {
      id: 1,
      startTime: '00:00:01.000',
      endTime: '00:00:04.000',
      originalText: 'Hello world today',
      translatedText: 'Halo dunia hari',
      words: [
        { word: 'Halo', start: 1.0, end: 1.8 },
        { word: 'dunia', start: 1.8, end: 2.9 },
        { word: 'hari', start: 2.9, end: 4.0 },
      ],
    },
  ];

  const baseStyle: SubtitleStyle = {
    fontSize: 'lg',
    textColor: '#FFFFFF',
    backgroundEnabled: true,
    backgroundOpacity: 0.75,
    dynamicMode: 'classic',
  };

  const classicAss = buildAssSubtitles(segments, baseStyle);
  assert.match(classicAss, /\[Script Info\]/);
  assert.match(classicAss, /Dialogue: 0,0:00:01\.00,0:00:04\.00,Default,,0,0,0,,Halo dunia hari/);

  const karaokeAss = buildAssSubtitles(segments, { ...baseStyle, dynamicMode: 'karaoke' });
  assert.equal((karaokeAss.match(/^Dialogue:/gm) ?? []).length, 3);
  assert.match(karaokeAss, /\\c&H0047E0FD&\\b1\}Halo/);

  const popupAss = buildAssSubtitles(segments, { ...baseStyle, dynamicMode: 'word-popup' });
  assert.equal((popupAss.match(/^Dialogue:/gm) ?? []).length, 3);
  assert.match(popupAss, /\\c&H0047E0FD&\\b1\}dunia/);
});
