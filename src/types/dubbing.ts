export type VoiceStyle = 'male_pro' | 'female_friendly' | 'narrator_casual';

export type AudioMode = 'original' | 'dubbed';

export type ProcessingStage =
  | 'idle'
  | 'uploading'
  | 'analyzing'
  | 'dubbing'
  | 'completed'
  | 'error';

export type SubtitleSize = 'sm' | 'md' | 'lg' | 'xl';

export type SubtitleDynamicMode = 'classic' | 'word-popup' | 'karaoke';

export interface SubtitleStyle {
  fontSize: SubtitleSize;
  textColor: string;
  backgroundEnabled: boolean;
  backgroundOpacity: number;
  dynamicMode: SubtitleDynamicMode;
}

export interface WordTimestamp {
  word: string;
  start: number; // seconds
  end: number;   // seconds
}

export interface DubSegment {
  id: number;
  startTime: string; // "HH:MM:SS.mmm"
  endTime: string;   // "HH:MM:SS.mmm"
  originalText: string;
  translatedText: string;
  words?: WordTimestamp[];
  audioUrl?: string;
  audioDuration?: number;
  isGeneratingAudio?: boolean;
  audioError?: string;
  isFixingGrammar?: boolean;
  grammarError?: string;
}

export interface SavedDubbingProject {
  id: string;
  ownerId: string;
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  voiceStyle: VoiceStyle;
  durationSeconds: number;
  subtitleStyle: SubtitleStyle;
  segments: DubSegment[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ApiHealthStatus {
  checked: boolean;
  apiKeyConfigured: boolean;
  message: string;
}

export interface LanguageOption {
  value: string;
  label: string;
}

export const SOURCE_LANGUAGES: LanguageOption[] = [
  { value: 'auto', label: 'Auto-Detect (Otomatis)' },
  { value: 'en', label: 'Inggris (English)' },
  { value: 'ja', label: 'Jepang (日本語)' },
  { value: 'ko', label: 'Korea (한국어)' },
  { value: 'zh', label: 'Mandarin (中文)' },
  { value: 'ar', label: 'Arab (العربية)' },
  { value: 'es', label: 'Spanyol (Español)' },
  { value: 'fr', label: 'Prancis (Français)' },
  { value: 'de', label: 'Jerman (Deutsch)' },
];

export const TARGET_LANGUAGES: LanguageOption[] = [
  { value: 'id', label: 'Indonesia (Bahasa Indonesia)' },
  { value: 'en', label: 'Inggris (English)' },
  { value: 'ja', label: 'Jepang (日本語)' },
  { value: 'ko', label: 'Korea (한국어)' },
  { value: 'zh', label: 'Mandarin (中文)' },
  { value: 'ar', label: 'Arab (العربية)' },
  { value: 'es', label: 'Spanyol (Español)' },
];

export interface VoiceStyleOption {
  id: VoiceStyle;
  label: string;
  description: string;
  voiceName: 'Charon' | 'Kore' | 'Puck';
}

export const VOICE_STYLE_OPTIONS: VoiceStyleOption[] = [
  {
    id: 'male_pro',
    label: 'Pria Profesional',
    description: 'Tegas, jernih, cocok untuk dokumenter & bisnis',
    voiceName: 'Charon',
  },
  {
    id: 'female_friendly',
    label: 'Wanita Ramah',
    description: 'Hangat, ekspresif, cocok untuk edukasi & vlog',
    voiceName: 'Kore',
  },
  {
    id: 'narrator_casual',
    label: 'Narator Santai',
    description: 'Natural, komunikatif, cocok untuk ulasan & cerita',
    voiceName: 'Puck',
  },
];
