import type { DubSegment, WordTimestamp } from '../types/dubbing';

/**
 * Parse a timestamp string ("HH:MM:SS.mmm", "MM:SS.mmm", or "HH:MM:SS,mmm")
 * or numeric seconds into seconds. Returns 0 if invalid.
 */
export function parseTimestampToSeconds(timestamp: string | number): number {
  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
  }
  if (!timestamp || typeof timestamp !== 'string') return 0;
  const normalized = timestamp.trim().replace(',', '.');
  const parts = normalized.split(':');

  if (parts.length === 3) {
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    const seconds = Number(parts[2]);
    if ([hours, minutes, seconds].some((n) => Number.isNaN(n) || n < 0)) return 0;
    return hours * 3600 + minutes * 60 + seconds;
  }

  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if ([minutes, seconds].some((n) => Number.isNaN(n) || n < 0)) return 0;
    return minutes * 60 + seconds;
  }

  const single = Number(normalized);
  return Number.isNaN(single) || single < 0 ? 0 : single;
}

/**
 * Format seconds into "HH:MM:SS.mmm"
 */
export function formatSecondsToTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);

  if (millis === 1000) {
    return formatSecondsToTimestamp(Math.floor(safe) + 1);
  }

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(millis).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Format seconds into concise player display "MM:SS" or "HH:MM:SS"
 */
export function formatTimecodeShort(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Format timestamp string to standard SRT timecode ("HH:MM:SS,mmm")
 */
export function toSrtTimestamp(timestamp: string | number): string {
  const sec = parseTimestampToSeconds(timestamp);
  return formatSecondsToTimestamp(sec).replace('.', ',');
}

/**
 * Format timestamp string to standard WebVTT timecode ("HH:MM:SS.mmm")
 */
export function toVttTimestamp(timestamp: string | number): string {
  const sec = parseTimestampToSeconds(timestamp);
  return formatSecondsToTimestamp(sec);
}

/**
 * Find the active segment for the given video currentTime in seconds.
 */
export function findActiveSegment(
  segments: DubSegment[],
  currentTimeSec: number
): DubSegment | null {
  for (const seg of segments) {
    const start = parseTimestampToSeconds(seg.startTime);
    const end = parseTimestampToSeconds(seg.endTime);
    if (currentTimeSec >= start && currentTimeSec <= end) {
      return seg;
    }
  }
  return null;
}

/**
 * Generate proportional word-level timestamps across [startSec, endSec] weighted by word length.
 * Used when segments are manually edited or lack explicit word timing.
 */
export function syncWordsWithText(
  text: string,
  startSec: number,
  endSec: number
): WordTimestamp[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const safeStart = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
  const safeEnd = Math.max(safeStart + 0.1, Number.isFinite(endSec) ? endSec : safeStart + 1);
  const totalDuration = safeEnd - safeStart;

  const weights = tokens.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, '').length));
  const totalWeight = weights.reduce((acc, n) => acc + n, 0);

  let cursor = safeStart;
  return tokens.map((word, index) => {
    const slice = (weights[index] / totalWeight) * totalDuration;
    const wStart = Number(cursor.toFixed(3));
    const wEnd =
      index === tokens.length - 1
        ? Number(safeEnd.toFixed(3))
        : Number((cursor + slice).toFixed(3));
    cursor += slice;
    return {
      word,
      start: wStart,
      end: Math.max(wStart + 0.05, wEnd),
    };
  });
}

/**
 * Resolve effective word-level timestamps for a segment (explicit Gemini words or synced fallback).
 */
export function getEffectiveWords(segment: DubSegment): WordTimestamp[] {
  if (Array.isArray(segment.words) && segment.words.length > 0) {
    return segment.words;
  }
  return syncWordsWithText(
    segment.translatedText,
    parseTimestampToSeconds(segment.startTime),
    parseTimestampToSeconds(segment.endTime)
  );
}

/**
 * Update word tokens after grammar/spelling correction while preserving exact
 * per-word timestamps if word count is unchanged, or keeping words inside [startSec, endSec].
 */
export function applyTextCorrectionToWords(
  existingWords: WordTimestamp[] | undefined,
  correctedText: string,
  startSec: number,
  endSec: number
): WordTimestamp[] {
  const tokens = correctedText.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  if (Array.isArray(existingWords) && existingWords.length === tokens.length) {
    return existingWords.map((w, idx) => ({
      word: tokens[idx],
      start: w.start,
      end: w.end,
    }));
  }
  return syncWordsWithText(correctedText, startSec, endSec);
}

/**
 * Return the index of the currently active word at currentTimeSec, or -1 if none.
 */
export function getActiveWordIndex(
  words: WordTimestamp[],
  currentTimeSec: number
): number {
  if (!words.length) return -1;
  for (let i = 0; i < words.length; i++) {
    if (currentTimeSec >= words[i].start && currentTimeSec <= words[i].end) {
      return i;
    }
  }
  // If between words inside segment, highlight the most recently started word
  let lastStarted = -1;
  for (let i = 0; i < words.length; i++) {
    if (currentTimeSec >= words[i].start) {
      lastStarted = i;
    }
  }
  return lastStarted;
}

