import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimestampToSeconds,
  formatSecondsToTimestamp,
  formatTimecodeShort,
  findActiveSegment,
  computeDubbingPlaybackRate,
  validateSegmentTiming,
  segmentsToSrt,
  segmentsToVtt,
  syncWordsWithText,
  applyTextCorrectionToWords,
  getActiveWordIndex,
  getWordPopupChunk,
  sanitizeSegmentsForFirestore,
} from './subtitleUtils';
import { encodeFloat32ToWavBuffer } from './audioMixer';
import {
  buildTimelineWaveformBuckets,
  computeSegmentTimelineBands,
} from './waveformUtils';
import type { DubSegment } from '../types/dubbing';

const sampleSegments: DubSegment[] = [
  {
    id: 1,
    startTime: '00:00:01.000',
    endTime: '00:00:04.500',
    originalText: 'Welcome to the future of robotics.',
    translatedText: 'Selamat datang di masa depan robotika.',
    words: [
      { word: 'Selamat', start: 1.0, end: 1.5 },
      { word: 'datang', start: 1.5, end: 2.0 },
      { word: 'di', start: 2.0, end: 2.3 },
      { word: 'masa', start: 2.3, end: 2.8 },
      { word: 'depan', start: 2.8, end: 3.4 },
      { word: 'robotika.', start: 3.4, end: 4.5 },
    ],
  },
  {
    id: 2,
    startTime: '00:00:05.000',
    endTime: '00:00:09.250',
    originalText: 'These neural actuators adapt in real time.',
    translatedText: 'Aktuator saraf ini beradaptasi secara langsung.',
  },
];

test('parseTimestampToSeconds parses HH:MM:SS.mmm, comma, and numeric seconds', () => {
  assert.equal(parseTimestampToSeconds('00:00:01.000'), 1);
  assert.equal(parseTimestampToSeconds(2.75), 2.75);
  assert.equal(parseTimestampToSeconds('00:01:05.500'), 65.5);
  assert.equal(parseTimestampToSeconds('01:02:03,250'), 3723.25);
  assert.equal(parseTimestampToSeconds('02:30.000'), 150);
  assert.equal(parseTimestampToSeconds('invalid'), 0);
});

test('formatSecondsToTimestamp formats clean HH:MM:SS.mmm strings', () => {
  assert.equal(formatSecondsToTimestamp(0), '00:00:00.000');
  assert.equal(formatSecondsToTimestamp(4.5), '00:00:04.500');
  assert.equal(formatSecondsToTimestamp(3661.25), '01:01:01.250');
  assert.equal(formatTimecodeShort(65), '01:05');
  assert.equal(formatTimecodeShort(3665), '01:01:05');
});

test('findActiveSegment matches current playback time accurately', () => {
  assert.equal(findActiveSegment(sampleSegments, 0.5), null);
  assert.equal(findActiveSegment(sampleSegments, 1.0)?.id, 1);
  assert.equal(findActiveSegment(sampleSegments, 3.2)?.id, 1);
  assert.equal(findActiveSegment(sampleSegments, 4.75), null);
  assert.equal(findActiveSegment(sampleSegments, 7.0)?.id, 2);
});

test('word-level timestamp sync, active word lookup, and pop-up chunking', () => {
  const synced = syncWordsWithText('Halo dunia baru', 1.0, 4.0);
  assert.equal(synced.length, 3);
  assert.equal(synced[0].start, 1.0);
  assert.equal(synced[2].end, 4.0);

  const words = sampleSegments[0].words!;
  assert.equal(getActiveWordIndex(words, 0.5), -1);
  assert.equal(getActiveWordIndex(words, 1.2), 0);
  assert.equal(getActiveWordIndex(words, 2.9), 4);
  assert.equal(getActiveWordIndex(words, 4.0), 5);

  const chunk1 = getWordPopupChunk(words, 1.2, 3);
  assert.deepEqual(chunk1.words.map((w) => w.word), ['Selamat', 'datang', 'di']);
  assert.equal(chunk1.activeLocalIndex, 0);

  const chunk2 = getWordPopupChunk(words, 2.9, 3);
  assert.deepEqual(chunk2.words.map((w) => w.word), ['masa', 'depan', 'robotika.']);
  assert.equal(chunk2.activeLocalIndex, 1);
});

