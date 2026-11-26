import type { DubSegment, SubtitleStyle } from '../types/dubbing';
import { getEffectiveWords, parseTimestampToSeconds } from './subtitleUtils';

export function hexToAssColor(hex: string, alphaHex = '00'): string {
  const clean = (hex || '#FFFFFF').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, 'F').slice(0, 6);
  const rr = full.slice(0, 2).toUpperCase();
  const gg = full.slice(2, 4).toUpperCase();
  const bb = full.slice(4, 6).toUpperCase();
  return `&H${alphaHex.toUpperCase()}${bb}${gg}${rr}`;
}

export function opacityToAssAlpha(opacity: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 0.75));
  const alphaByte = Math.round((1 - clamped) * 255);
  return alphaByte.toString(16).toUpperCase().padStart(2, '0');
}

export function secondsToAssTime(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const centis = Math.min(99, Math.round((safe - Math.floor(safe)) * 100));
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export function escapeAssText(text: string): string {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

const FONT_SIZE_MAP: Record<SubtitleStyle['fontSize'], number> = {
  sm: 30,
  md: 38,
  lg: 46,
  xl: 56,
};

export function buildAssSubtitles(
  segments: DubSegment[],
  style: SubtitleStyle,
  options?: {
    useOriginal?: boolean;
    width?: number;
    height?: number;
  }
): string {
  const playResX = options?.width ?? 1280;
  const playResY = options?.height ?? 720;
  const useOriginal = Boolean(options?.useOriginal);
  const fontSize = FONT_SIZE_MAP[style.fontSize] ?? 46;

  const primaryColour = hexToAssColor(style.textColor, '00');
  const highlightColour = '&H0047E0FD'; // #FDE047 yellow highlight
  const bgAlpha = opacityToAssAlpha(style.backgroundOpacity);
  const boxColour = style.backgroundEnabled ? `&H${bgAlpha}000000` : '&H00000000';
  const borderStyle = style.backgroundEnabled ? 3 : 1;
  const outlineSize = style.backgroundEnabled ? 10 : 2.5;
  const shadowSize = style.backgroundEnabled ? 0 : 1.5;

  const header = [
    '[Script Info]',
    'Title: VoxDub AI Hardsub Export',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,DejaVu Sans,${fontSize},${primaryColour},${highlightColour},${boxColour},${boxColour},-1,0,0,0,100,100,0,0,${borderStyle},${outlineSize},${shadowSize},2,54,54,42,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const sorted = [...segments].sort(
    (a, b) => parseTimestampToSeconds(a.startTime) - parseTimestampToSeconds(b.startTime)
  );

  const dialogues: string[] = [];

  for (const seg of sorted) {
    const segStart = parseTimestampToSeconds(seg.startTime);
    const segEnd = Math.max(segStart + 0.1, parseTimestampToSeconds(seg.endTime));
    const text = (useOriginal ? seg.originalText : seg.translatedText).trim();
    if (!text) continue;

    if (style.dynamicMode === 'classic' || useOriginal) {
      dialogues.push(
        `Dialogue: 0,${secondsToAssTime(segStart)},${secondsToAssTime(segEnd)},Default,,0,0,0,,${escapeAssText(text)}`
      );
      continue;
    }

    const words = getEffectiveWords(seg);
    if (words.length === 0) {
      dialogues.push(
        `Dialogue: 0,${secondsToAssTime(segStart)},${secondsToAssTime(segEnd)},Default,,0,0,0,,${escapeAssText(text)}`
      );
      continue;
    }

    if (style.dynamicMode === 'word-popup') {
      const chunkSize = 3;
      for (let i = 0; i < words.length; i++) {
        const wStart = i === 0 ? segStart : Math.max(segStart, words[i].start);
        const wEnd =
          i === words.length - 1
            ? segEnd
            : Math.max(wStart + 0.05, Math.min(segEnd, words[i + 1].start));
        const chunkIndex = Math.floor(i / chunkSize);
        const startIdx = chunkIndex * chunkSize;
        const slice = words.slice(startIdx, startIdx + chunkSize);
        const activeLocal = i - startIdx;

        const formatted = slice
          .map((item, localIdx) => {
            const safeWord = escapeAssText(item.word);
            return localIdx === activeLocal
              ? `{\\c${highlightColour}&\\b1}${safeWord}{\\r}`
              : `{\\alpha&H33&}${safeWord}{\\r}`;
          })
          .join(' ');

        dialogues.push(
          `Dialogue: 0,${secondsToAssTime(wStart)},${secondsToAssTime(wEnd)},Default,,0,0,0,,${formatted}`
        );
      }
      continue;
    }

    // Karaoke mode: highlight active word, full opacity for spoken, subtle fade for upcoming
    for (let i = 0; i < words.length; i++) {
      const wStart = i === 0 ? segStart : Math.max(segStart, words[i].start);
      const wEnd =
        i === words.length - 1
          ? segEnd
          : Math.max(wStart + 0.05, Math.min(segEnd, words[i + 1].start));

      const formatted = words
        .map((item, idx) => {
          const safeWord = escapeAssText(item.word);
          if (idx === i) {
            return `{\\c${highlightColour}&\\b1}${safeWord}{\\r}`;
          }
          if (idx < i) {
            return safeWord;
          }
          return `{\\alpha&H75&}${safeWord}{\\r}`;
        })
        .join(' ');

      dialogues.push(
        `Dialogue: 0,${secondsToAssTime(wStart)},${secondsToAssTime(wEnd)},Default,,0,0,0,,${formatted}`
      );
    }
  }

  return `${header.join('\n')}\n${dialogues.join('\n')}\n`;
}
