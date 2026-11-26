import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type {
  DubSegment,
  SubtitleRenderMode,
  SubtitleStyle,
} from '../types/dubbing';
import { DEMO_SCENE_FRAMES, DEMO_VIDEO_TITLE } from '../data/demoProject';
import { buildAssSubtitles } from './assSubtitle';
import { mergeSegmentsToMasterWav } from './audioMixer';
import type { RenderAudioMixMode } from './mp4RenderConfig';
import {
  findActiveSegment,
  getActiveWordIndex,
  getEffectiveWords,
  getWordPopupChunk,
  parseTimestampToSeconds,
  segmentsToSrt,
} from './subtitleUtils';

export type { RenderAudioMixMode };

export interface RenderMp4Options {
  selectedFile: File | null;
  videoUrl: string | null;
  videoName: string;
  segments: DubSegment[];
  subtitleStyle: SubtitleStyle;
  subtitleMode: SubtitleRenderMode;
  targetLanguage?: string;
  durationSeconds: number;
  showOriginalSubtitle: boolean;
  audioMixMode: RenderAudioMixMode;
  onProgress?: (percent: number, detail: string) => void;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCanvasSubtitle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  currentTime: number,
  segments: DubSegment[],
  style: SubtitleStyle,
  showOriginalSubtitle: boolean
) {
  const activeSeg = findActiveSegment(segments, currentTime);
  if (!activeSeg) return;

  const rawText = (
    showOriginalSubtitle ? activeSeg.originalText : activeSeg.translatedText
  ).trim();
  if (!rawText) return;

  const sizePxMap: Record<SubtitleStyle['fontSize'], number> = {
    sm: Math.round(height * 0.036),
    md: Math.round(height * 0.044),
    lg: Math.round(height * 0.052),
    xl: Math.round(height * 0.062),
  };
  const fontSize = Math.max(20, sizePxMap[style.fontSize] ?? 36);
  const lineHeight = Math.round(fontSize * 1.32);

  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const maxLineWidth = width * 0.86;
  const effectiveWords =
    !showOriginalSubtitle ? getEffectiveWords(activeSeg) : [];
  const activeWordIdx = getActiveWordIndex(effectiveWords, currentTime);

  interface StyledToken {
    text: string;
    color: string;
    bold: boolean;
    bgHighlight?: boolean;
  }

  let tokens: StyledToken[] = [];
  if (
    style.dynamicMode === 'word-popup' &&
    !showOriginalSubtitle &&
    effectiveWords.length > 0
  ) {
    const popup = getWordPopupChunk(effectiveWords, currentTime, 3);
    tokens = popup.words.map((w, idx) => ({
      text: w.word,
      color: idx === popup.activeLocalIndex ? '#FDE047' : style.textColor,
      bold: idx === popup.activeLocalIndex,
      bgHighlight: idx === popup.activeLocalIndex,
    }));
  } else if (
    style.dynamicMode === 'karaoke' &&
    !showOriginalSubtitle &&
    effectiveWords.length > 0
  ) {
    tokens = effectiveWords.map((w, idx) => {
      const isCurrent = idx === activeWordIdx;
      const isSpoken = currentTime >= w.start;
      return {
        text: w.word,
        color: isCurrent
          ? '#FDE047'
          : isSpoken
          ? style.textColor
          : 'rgba(255,255,255,0.48)',
        bold: isCurrent,
      };
    });
  } else {
    tokens = rawText
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({
        text: w,
        color: style.textColor,
        bold: false,
      }));
  }

  const spaceWidth = ctx.measureText(' ').width;
  const lines: StyledToken[][] = [];
  let currentLine: StyledToken[] = [];
  let currentWidth = 0;

  for (const token of tokens) {
    const tokenWidth = ctx.measureText(token.text).width;
    const nextWidth =
      currentLine.length === 0 ? tokenWidth : currentWidth + spaceWidth + tokenWidth;
    if (currentLine.length > 0 && nextWidth > maxLineWidth) {
      lines.push(currentLine);
      currentLine = [token];
      currentWidth = tokenWidth;
    } else {
      currentLine.push(token);
      currentWidth = nextWidth;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  const lineWidths = lines.map((line) =>
    line.reduce(
      (acc, t, idx) =>
        acc + ctx.measureText(t.text).width + (idx > 0 ? spaceWidth : 0),
      0
    )
  );
  const blockWidth = Math.min(maxLineWidth + 32, Math.max(...lineWidths) + 36);
  const blockHeight = lines.length * lineHeight + 20;
  const boxX = (width - blockWidth) / 2;
  const boxY = height - blockHeight - Math.round(height * 0.055);

  if (style.backgroundEnabled) {
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0.15, Math.min(0.95, style.backgroundOpacity))})`;
    drawRoundedRect(ctx, boxX, boxY, blockWidth, blockHeight, 14);
    ctx.fill();
  }

  lines.forEach((line, lIdx) => {
    const totalW = lineWidths[lIdx];
    let cursorX = (width - totalW) / 2;
    const centerY = boxY + 10 + lIdx * lineHeight + lineHeight / 2;

    line.forEach((token, tIdx) => {
      if (tIdx > 0) cursorX += spaceWidth;
      ctx.font = `${token.bold ? 700 : 600} ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const w = ctx.measureText(token.text).width;

      if (token.bgHighlight) {
        ctx.fillStyle = 'rgba(79, 70, 229, 0.72)';
        drawRoundedRect(ctx, cursorX - 6, centerY - lineHeight * 0.42, w + 12, lineHeight * 0.84, 6);
        ctx.fill();
      }

      if (!style.backgroundEnabled) {
        ctx.lineWidth = Math.max(3, fontSize * 0.1);
        ctx.strokeStyle = 'rgba(0,0,0,0.92)';
        ctx.strokeText(token.text, cursorX, centerY);
      }

      ctx.fillStyle = token.color;
      ctx.fillText(token.text, cursorX, centerY);
      cursorX += w;
    });
  });

  ctx.restore();
}

