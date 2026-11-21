import type { DubSegment } from '../types/dubbing';
import {
  computeDubbingPlaybackRate,
  parseTimestampToSeconds,
} from './subtitleUtils';

export interface WaveformBucket {
  amplitude: number; // normalized [0.06, 1.0] for audio, [0.04] for silence
  hasAudio: boolean;
  segmentId: number | null;
}

export interface WaveformSegmentBand {
  id: number;
  index: number;
  startSec: number;
  endSec: number;
  leftPct: number;
  widthPct: number;
  hasAudio: boolean;
}

/**
 * Pure helper: compute timeline segment bands as percentages across [0, totalDurationSec].
 */
export function computeSegmentTimelineBands(
  segments: DubSegment[],
  totalDurationSec: number
): WaveformSegmentBand[] {
  const maxSegEnd = segments.reduce(
    (acc, s) => Math.max(acc, parseTimestampToSeconds(s.endTime)),
    0
  );
  const safeTotal = Math.max(totalDurationSec || 0, maxSegEnd, 1);

  return segments.map((seg, idx) => {
    const startSec = Math.max(0, parseTimestampToSeconds(seg.startTime));
    const endSec = Math.max(startSec, parseTimestampToSeconds(seg.endTime));
    const leftPct = Math.min(100, (startSec / safeTotal) * 100);
    const widthPct = Math.max(0.5, Math.min(100 - leftPct, ((endSec - startSec) / safeTotal) * 100));
    return {
      id: seg.id,
      index: idx + 1,
      startSec,
      endSec,
      leftPct,
      widthPct,
      hasAudio: Boolean(seg.audioUrl),
    };
  });
}

/**
 * Pure helper: map decoded per-segment PCM peak envelopes (or deterministic fallback
 * envelopes) onto a fixed number of timeline buckets across [0, totalDurationSec].
 */
export function buildTimelineWaveformBuckets(
  segments: DubSegment[],
  totalDurationSec: number,
  segmentPeaksMap: Map<number, number[]>,
  bucketCount = 120
): WaveformBucket[] {
  const safeBuckets = Math.max(16, bucketCount);
  const maxSegEnd = segments.reduce(
    (acc, s) => Math.max(acc, parseTimestampToSeconds(s.endTime)),
    0
  );
  const safeTotal = Math.max(totalDurationSec || 0, maxSegEnd, 1);

  const buckets: WaveformBucket[] = Array.from({ length: safeBuckets }, () => ({
    amplitude: 0.05,
    hasAudio: false,
    segmentId: null,
  }));

  for (let b = 0; b < safeBuckets; b++) {
    const bucketStart = (b / safeBuckets) * safeTotal;
    const bucketEnd = ((b + 1) / safeBuckets) * safeTotal;
    const bucketMid = (bucketStart + bucketEnd) / 2;

    const matchingSeg = segments.find((seg) => {
      const s = parseTimestampToSeconds(seg.startTime);
      const e = parseTimestampToSeconds(seg.endTime);
      return bucketMid >= s && bucketMid <= e;
    });

    if (!matchingSeg) continue;

    const segStart = parseTimestampToSeconds(matchingSeg.startTime);
    const segEnd = Math.max(segStart + 0.1, parseTimestampToSeconds(matchingSeg.endTime));
    const rel = Math.max(0, Math.min(0.999, (bucketMid - segStart) / (segEnd - segStart)));

    const peaks = segmentPeaksMap.get(matchingSeg.id);
    if (peaks && peaks.length > 0) {
      const peakIdx = Math.min(peaks.length - 1, Math.floor(rel * peaks.length));
      buckets[b] = {
        amplitude: Math.max(0.1, Math.min(1, peaks[peakIdx])),
        hasAudio: true,
        segmentId: matchingSeg.id,
      };
    } else if (matchingSeg.audioUrl) {
      // Deterministic envelope fallback if clip is still decoding
      const wave = 0.42 + 0.38 * Math.abs(Math.sin(rel * Math.PI * 5 + matchingSeg.id));
      buckets[b] = {
        amplitude: Number(wave.toFixed(3)),
        hasAudio: true,
        segmentId: matchingSeg.id,
      };
    } else {
      // Segment exists without TTS audio yet
      buckets[b] = {
        amplitude: 0.14,
        hasAudio: false,
        segmentId: matchingSeg.id,
      };
    }
  }

  return buckets;
}

/**
 * Decode each segment's WAV/audio clip using AudioContext and compute normalized peak samples.
 */
export async function extractSegmentPeakEnvelopes(
  segments: DubSegment[],
  samplesPerSegment = 48
): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;

  if (!AudioCtx) return result;

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    for (const seg of segments) {
      if (!seg.audioUrl) continue;
      try {
        const res = await fetch(seg.audioUrl);
        const buf = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        const channel = decoded.getChannelData(0);
        if (channel.length === 0) continue;

        const segDuration = Math.max(
          0.1,
          parseTimestampToSeconds(seg.endTime) - parseTimestampToSeconds(seg.startTime)
        );
        const rate = computeDubbingPlaybackRate(decoded.duration, segDuration);
        // Account for playbackRate compression so waveform aligns with segment window
        const effectiveLen = Math.min(
          channel.length,
          Math.floor(channel.length / Math.max(1, rate * 0.98))
        );
        const step = Math.max(1, Math.floor(effectiveLen / samplesPerSegment));
        const rawPeaks: number[] = [];

        let maxPeak = 0.01;
        for (let i = 0; i < samplesPerSegment; i++) {
          const start = i * step;
          const end = Math.min(channel.length, start + step);
          let peak = 0;
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channel[j]);
            if (abs > peak) peak = abs;
          }
          if (peak > maxPeak) maxPeak = peak;
          rawPeaks.push(peak);
        }

        // Normalize peaks to [0.12, 1.0] relative to clip max
        const normalized = rawPeaks.map((p) =>
          Math.max(0.12, Math.min(1.0, Number((p / maxPeak).toFixed(3))))
        );
        result.set(seg.id, normalized);
      } catch {
        // Ignore single clip decode error
      }
    }
  } finally {
    if (ctx) {
      await ctx.close().catch(() => {});
    }
  }

  return result;
}
