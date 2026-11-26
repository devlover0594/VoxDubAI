import type { DubSegment } from '../types/dubbing';
import { parseTimestampToSeconds } from './subtitleUtils';

/**
 * Encode mono Float32 PCM samples [-1, 1] into a standard 16-bit PCM WAV byte buffer.
 */
export function encodeFloat32ToWavBuffer(
  samples: Float32Array,
  sampleRate = 24000
): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt subchunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data subchunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return buffer;
}

/**
 * Synthesize a soft spoken-cadence tone envelope WAV URL for deterministic demo previews
 * when no network TTS clip has been generated yet.
 */
export function createSynthesizedDemoWavUrl(
  durationSeconds: number,
  baseFreq = 210
): string {
  const sampleRate = 24000;
  const safeDuration = Math.max(0.5, Math.min(15, durationSeconds));
  const length = Math.floor(sampleRate * safeDuration);
  const samples = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const progress = t / safeDuration;
    // Smooth fade-in and fade-out + syllable-like amplitude modulation
    const edgeEnvelope =
      Math.min(1, t / 0.08) * Math.min(1, (safeDuration - t) / 0.12);
    const cadence = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.4 * t);
    const pitchGlide = baseFreq + 22 * Math.sin(2 * Math.PI * 0.9 * progress);
    const wave =
      0.65 * Math.sin(2 * Math.PI * pitchGlide * t) +
      0.25 * Math.sin(2 * Math.PI * (pitchGlide * 1.5) * t);
    samples[i] = wave * edgeEnvelope * cadence * 0.14;
  }

  const wavBuffer = encodeFloat32ToWavBuffer(samples, sampleRate);
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Convert base64 audio (WAV/MP3/OGG) returned by server into an Object URL and measure its duration.
 */
export async function base64WavToObjectUrl(
  base64: string,
  mimeType = 'audio/wav'
): Promise<{ url: string; duration: number }> {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType || 'audio/wav' });
  const url = URL.createObjectURL(blob);

  const duration = await measureAudioDuration(url);
  return { url, duration };
}

export function measureAudioDuration(audioUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const cleanup = () => {
      audio.removeAttribute('src');
    };
    audio.addEventListener(
      'loadedmetadata',
      () => {
        const d = Number.isFinite(audio.duration) ? audio.duration : 0;
        cleanup();
        resolve(d);
      },
      { once: true }
    );
    audio.addEventListener(
      'error',
      () => {
        cleanup();
        resolve(0);
      },
      { once: true }
    );
    audio.src = audioUrl;
  });
}

/**
 * Merge all dubbed segment audio clips onto a single timeline WAV file
 * aligned at each segment's startTime.
 */
export async function mergeSegmentsToMasterWav(
  segments: DubSegment[],
  videoDurationSec: number
): Promise<Blob> {
  const targetSampleRate = 24000;
  const maxEnd = segments.reduce((acc, seg) => {
    const end = parseTimestampToSeconds(seg.endTime);
    return Math.max(acc, end);
  }, 0);
  const totalSec = Math.max(videoDurationSec || 0, maxEnd, 1);
  const totalSamples = Math.ceil(totalSec * targetSampleRate);
  const master = new Float32Array(totalSamples);

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: targetSampleRate });

  try {
    for (const seg of segments) {
      if (!seg.audioUrl) continue;
      try {
        const res = await fetch(seg.audioUrl);
        const arrayBuf = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
        const channelData = decoded.getChannelData(0);

        const startSec = parseTimestampToSeconds(seg.startTime);
        const endSec = parseTimestampToSeconds(seg.endTime);
        const segDur = Math.max(0.2, endSec - startSec);
        const clipDur = decoded.duration;

        // Time-compress linearly if clip slightly exceeds segment slot
        const speedFactor = clipDur > segDur * 1.03 ? Math.min(1.55, clipDur / segDur) : 1.0;
        const startIndex = Math.floor(startSec * targetSampleRate);
        const outLength = Math.floor(channelData.length / speedFactor);

        for (let i = 0; i < outLength; i++) {
          const targetIdx = startIndex + i;
          if (targetIdx >= master.length) break;
          const srcPos = i * speedFactor;
          const idx0 = Math.floor(srcPos);
          const idx1 = Math.min(channelData.length - 1, idx0 + 1);
          const frac = srcPos - idx0;
          const sample = channelData[idx0] * (1 - frac) + channelData[idx1] * frac;
          master[targetIdx] = Math.max(-1, Math.min(1, master[targetIdx] + sample));
        }
      } catch {
        // Skip unreadable clip
      }
    }
  } finally {
    await ctx.close();
  }

  const wavBuffer = encodeFloat32ToWavBuffer(master, targetSampleRate);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}