async function decodeWavToPcm(blob: Blob, targetSampleRate = 44100): Promise<Float32Array> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: targetSampleRate });
  try {
    const arr = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arr.slice(0));
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSampleRate), targetSampleRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    await ctx.close();
  }
}

async function renderMp4InBrowserWithWebCodecs(
  options: RenderMp4Options,
  dubAudioBlob: Blob | null,
  totalDurationSec: number
): Promise<Blob> {
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof AudioEncoder === 'undefined' ||
    typeof VideoFrame === 'undefined' ||
    typeof AudioData === 'undefined'
  ) {
    throw new Error(
      'Browser ini tidak mendukung WebCodecs MP4 encoder dan server FFmpeg tidak tersedia.'
    );
  }

  const fps = 24;
  let width = 1280;
  let height = 720;

  let videoEl: HTMLVideoElement | null = null;
  if (options.videoUrl && options.selectedFile && !options.selectedFile.type.startsWith('audio/')) {
    videoEl = document.createElement('video');
    videoEl.src = options.videoUrl;
    videoEl.muted = true;
    videoEl.playsInline = true;
    await new Promise<void>((resolve, reject) => {
      if (!videoEl) return resolve();
      videoEl.onloadedmetadata = () => resolve();
      videoEl.onerror = () => reject(new Error('Gagal memuat video sumber di browser.'));
    });
    if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      const scale = Math.min(1, 1280 / videoEl.videoWidth);
      width = Math.max(320, Math.floor((videoEl.videoWidth * scale) / 2) * 2);
      height = Math.max(180, Math.floor((videoEl.videoHeight * scale) / 2) * 2);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Gagal membuat canvas renderer.');

  const sampleRate = 44100;
  let pcmSamples: Float32Array;
  if (dubAudioBlob) {
    pcmSamples = await decodeWavToPcm(dubAudioBlob, sampleRate);
  } else {
    pcmSamples = new Float32Array(Math.ceil(totalDurationSec * sampleRate));
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: { codec: 'aac', numberOfChannels: 1, sampleRate },
    fastStart: 'in-memory',
  });

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      throw err;
    },
  });
  videoEncoder.configure({
    codec: 'avc1.42001f',
    width,
    height,
    bitrate: 2_500_000,
    framerate: fps,
  });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (err) => {
      throw err;
    },
  });
  audioEncoder.configure({
    codec: 'mp4a.40.2',
    numberOfChannels: 1,
    sampleRate,
    bitrate: 128_000,
  });

  // Encode audio frames in 1024-sample chunks
  const audioChunkSize = 1024;
  for (let offset = 0; offset < pcmSamples.length; offset += audioChunkSize) {
    const slice = pcmSamples.subarray(offset, offset + audioChunkSize);
    const padded = new Float32Array(slice.length);
    padded.set(slice);
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: padded.length,
      numberOfChannels: 1,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: padded,
    });
    audioEncoder.encode(audioData);
    audioData.close();
  }

  const totalFrames = Math.max(1, Math.ceil(totalDurationSec * fps));
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    const t = frameIdx / fps;
    if (frameIdx % 12 === 0 || frameIdx === totalFrames - 1) {
      const pct = 25 + Math.round(((frameIdx + 1) / totalFrames) * 70);
      options.onProgress?.(pct, `Merender frame ${frameIdx + 1}/${totalFrames}...`);
    }

    if (videoEl) {
      videoEl.currentTime = Math.min(totalDurationSec, t);
      await new Promise<void>((resolve) => {
        if (!videoEl) return resolve();
        const onSeeked = () => resolve();
        videoEl.addEventListener('seeked', onSeeked, { once: true });
      });
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(videoEl, 0, 0, width, height);
    } else {
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#0F1322');
      grad.addColorStop(0.5, '#13182B');
      grad.addColorStop(1, '#0B0D14');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      const scene =
        DEMO_SCENE_FRAMES.find((f) => t >= f.startSec && t < f.endSec) ??
        DEMO_SCENE_FRAMES[0];
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = '700 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(options.videoName || DEMO_VIDEO_TITLE, width / 2, height * 0.38);
      ctx.fillStyle = 'rgba(148,163,184,0.85)';
      ctx.font = '500 18px system-ui, sans-serif';
      ctx.fillText(scene.speaker, width / 2, height * 0.45);
    }

    if (options.subtitleMode === 'hardsub') {
      drawCanvasSubtitle(
        ctx,
        width,
        height,
        t,
        options.segments,
        options.subtitleStyle,
        options.showOriginalSubtitle
      );
    }

    const videoFrame = new VideoFrame(canvas, {
      timestamp: Math.round((frameIdx / fps) * 1_000_000),
      duration: Math.round((1 / fps) * 1_000_000),
    });
    videoEncoder.encode(videoFrame, { keyFrame: frameIdx % 48 === 0 });
    videoFrame.close();
  }

  options.onProgress?.(96, 'Menyelesaikan file MP4...');
  await videoEncoder.flush();
  await audioEncoder.flush();
  videoEncoder.close();
  audioEncoder.close();
  muxer.finalize();

  return new Blob([target.buffer], { type: 'video/mp4' });
}

