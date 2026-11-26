export type VoiceStyle = 'male_pro' | 'female_friendly' | 'narrator_casual';

export type AudioMode = 'original' | 'dubbed';

export type ProcessingStage =
  | 'idle'
  | 'uploading'
  | 'analyzing'
  | 'analyzed'
  | 'dubbing'
  | 'completed'
  | 'error';

export type SubtitleSize = 'sm' | 'md' | 'lg' | 'xl';

export type SubtitleDynamicMode = 'classic' | 'word-popup' | 'karaoke';

export type SubtitleRenderMode = 'hardsub' | 'softsub' | 'dubbing_only';

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
  useBrowserSpeech?: boolean;
  audioQueueStatus?: 'queued' | 'processing' | 'retrying' | 'done' | 'error';
  audioRetryAttempt?: number;
  audioMaxRetries?: number;
  ttsUsedProvider?: string;
  ttsUsedModel?: string;
  ttsUsedFallback?: boolean;
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

export type AiProviderId =
  | 'gemini_server'
  | 'gemini_custom'
  | 'openai'
  | 'openrouter'
  | 'groq'
  | 'anthropic'
  | 'custom_openai';

export const AUTO_MODEL_ID = 'auto';

export type TtsRoutingMode = 'same' | 'custom_tts';

export interface AiModelOption {
  id: string;
  label: string;
}

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultTtsModel: string | null;
  supportsNativeTts: boolean;
  requiresKey: boolean;
  description: string;
}

export interface AiFallbackTarget {
  id: string;
  provider: AiProviderId;
  baseUrl: string;
  apiKey: string;
  model: string; // 'auto' or explicit model id
}

export interface AiProviderConfig {
  provider: AiProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  availableModels: AiModelOption[];
  // Dual-role fields
  analyzeModel: string; // 'auto' or explicit model id
  ttsMode: TtsRoutingMode;
  ttsProvider: AiProviderId;
  ttsBaseUrl: string;
  ttsApiKey: string;
  ttsModel: string; // 'auto' or explicit TTS model id
  ttsAvailableModels: AiModelOption[];
  // Auto-fallback chains (multi API key / multi provider)
  analysisFallbacks: AiFallbackTarget[];
  ttsFallbacks: AiFallbackTarget[];
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'gemini_server',
    label: 'VoxDub Default (Gemini Server)',
    defaultBaseUrl: '',
    defaultModel: 'gemini-2.5-flash',
    defaultTtsModel: 'gemini-3.8-flash-lite-tts',
    supportsNativeTts: true,
    requiresKey: false,
    description: 'Menggunakan Gemini API bawaan server untuk seluruh fitur video, TTS, transkripsi & grammar.',
  },
  {
    id: 'gemini_custom',
    label: 'Google Gemini (Custom Key / Endpoint)',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    defaultTtsModel: 'gemini-2.5-flash-preview-tts',
    supportsNativeTts: true,
    requiresKey: true,
    description: 'Gunakan API Key Gemini Anda sendiri atau proxy kompatibel Gemini API.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultTtsModel: 'tts-1',
    supportsNativeTts: true,
    requiresKey: true,
    description: 'Model GPT OpenAI via endpoint /v1/models, /v1/chat/completions & /v1/audio/speech.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
    defaultTtsModel: null,
    supportsNativeTts: false,
    requiresKey: true,
    description: 'Akses multi-model analisis & terjemahan melalui OpenRouter API.',
  },
  {
    id: 'groq',
    label: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultTtsModel: 'playai-tts',
    supportsNativeTts: true,
    requiresKey: true,
    description: 'Inferensi cepat OpenAI-compatible melalui Groq Cloud (Whisper + LLM + PlayAI TTS).',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5-20250929',
    defaultTtsModel: null,
    supportsNativeTts: false,
    requiresKey: true,
    description: 'Model Claude melalui Anthropic Messages API (khusus analisis, terjemahan & grammar).',
  },
  {
    id: 'custom_openai',
    label: 'Custom OpenAI-Compatible',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    defaultModel: '',
    defaultTtsModel: 'tts-1',
    supportsNativeTts: true,
    requiresKey: true,
    description: 'Endpoint kompatibel OpenAI lainnya (Together, DeepSeek, Mistral, Fireworks, Kokoro, dll).',
  },
];

export const DEFAULT_SERVER_MODELS: AiModelOption[] = [
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Multimodal Video/Audio)' },
  { id: 'gemini-4-hydrogen', label: 'gemini-4-hydrogen (Teks & Penalaran)' },
  { id: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite (Cepat)' },
];

export const DEFAULT_SERVER_TTS_MODELS: AiModelOption[] = [
  { id: 'gemini-3.8-flash-lite-tts', label: 'gemini-3.8-flash-lite-tts (TTS Cepat)' },
  { id: 'gemini-2.5-flash-preview-tts', label: 'gemini-2.5-flash-preview-tts (TTS Ekspresif)' },
];

export const DEFAULT_AI_PROVIDER_CONFIG: AiProviderConfig = {
  provider: 'gemini_server',
  baseUrl: '',
  apiKey: '',
  model: AUTO_MODEL_ID,
  availableModels: DEFAULT_SERVER_MODELS,
  analyzeModel: AUTO_MODEL_ID,
  ttsMode: 'same',
  ttsProvider: 'gemini_server',
  ttsBaseUrl: '',
  ttsApiKey: '',
  ttsModel: AUTO_MODEL_ID,
  ttsAvailableModels: DEFAULT_SERVER_TTS_MODELS,
  analysisFallbacks: [],
  ttsFallbacks: [],
};

