import type { SubtitleRenderMode } from '../types/dubbing.ts';

export type RenderAudioMixMode = 'dubbed_only' | 'dubbed_with_bg' | 'original';

const ISO_639_2_MAP: Record<string, string> = {
  id: 'ind',
  en: 'eng',
  ja: 'jpn',
  ko: 'kor',
  zh: 'zho',
  ar: 'ara',
  es: 'spa',
  fr: 'fra',
  de: 'deu',
};

export function normalizeSubtitleRenderMode(raw: unknown): SubtitleRenderMode {
  if (raw === 'softsub' || raw === 'dubbing_only' || raw === 'hardsub') {
    return raw;
  }
  return 'hardsub';
}

export function mapLangToIso639_2(lang: string): string {
  const key = (lang || '').trim().toLowerCase();
  return ISO_639_2_MAP[key] ?? 'und';
}

export function getMp4DownloadFilename(
  videoName: string,
  subtitleMode: SubtitleRenderMode
): string {
  const baseName = (videoName || 'voxdub').replace(/\.[^.]+$/, '') || 'voxdub';
  switch (subtitleMode) {
    case 'softsub':
      return `${baseName}_dubbing_softsub.mp4`;
    case 'dubbing_only':
      return `${baseName}_dubbing_only.mp4`;
    case 'hardsub':
    default:
      return `${baseName}_dubbing_hardsub.mp4`;
  }
}

export interface FfmpegRenderArgsInput {
  mediaFilePath?: string;
  hasVideoStream: boolean;
  hasMediaAudioStream: boolean;
  dubAudioFilePath?: string;
  audioMixMode: RenderAudioMixMode;
  subtitleMode: SubtitleRenderMode;
  hasAssFile: boolean;
  srtFilePath?: string;
  subtitleLanguageIso?: string;
  durationSeconds: number;
  outputPath: string;
}

export function buildFfmpegRenderArgs(input: FfmpegRenderArgsInput): string[] {
  const safeDuration = Math.min(
    3600,
    Math.max(1, Number.isFinite(input.durationSeconds) ? input.durationSeconds : 15)
  );
  const args: string[] = ['-y'];

  let nextInputIdx = 0;
  let videoIdx = 0;
  let audioIdx = -1;
  let dubMixIdx = -1;
  let subIdx = -1;

  if (input.mediaFilePath && input.hasVideoStream) {
    args.push('-i', input.mediaFilePath);
    videoIdx = nextInputIdx++;
  } else {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `color=c=#0B0D14:s=1280x720:r=24:d=${safeDuration.toFixed(2)}`
    );
    videoIdx = nextInputIdx++;
  }

  const useBgMix =
    Boolean(input.mediaFilePath) &&
    input.hasVideoStream &&
    Boolean(input.dubAudioFilePath) &&
    input.audioMixMode === 'dubbed_with_bg' &&
    input.hasMediaAudioStream;

  if (useBgMix && input.dubAudioFilePath) {
    args.push('-i', input.dubAudioFilePath);
    dubMixIdx = nextInputIdx++;
  } else if (input.dubAudioFilePath && input.audioMixMode !== 'original') {
    args.push('-i', input.dubAudioFilePath);
    audioIdx = nextInputIdx++;
  } else if (input.mediaFilePath && input.hasMediaAudioStream) {
    if (input.hasVideoStream) {
      audioIdx = videoIdx;
    } else {
      args.push('-i', input.mediaFilePath);
      audioIdx = nextInputIdx++;
    }
  } else {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=44100:cl=stereo:d=${safeDuration.toFixed(2)}`
    );
    audioIdx = nextInputIdx++;
  }

  if (input.subtitleMode === 'softsub' && input.srtFilePath) {
    args.push('-sub_charenc', 'UTF-8', '-i', input.srtFilePath);
    subIdx = nextInputIdx++;
  }

  const shouldBurnAss = input.subtitleMode === 'hardsub' && input.hasAssFile;
  const vfChain = [
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    ...(shouldBurnAss ? ['ass=subtitles.ass'] : []),
  ].join(',');

  if (useBgMix && dubMixIdx >= 0) {
    args.push(
      '-filter_complex',
      `[${videoIdx}:v]${vfChain}[vout];[${videoIdx}:a]volume=0.15[orig];[${dubMixIdx}:a]volume=1.0[dub];[orig][dub]amix=inputs=2:duration=longest:dropout_transition=2[aout]`,
      '-map',
      '[vout]',
      '-map',
      '[aout]'
    );
  } else {
    args.push(
      '-vf',
      vfChain,
      '-map',
      `${videoIdx}:v:0`,
      '-map',
      `${audioIdx}:a:0`
    );
  }

  if (subIdx >= 0) {
    const langIso = (input.subtitleLanguageIso || 'und').trim() || 'und';
    args.push(
      '-map',
      `${subIdx}:s:0`,
      '-c:s',
      'mov_text',
      '-metadata:s:s:0',
      `language=${langIso}`,
      '-disposition:s:0',
      'default'
    );
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    '-movflags',
    '+faststart'
  );

  // Avoid -shortest when muxing a subtitle stream, otherwise FFmpeg stops at the last subtitle cue timestamp.
  if (subIdx >= 0) {
    args.push('-t', safeDuration.toFixed(3));
  } else {
    args.push('-shortest');
  }

  args.push(input.outputPath);
  return args;
}