export interface RenderMp4Result {
  blob: Blob;
  companionSrt?: string;
}

export async function renderVideoToMp4(options: RenderMp4Options): Promise<RenderMp4Result> {
  const maxSegEnd = options.segments.reduce(
    (max, s) => Math.max(max, parseTimestampToSeconds(s.endTime)),
    0
  );
  const totalDurationSec = Math.max(options.durationSeconds || 0, maxSegEnd, 2);

  options.onProgress?.(10, 'Menggabungkan trek audio voice-over...');

  const hasDubClips = options.segments.some((s) => Boolean(s.audioUrl));
  let dubAudioBlob: Blob | null = null;
  if (hasDubClips && options.audioMixMode !== 'original') {
    dubAudioBlob = await mergeSegmentsToMasterWav(options.segments, totalDurationSec);
  }

  let assContent = '';
  let srtContent = '';

  if (options.subtitleMode === 'hardsub') {
    options.onProgress?.(22, 'Menyiapkan hardsub (.ASS) sesuai gaya subtitle...');
    assContent = buildAssSubtitles(options.segments, options.subtitleStyle, {
      useOriginal: options.showOriginalSubtitle,
      width: 1280,
      height: 720,
    });
  } else if (options.subtitleMode === 'softsub') {
    options.onProgress?.(22, 'Menyiapkan trek softsub (.SRT) terpisah...');
    srtContent = segmentsToSrt(options.segments, options.showOriginalSubtitle);
  } else {
    options.onProgress?.(22, 'Menyiapkan render video Dubbing Only (tanpa subtitle)...');
  }

  const formData = new FormData();
  if (options.selectedFile) {
    formData.append('media', options.selectedFile);
  }
  if (dubAudioBlob) {
    formData.append('dubAudio', dubAudioBlob, 'voiceover.wav');
  }
  formData.append('subtitleMode', options.subtitleMode);
  if (assContent) {
    formData.append('assContent', assContent);
  }
  if (srtContent) {
    formData.append('srtContent', srtContent);
  }
  if (options.targetLanguage) {
    formData.append('targetLanguage', options.targetLanguage);
  }
  formData.append('durationSeconds', String(totalDurationSec));
  formData.append('audioMixMode', options.audioMixMode);
  formData.append('title', options.videoName || DEMO_VIDEO_TITLE);

  const progressMsg =
    options.subtitleMode === 'softsub'
      ? 'Merender video MP4 dengan trek softsub & voice-over...'
      : options.subtitleMode === 'dubbing_only'
      ? 'Merender video MP4 dubbing only (tanpa subtitle)...'
      : 'Merender video MP4 dengan hardsub & voice-over...';

  options.onProgress?.(40, progressMsg);
  const res = await fetch('/api/render-mp4', {
    method: 'POST',
    body: formData,
  });

  if (res.ok) {
    options.onProgress?.(92, 'Mengunduh hasil video MP4...');
    return { blob: await res.blob() };
  }

  const errData = (await res.json().catch(() => null)) as {
    ffmpegUnavailable?: boolean;
    error?: string;
  } | null;

  if (res.status === 501 && errData?.ffmpegUnavailable) {
    options.onProgress?.(25, 'Merender video MP4 langsung di browser (WebCodecs)...');
    const blob = await renderMp4InBrowserWithWebCodecs(
      options,
      dubAudioBlob,
      totalDurationSec
    );
    return {
      blob,
      ...(options.subtitleMode === 'softsub' && srtContent
        ? { companionSrt: srtContent }
        : {}),
    };
  }

  throw new Error(errData?.error || 'Gagal merender video MP4.');
}