/**
 * Return a small kinetic chunk of words around the active word for Word-by-Word Pop-up captions.
 */
export function getWordPopupChunk(
  words: WordTimestamp[],
  currentTimeSec: number,
  chunkSize = 3
): { words: WordTimestamp[]; activeLocalIndex: number } {
  if (!words.length) return { words: [], activeLocalIndex: -1 };
  const activeIdx = Math.max(0, getActiveWordIndex(words, currentTimeSec));
  const chunkIndex = Math.floor(activeIdx / chunkSize);
  const startIdx = chunkIndex * chunkSize;
  const slice = words.slice(startIdx, startIdx + chunkSize);
  return {
    words: slice,
    activeLocalIndex: activeIdx - startIdx,
  };
}

/**
 * Compute playbackRate for a dubbed audio clip so it fits comfortably within
 * the segment window without sounding overly distorted.
 * Clamped to [0.85, 1.55].
 */
export function computeDubbingPlaybackRate(
  audioDurationSec: number,
  segmentDurationSec: number
): number {
  if (
    !Number.isFinite(audioDurationSec) ||
    !Number.isFinite(segmentDurationSec) ||
    audioDurationSec <= 0 ||
    segmentDurationSec <= 0
  ) {
    return 1.0;
  }

  if (audioDurationSec > segmentDurationSec * 1.03) {
    const ratio = audioDurationSec / segmentDurationSec;
    return Math.min(1.55, Math.max(1.0, Number(ratio.toFixed(2))));
  }

  return 1.0;
}

/**
 * Validate whether a segment's startTime < endTime
 */
export function validateSegmentTiming(startTime: string, endTime: string): boolean {
  const start = parseTimestampToSeconds(startTime);
  const end = parseTimestampToSeconds(endTime);
  return end > start;
}

/**
 * Convert an array of segments to standard SubRip (.SRT) text.
 */
export function segmentsToSrt(segments: DubSegment[], useOriginal = false): string {
  const sorted = [...segments].sort(
    (a, b) => parseTimestampToSeconds(a.startTime) - parseTimestampToSeconds(b.startTime)
  );

  return sorted
    .map((seg, idx) => {
      const start = toSrtTimestamp(seg.startTime);
      const end = toSrtTimestamp(seg.endTime);
      const text = (useOriginal ? seg.originalText : seg.translatedText).trim();
      return `${idx + 1}\n${start} --> ${end}\n${text}`;
    })
    .join('\n\n')
    .concat(sorted.length > 0 ? '\n' : '');
}

/**
 * Convert an array of segments to standard WebVTT (.VTT) text.
 */
export function segmentsToVtt(segments: DubSegment[], useOriginal = false): string {
  const sorted = [...segments].sort(
    (a, b) => parseTimestampToSeconds(a.startTime) - parseTimestampToSeconds(b.startTime)
  );

  const body = sorted
    .map((seg, idx) => {
      const start = toVttTimestamp(seg.startTime);
      const end = toVttTimestamp(seg.endTime);
      const text = (useOriginal ? seg.originalText : seg.translatedText).trim();
      return `${idx + 1}\n${start} --> ${end}\n${text}`;
    })
    .join('\n\n');

  return body ? `WEBVTT\n\n${body}\n` : 'WEBVTT\n\n';
}

export function getSegmentDurationSeconds(seg: Pick<DubSegment, 'startTime' | 'endTime'>): number {
  return Math.max(0, parseTimestampToSeconds(seg.endTime) - parseTimestampToSeconds(seg.startTime));
}

/**
 * Sanitize segments to strictly conform to Firestore blueprint bounds (<= 200 segments,
 * <= 2000 char strings, <= 500 words per segment, no ephemeral blob URLs).
 */
export function sanitizeSegmentsForFirestore(segments: DubSegment[]): DubSegment[] {
  return segments.slice(0, 200).map((seg, idx) => {
    const cleanWords = (seg.words ?? []).slice(0, 500).map((w) => ({
      word: String(w.word ?? '').slice(0, 100),
      start: Number.isFinite(w.start) ? Number(w.start.toFixed(3)) : 0,
      end: Number.isFinite(w.end) ? Number(w.end.toFixed(3)) : 0,
    }));

    return {
      id: Number.isFinite(seg.id) ? seg.id : idx + 1,
      startTime: String(seg.startTime ?? '00:00:00.000').slice(0, 32),
      endTime: String(seg.endTime ?? '00:00:03.000').slice(0, 32),
      originalText: String(seg.originalText ?? '').slice(0, 2000),
      translatedText: String(seg.translatedText ?? '').slice(0, 2000),
      words: cleanWords,
    };
  });
}
