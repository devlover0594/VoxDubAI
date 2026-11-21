import type { DubSegment } from '../types/dubbing';
import { createSynthesizedDemoWavUrl } from '../utils/audioMixer';
import {
  parseTimestampToSeconds,
  syncWordsWithText,
} from '../utils/subtitleUtils';

export const DEMO_VIDEO_DURATION = 16.0;
export const DEMO_VIDEO_TITLE = 'Future_of_Acoustic_AI_Sample.mp4';

export interface DemoSceneFrame {
  startSec: number;
  endSec: number;
  speaker: string;
  sceneLabel: string;
  accentHue: string;
}

export const DEMO_SCENE_FRAMES: DemoSceneFrame[] = [
  {
    startSec: 0,
    endSec: 4.2,
    speaker: 'Dr. Elena Vance',
    sceneLabel: 'Bab 01 · Pengantar Akustik Neural',
    accentHue: '#6366F1',
  },
  {
    startSec: 4.2,
    endSec: 8.5,
    speaker: 'Dr. Elena Vance',
    sceneLabel: 'Bab 02 · Sinkronisasi Ritme Bicara',
    accentHue: '#8B5CF6',
  },
  {
    startSec: 8.5,
    endSec: 12.6,
    speaker: 'Dr. Elena Vance',
    sceneLabel: 'Bab 03 · Adaptasi Lintas Bahasa',
    accentHue: '#4F46E5',
  },
  {
    startSec: 12.6,
    endSec: 16.0,
    speaker: 'Dr. Elena Vance',
    sceneLabel: 'Bab 04 · Produksi Studio Global',
    accentHue: '#7C3AED',
  },
];

export function createDemoSegments(): DubSegment[] {
  const raw: Omit<DubSegment, 'audioUrl' | 'audioDuration' | 'words'>[] = [
    {
      id: 1,
      startTime: '00:00:00.800',
      endTime: '00:00:04.000',
      originalText: 'Modern acoustic models can now capture subtle human emotion across languages.',
      translatedText: 'Model akustik modern kini mampu menangkap emosi manusia lintas bahasa.',
    },
    {
      id: 2,
      startTime: '00:00:04.400',
      endTime: '00:00:08.100',
      originalText: 'By matching syllable pacing to each video frame, dubbing feels natural.',
      translatedText: 'Dengan menyelaraskan ritme suku kata pada video, sulih suara terasa alami.',
    },
    {
      id: 3,
      startTime: '00:00:08.500',
      endTime: '00:00:12.200',
      originalText: 'Creators can localize documentaries and courses in minutes instead of weeks.',
      translatedText: 'Kreator dapat melokalkan dokumenter dan kursus dalam hitungan menit saja.',
    },
    {
      id: 4,
      startTime: '00:00:12.600',
      endTime: '00:00:15.600',
      originalText: 'Welcome to a new era of borderless storytelling.',
      translatedText: 'Selamat datang di era baru bercerita tanpa batas bahasa.',
    },
  ];

  const baseFreqs = [196, 220, 233, 208];

  return raw.map((seg, idx) => {
    const startSec = parseTimestampToSeconds(seg.startTime);
    const endSec = parseTimestampToSeconds(seg.endTime);
    const duration = Math.max(1, endSec - startSec);
    const audioUrl = createSynthesizedDemoWavUrl(duration, baseFreqs[idx % baseFreqs.length]);
    const words = syncWordsWithText(seg.translatedText, startSec, endSec);
    return {
      ...seg,
      words,
      audioUrl,
      audioDuration: duration,
    };
  });
}