test('sanitizeSegmentsForFirestore strips audioUrl and enforces blueprint bounds', () => {
  const dirty: DubSegment[] = [
    {
      ...sampleSegments[0],
      audioUrl: 'blob:http://localhost:3000/123',
      audioDuration: 3.1,
      isGeneratingAudio: false,
      translatedText: 'A'.repeat(2500),
    },
  ];
  const clean = sanitizeSegmentsForFirestore(dirty);
  assert.equal('audioUrl' in clean[0], false);
  assert.equal(clean[0].translatedText.length, 2000);
});

test('computeDubbingPlaybackRate scales speed only when clip exceeds slot and clamps at 1.55', () => {
  assert.equal(computeDubbingPlaybackRate(3.0, 3.5), 1.0);
  assert.equal(computeDubbingPlaybackRate(3.55, 3.5), 1.0);
  assert.equal(computeDubbingPlaybackRate(4.2, 3.5), 1.2);
  assert.equal(computeDubbingPlaybackRate(9.0, 3.0), 1.55);
});

test('validateSegmentTiming checks end > start', () => {
  assert.equal(validateSegmentTiming('00:00:01.000', '00:00:04.000'), true);
  assert.equal(validateSegmentTiming('00:00:04.000', '00:00:04.000'), false);
  assert.equal(validateSegmentTiming('00:00:05.000', '00:00:04.000'), false);
});

test('segmentsToSrt and segmentsToVtt produce valid subtitle outputs', () => {
  const srt = segmentsToSrt(sampleSegments);
  assert.match(srt, /^1\n00:00:01,000 --> 00:00:04,500\nSelamat datang di masa depan robotika\./);
  assert.match(srt, /2\n00:00:05,000 --> 00:00:09,250\nAktuator saraf ini beradaptasi secara langsung\./);

  const vtt = segmentsToVtt(sampleSegments);
  assert.match(vtt, /^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:04\.500/);
  assert.match(vtt, /Aktuator saraf ini beradaptasi secara langsung\./);
});

test('encodeFloat32ToWavBuffer writes valid RIFF/WAVE PCM16 header', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const buffer = encodeFloat32ToWavBuffer(samples, 24000);
  assert.equal(buffer.byteLength, 44 + samples.length * 2);

  const bytes = new Uint8Array(buffer);
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  assert.equal(riff, 'RIFF');
  assert.equal(wave, 'WAVE');
});

test('computeSegmentTimelineBands and buildTimelineWaveformBuckets map segments accurately', () => {
  const bands = computeSegmentTimelineBands(sampleSegments, 10);
  assert.equal(bands.length, 2);
  assert.equal(bands[0].leftPct, 10);
  assert.equal(bands[0].widthPct, 35);
  assert.equal(bands[1].leftPct, 50);

  const peaksMap = new Map<number, number[]>([
    [1, [0.2, 0.8, 0.6]],
  ]);
  const segsWithAudio: DubSegment[] = [
    { ...sampleSegments[0], audioUrl: 'blob:audio1' },
    sampleSegments[1],
  ];

  const buckets = buildTimelineWaveformBuckets(segsWithAudio, 10, peaksMap, 20);
  assert.equal(buckets.length, 20);
  assert.equal(buckets[0].segmentId, null);
  assert.equal(buckets[0].hasAudio, false);
  assert.equal(buckets[4].segmentId, 1);
  assert.equal(buckets[4].hasAudio, true);
  assert.ok(buckets[4].amplitude >= 0.2);
  assert.equal(buckets[12].segmentId, 2);
  assert.equal(buckets[12].hasAudio, false);
});

test('applyTextCorrectionToWords preserves word timestamps on same word count and stays within bounds otherwise', () => {
  const originalWords = [
    { word: 'Haloo', start: 1.0, end: 1.8 },
    { word: 'duniaa', start: 1.8, end: 3.0 },
  ];
  const sameCount = applyTextCorrectionToWords(originalWords, 'Halo dunia', 1.0, 3.0);
  assert.deepEqual(sameCount, [
    { word: 'Halo', start: 1.0, end: 1.8 },
    { word: 'dunia', start: 1.8, end: 3.0 },
  ]);

  const diffCount = applyTextCorrectionToWords(originalWords, 'Halo dunia indah', 1.0, 3.0);
  assert.equal(diffCount.length, 3);
  assert.equal(diffCount[0].start, 1.0);
  assert.equal(diffCount[2].end, 3.0);
});
