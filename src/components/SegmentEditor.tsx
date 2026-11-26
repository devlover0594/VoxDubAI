import {
  Clock,
  Cpu,
  Download,
  Film,
  Loader2,
  Plus,
  RefreshCw,
  SpellCheck,
  Trash2,
  Volume2,
  Wand2,
} from 'lucide-react';
import type { RenderAudioMixMode } from '../utils/mp4ClientRenderer';
import {
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  VOICE_STYLE_OPTIONS,
  type DubSegment,
  type SubtitleRenderMode,
  type VoiceStyle,
} from '../types/dubbing';
import {
  getActiveWordIndex,
  getEffectiveWords,
  getSegmentDurationSeconds,
  parseTimestampToSeconds,
  validateSegmentTiming,
} from '../utils/subtitleUtils';

interface SegmentEditorProps {
  sourceLanguage: string;
  targetLanguage: string;
  voiceStyle: VoiceStyle;
  segments: DubSegment[];
  activeSegmentId: number | null;
  currentTime: number;
  hasUploadedFile: boolean;
  isBusy: boolean;
  isExportingAudio: boolean;
  isRenderingMp4: boolean;
  renderProgress: { percent: number; detail: string } | null;
  mp4AudioMixMode: RenderAudioMixMode;
  onMp4AudioMixModeChange: (mode: RenderAudioMixMode) => void;
  subtitleMode: SubtitleRenderMode;
  onSubtitleModeChange: (mode: SubtitleRenderMode) => void;
  onSourceLanguageChange: (val: string) => void;
  onTargetLanguageChange: (val: string) => void;
  onVoiceStyleChange: (val: VoiceStyle) => void;
  onProcessVideo: () => void;
  onGenerateAllDubbing: () => void;
  onExportBundle: () => void;
  onDownloadMp4: () => void;
  onSegmentChange: (id: number, patch: Partial<DubSegment>) => void;
  onSeekToSegment: (startTime: string | number) => void;
  onAutoFixGrammar: (id: number) => void;
  onRegenerateSegmentAudio: (id: number) => void;
  onPlaySingleSegment: (seg: DubSegment) => void;
  onAddSegment: () => void;
  onDeleteSegment: (id: number) => void;
  analysisProviderLabel: string;
  analysisModelLabel: string;
  analysisFallbackCount?: number;
  ttsProviderLabel: string;
  ttsModelLabel: string;
  ttsFallbackCount?: number;
  autoContinueTts: boolean;
  onAutoContinueTtsChange: (val: boolean) => void;
  isAnalyzing: boolean;
  isDubbing: boolean;
  onOpenAiSettings: () => void;
}

export function SegmentEditor({
  sourceLanguage,
  targetLanguage,
  voiceStyle,
  segments,
  activeSegmentId,
  currentTime,
  hasUploadedFile,
  isBusy,
  isExportingAudio,
  isRenderingMp4,
  renderProgress,
  mp4AudioMixMode,
  onMp4AudioMixModeChange,
  subtitleMode,
  onSubtitleModeChange,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onVoiceStyleChange,
  onProcessVideo,
  onGenerateAllDubbing,
  onExportBundle,
  onDownloadMp4,
  onSegmentChange,
  onSeekToSegment,
  onAutoFixGrammar,
  onRegenerateSegmentAudio,
  onPlaySingleSegment,
  onAddSegment,
  onDeleteSegment,
  analysisProviderLabel,
  analysisModelLabel,
  analysisFallbackCount = 0,
  ttsProviderLabel,
  ttsModelLabel,
  ttsFallbackCount = 0,
  autoContinueTts,
  onAutoContinueTtsChange,
  isAnalyzing,
  isDubbing,
  onOpenAiSettings,
}: SegmentEditorProps) {
  const readyAudioCount = segments.filter((s) =>
    Boolean(s.audioUrl || s.useBrowserSpeech)
  ).length;

  return (
    <section
      aria-label="Panel Editor dan Kontrol Dubbing"
      className="bg-[#121520] border border-white/8 rounded-xl flex flex-col overflow-hidden"
    >
      {/* Configuration Header */}
      <div className="p-4 sm:p-5 border-b border-white/8 space-y-5 bg-[#0E111A]">
        <div className="flex flex-wrap items-start justify-between gap-2.5 pb-3 border-b border-white/8">
          <div className="min-w-0 space-y-1">
            <div className="text-[11px] font-medium text-slate-400">
              Dual-Role Smart Auto-Routing
            </div>
            <div className="text-xs text-slate-200 truncate">
              <span className="text-indigo-300 font-semibold">Analisis:</span>{' '}
              <span>{analysisProviderLabel}</span>{' '}
              <span className="text-slate-500">·</span>{' '}
              <span className="font-mono text-indigo-200">{analysisModelLabel}</span>
              {analysisFallbackCount > 0 && (
                <span className="ml-1.5 text-[11px] text-amber-300">
                  (+{analysisFallbackCount} fallback)
                </span>
              )}
            </div>
            <div className="text-xs text-slate-200 truncate">
              <span className="text-emerald-300 font-semibold">TTS:</span>{' '}
              <span>{ttsProviderLabel}</span>{' '}
              <span className="text-slate-500">·</span>{' '}
              <span className="font-mono text-emerald-200">{ttsModelLabel}</span>
              {ttsFallbackCount > 0 && (
                <span className="ml-1.5 text-[11px] text-amber-300">
                  (+{ttsFallbackCount} fallback)
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenAiSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-indigo-400/25 text-xs font-medium text-indigo-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Cpu className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
            <span>Atur Routing AI</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label
              htmlFor="source-lang"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Bahasa Sumber
            </label>
            <select
              id="source-lang"
              value={sourceLanguage}
              disabled={isBusy}
              onChange={(e) => onSourceLanguageChange(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            >
              {SOURCE_LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="target-lang"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Bahasa Target
            </label>
            <select
              id="target-lang"
              value={targetLanguage}
              disabled={isBusy}
              onChange={(e) => onTargetLanguageChange(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            >
              {TARGET_LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-300 mb-2">
            Gaya Suara Dubbing AI
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {VOICE_STYLE_OPTIONS.map((opt) => {
              const selected = voiceStyle === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isBusy}
                  aria-pressed={selected}
                  onClick={() => onVoiceStyleChange(opt.id)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    selected
                      ? 'bg-indigo-600/18 border-indigo-500 text-white'
                      : 'bg-[#0B0D14] border-white/8 text-slate-300 hover:border-white/20'
                  }`}
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    {opt.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 pt-1">
          {/* Separated Stage 1 (Analysis) vs Stage 2 (Dubbing TTS) */}
          <div className="flex flex-wrap items-center gap-2">
            {hasUploadedFile && (
              <button
                type="button"
                onClick={onProcessVideo}
                disabled={isBusy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>
                  {isAnalyzing
                    ? 'Menganalisis Video...'
                    : segments.length > 0
                    ? 'Analisis & Transkrip Ulang'
                    : 'Analisis & Transkrip Video'}
                </span>
              </button>
            )}

            {(segments.length > 0 || hasUploadedFile) && (
              <button
                type="button"
                onClick={onGenerateAllDubbing}
                disabled={isBusy || segments.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                {isDubbing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>
                  {isDubbing ? 'Membuat Dubbing TTS...' : 'Generate Dubbing AI (TTS)'}
                </span>
              </button>
            )}
          </div>

          {hasUploadedFile && (
            <label className="inline-flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoContinueTts}
                disabled={isBusy}
                onChange={(e) => onAutoContinueTtsChange(e.target.checked)}
                className="rounded border-white/20 bg-[#0B0D14] text-indigo-500 focus:ring-indigo-500"
              />
              <span>Otomatis lanjut ke Dubbing TTS setelah analisis selesai</span>
            </label>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-white/6">
            <div className="flex flex-wrap items-center gap-2">
            {hasUploadedFile && (
              <select
                aria-label="Mode audio render MP4"
                value={mp4AudioMixMode}
                disabled={isRenderingMp4 || segments.length === 0}
                onChange={(e) =>
                  onMp4AudioMixModeChange(e.target.value as RenderAudioMixMode)
                }
                className="h-9 px-2.5 rounded-lg bg-[#0B0D14] border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                <option value="dubbed_only">Voice-Over Penuh</option>
                <option value="dubbed_with_bg">Voice-Over + 15% Audio Asli</option>
                <option value="original">Audio Asli Saja</option>
              </select>
            )}

            <select
              aria-label="Mode subtitle render MP4"
              value={subtitleMode}
              disabled={isRenderingMp4 || segments.length === 0}
              onChange={(e) =>
                onSubtitleModeChange(e.target.value as SubtitleRenderMode)
              }
              className="h-9 px-2.5 rounded-lg bg-[#0B0D14] border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            >
              <option value="hardsub">Hard Sub (Permanen)</option>
              <option value="softsub">Soft Sub (Trek MP4)</option>
              <option value="dubbing_only">Dubbing Only (Tanpa Sub)</option>
            </select>

            <button
              type="button"
              onClick={onDownloadMp4}
              disabled={segments.length === 0 || isRenderingMp4 || isBusy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              {isRenderingMp4 ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Film className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{isRenderingMp4 ? 'Merender MP4...' : 'Download Video (.MP4)'}</span>
            </button>

            <button
              type="button"
              onClick={onExportBundle}
              disabled={segments.length === 0 || isExportingAudio}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              {isExportingAudio ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Export Audio + SRT</span>
            </button>
          </div>
          </div>
        </div>

        {isRenderingMp4 && renderProgress && (
          <div className="p-3 rounded-lg bg-[#0B0D14] border border-indigo-500/30 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-indigo-200 font-medium truncate">
                {renderProgress.detail}
              </span>
              <span className="font-mono tabular-nums text-indigo-300 shrink-0">
                {renderProgress.percent}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-200"
                style={{ width: `${Math.max(4, Math.min(100, renderProgress.percent))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Segment List Header */}
      <div className="px-4 sm:px-5 py-3 border-b border-white/8 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-white">
            Daftar Segmen Transkrip &amp; Terjemahan
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
            {segments.length} segmen · {readyAudioCount} audio dubbing siap
          </p>
        </div>

        <button
          type="button"
          onClick={onAddSegment}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
          <span>Tambah Segmen</span>
        </button>
      </div>

      {/* Segment Rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/8 max-h-[680px]">
        {segments.length === 0 ? (
          <div className="p-8 sm:p-10 text-center">
            <p className="text-sm text-slate-300 font-medium">
              Belum ada segmen transkrip
            </p>
            <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto">
              Unggah video untuk menghasilkan transkrip, word-level timestamps, dan sulih suara otomatis, atau muat proyek demo.
            </p>
          </div>
        ) : (
          segments.map((seg, index) => {
            const isActive = activeSegmentId === seg.id;
            const timingValid = validateSegmentTiming(seg.startTime, seg.endTime);
            const segDuration = getSegmentDurationSeconds(seg);
            const words = getEffectiveWords(seg);
            const activeWordIdx = isActive
              ? getActiveWordIndex(words, currentTime)
              : -1;

            return (
              <article
                key={seg.id}
                data-testid={`segment-row-${seg.id}`}
                className={`p-4 space-y-3 transition-colors ${
                  isActive ? 'bg-indigo-500/8' : 'hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSeekToSegment(seg.startTime)}
                      aria-label={`Lompat ke segmen ${index + 1} pada ${seg.startTime}`}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono tabular-nums transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'bg-[#1A1E2E] text-slate-300 hover:text-white'
                      }`}
                    >
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      <span>#{index + 1}</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <label className="sr-only" htmlFor={`start-${seg.id}`}>
                        Waktu mulai segmen {index + 1}
                      </label>
                      <input
                        id={`start-${seg.id}`}
                        type="text"
                        value={seg.startTime}
                        onChange={(e) =>
                          onSegmentChange(seg.id, { startTime: e.target.value })
                        }
                        className="w-24 h-8 px-2 rounded bg-[#0B0D14] border border-white/10 font-mono text-xs tabular-nums text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                      <span className="text-xs text-slate-500">-</span>
                      <label className="sr-only" htmlFor={`end-${seg.id}`}>
                        Waktu selesai segmen {index + 1}
                      </label>
                      <input
                        id={`end-${seg.id}`}
                        type="text"
                        value={seg.endTime}
                        onChange={(e) =>
                          onSegmentChange(seg.id, { endTime: e.target.value })
                        }
                        className="w-24 h-8 px-2 rounded bg-[#0B0D14] border border-white/10 font-mono text-xs tabular-nums text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <span className="font-mono text-[11px] tabular-nums text-slate-400">
                      {timingValid
                        ? `${segDuration.toFixed(1)}d`
                        : 'Waktu tidak valid'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {(seg.audioUrl || seg.useBrowserSpeech) && (
                      <button
                        type="button"
                        onClick={() => onPlaySingleSegment(seg)}
                        aria-label={`Putar klip dubbing segmen ${index + 1}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 text-xs text-slate-200 transition-colors"
                      >
                        <Volume2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                        <span>Dengar</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onRegenerateSegmentAudio(seg.id)}
                      disabled={seg.isGeneratingAudio || !seg.translatedText.trim()}
                      aria-label={`Regenerate Audio segmen ${index + 1}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-indigo-200 transition-colors whitespace-nowrap"
                    >
                      {seg.isGeneratingAudio ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                      )}
                      <span>
                        {seg.audioQueueStatus === 'queued'
                          ? 'Dalam Antrian...'
                          : seg.audioQueueStatus === 'retrying'
                          ? `Ulang (${seg.audioRetryAttempt ?? 2}/${seg.audioMaxRetries ?? 5})`
                          : seg.isGeneratingAudio
                          ? 'Memproses...'
                          : 'Regenerate Audio'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteSegment(seg.id)}
                      aria-label={`Hapus segmen ${index + 1}`}
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  <div>
                    <label
                      htmlFor={`orig-${seg.id}`}
                      className="block text-[11px] font-medium text-slate-400 mb-1"
                    >
                      Teks Asli (Transkrip)
                    </label>
                    <textarea
                      id={`orig-${seg.id}`}
                      rows={2}
                      value={seg.originalText}
                      onChange={(e) =>
                        onSegmentChange(seg.id, { originalText: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-white/10 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 resize-y"
                    />
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label
                        htmlFor={`trans-${seg.id}`}
                        className="block text-[11px] font-medium text-indigo-300"
                      >
                        Teks Terjemahan (Dubbing &amp; Subtitle)
                      </label>
                      <div className="flex items-center gap-2">
                        {seg.audioDuration ? (
                          <span className="font-mono text-[11px] tabular-nums text-slate-400">
                            Durasi audio: {seg.audioDuration.toFixed(1)}d
                            {seg.useBrowserSpeech && ' · Web Speech'}
                            {parseTimestampToSeconds(seg.endTime) -
                              parseTimestampToSeconds(seg.startTime) <
                              seg.audioDuration && ' (otomatis dipercepat)'}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onAutoFixGrammar(seg.id)}
                          disabled={seg.isFixingGrammar || !seg.translatedText.trim()}
                          aria-label={`Auto-Fix Grammar segmen ${index + 1}`}
                          title="Perbaiki ejaan dan tata bahasa menggunakan AI Provider aktif tanpa mengubah timestamp"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1A1E2E] hover:bg-[#23283D] border border-indigo-400/25 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-medium text-indigo-200 transition-colors whitespace-nowrap"
                        >
                          {seg.isFixingGrammar ? (
                            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <SpellCheck className="w-3 h-3 text-indigo-400" aria-hidden="true" />
                          )}
                          <span>Auto-Fix Grammar</span>
                        </button>
                      </div>
                    </div>
                    <textarea
                      id={`trans-${seg.id}`}
                      rows={2}
                      value={seg.translatedText}
                      onChange={(e) =>
                        onSegmentChange(seg.id, { translatedText: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-indigo-500/25 text-sm text-white focus:outline-none focus:border-indigo-400 resize-y"
                    />
                  </div>
                </div>

                {/* Word-level Timestamps Strip */}
                {words.length > 0 && (
                  <div className="pt-1">
                    <div className="text-[11px] text-slate-400 mb-1.5 tabular-nums">
                      Word-level Timestamps ({words.length} kata)
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {words.map((w, wIdx) => {
                        const isWordActive = isActive && wIdx === activeWordIdx;
                        return (
                          <button
                            key={`${w.word}-${w.start}-${wIdx}`}
                            type="button"
                            onClick={() => onSeekToSegment(w.start)}
                            title={`${w.start.toFixed(2)}s - ${w.end.toFixed(2)}s`}
                            className={`px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums transition-colors ${
                              isWordActive
                                ? 'bg-indigo-600 text-white'
                                : 'bg-[#0B0D14] border border-white/8 text-slate-300 hover:border-indigo-400/50'
                            }`}
                          >
                            {w.word}{' '}
                            <span className="text-[10px] text-slate-400">
                              {w.start.toFixed(1)}s
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {seg.audioQueueStatus === 'retrying' && (
                  <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-md px-2.5 py-1.5">
                    Antrian TTS menunggu jeda trafik — mencoba ulang otomatis (percobaan{' '}
                    {seg.audioRetryAttempt ?? 2} dari {seg.audioMaxRetries ?? 5})...
                  </p>
                )}

                {seg.audioQueueStatus === 'queued' && (
                  <p className="text-xs text-indigo-200 bg-indigo-500/10 border border-indigo-500/25 rounded-md px-2.5 py-1.5">
                    Menunggu antrian generasi suara TTS agar tidak terkena rate limit...
                  </p>
                )}

                {seg.grammarError && (
                  <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-md px-2.5 py-1.5">
                    {seg.grammarError}
                  </p>
                )}

                {seg.ttsUsedFallback && seg.ttsUsedProvider && (
                  <p className="text-[11px] text-amber-300/90">
                    Auto-Fallback TTS aktif: {seg.ttsUsedProvider}
                    {seg.ttsUsedModel ? ` · ${seg.ttsUsedModel}` : ''}
                  </p>
                )}

                {seg.audioError && (
                  <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-md px-2.5 py-1.5">
                    {seg.audioError}
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
