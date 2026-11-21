import { useRef, type DragEvent } from 'react';
import {
  Film,
  Pause,
  Play,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { AudioMode, DubSegment, SubtitleStyle } from '../types/dubbing';
import { DEMO_SCENE_FRAMES, DEMO_VIDEO_TITLE } from '../data/demoProject';
import {
  formatTimecodeShort,
  getActiveWordIndex,
  getEffectiveWords,
  getWordPopupChunk,
} from '../utils/subtitleUtils';

interface VideoPreviewProps {
  videoUrl: string | null;
  videoName: string;
  isDemoMode: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  audioMode: AudioMode;
  activeSegment: DubSegment | null;
  subtitleStyle: SubtitleStyle;
  showOriginalSubtitle: boolean;
  onToggleShowOriginalSubtitle: () => void;
  onTogglePlay: () => void;
  onSeek: (timeSec: number) => void;
  onAudioModeChange: (mode: AudioMode) => void;
  onFileSelected: (file: File) => void;
  onLoadDemo: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onVideoLoadedMetadata: () => void;
  onVideoTimeUpdate: () => void;
  onVideoEnded: () => void;
}

const SIZE_CLASSES: Record<SubtitleStyle['fontSize'], string> = {
  sm: 'text-xs sm:text-sm leading-snug',
  md: 'text-xs sm:text-base leading-snug',
  lg: 'text-sm sm:text-lg md:text-xl leading-snug',
  xl: 'text-base sm:text-xl md:text-2xl leading-snug',
};

const COLOR_CLASSES: Record<string, string> = {
  '#FFFFFF': 'text-white',
  '#FDE047': 'text-yellow-300',
  '#A5F3FC': 'text-cyan-200',
  '#E0E7FF': 'text-indigo-100',
};

export function VideoPreview({
  videoUrl,
  videoName,
  isDemoMode,
  isPlaying,
  currentTime,
  duration,
  audioMode,
  activeSegment,
  subtitleStyle,
  showOriginalSubtitle,
  onToggleShowOriginalSubtitle,
  onTogglePlay,
  onSeek,
  onAudioModeChange,
  onFileSelected,
  onLoadDemo,
  videoRef,
  onVideoLoadedMetadata,
  onVideoTimeUpdate,
  onVideoEnded,
}: VideoPreviewProps) {
  const dropInputRef = useRef<HTMLInputElement>(null);

  const hasMedia = Boolean(videoUrl) || isDemoMode;
  const activeSubtitleText = activeSegment
    ? showOriginalSubtitle
      ? activeSegment.originalText
      : activeSegment.translatedText
    : '';

  const effectiveWords =
    activeSegment && !showOriginalSubtitle
      ? getEffectiveWords(activeSegment)
      : [];
  const activeWordIdx = getActiveWordIndex(effectiveWords, currentTime);
  const popupChunk = getWordPopupChunk(effectiveWords, currentTime, 3);

  const currentScene =
    DEMO_SCENE_FRAMES.find(
      (f) => currentTime >= f.startSec && currentTime < f.endSec
    ) ?? DEMO_SCENE_FRAMES[0];

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      onFileSelected(dropped);
    }
  };

  const sizeClass = SIZE_CLASSES[subtitleStyle.fontSize];
  const colorClass = COLOR_CLASSES[subtitleStyle.textColor] ?? 'text-white';
  const boxStyle = subtitleStyle.backgroundEnabled
    ? 'bg-black/75 backdrop-blur-xs shadow-lg'
    : 'drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]';

  return (
    <section
      aria-label="Area Preview Video"
      className="bg-[#121520] border border-white/8 rounded-xl overflow-hidden flex flex-col"
    >
      {/* Top Meta Strip */}
      <div className="px-4 py-2.5 border-b border-white/8 flex items-center justify-between gap-3 bg-[#0E111A]">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-4 h-4 text-indigo-400 shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium text-slate-200 truncate">
            {hasMedia ? videoName || DEMO_VIDEO_TITLE : 'Belum ada video dimuat'}
          </span>
          {isDemoMode && (
            <span className="text-xs text-indigo-300 whitespace-nowrap shrink-0">
              · Mode Demo
            </span>
          )}
        </div>

        {hasMedia && (
          <button
            type="button"
            onClick={onToggleShowOriginalSubtitle}
            className="text-xs text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 px-2 py-1 rounded hover:bg-white/5"
          >
            Teks Overlay: {showOriginalSubtitle ? 'Asli' : 'Terjemahan'}
          </button>
        )}
      </div>

      {/* Video Stage */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="relative aspect-video bg-[#07090F] flex items-center justify-center overflow-hidden"
      >
        {!hasMedia ? (
          <div className="p-6 sm:p-10 text-center max-w-md mx-auto flex flex-col items-center">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-4">
              <Upload className="w-6 h-6" aria-hidden="true" />
            </div>
            <h1 className="font-display text-lg sm:text-xl font-semibold text-white mb-2">
              Unggah Video Berbahasa Asing
            </h1>
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
              Tarik &amp; lepaskan file MP4, WebM, atau MOV di sini (maks. 80 MB) untuk membuat subtitle dan sulih suara otomatis.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => dropInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                <span>Pilih File Video</span>
              </button>
              <button
                type="button"
                onClick={onLoadDemo}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 text-slate-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                <span>Muat Proyek Demo</span>
              </button>
            </div>
            <input
              ref={dropInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-matroska,audio/*"
              className="hidden"
              aria-label="Pilih file video dari komputer"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFileSelected(f);
                e.target.value = '';
              }}
            />
          </div>
        ) : videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            muted={audioMode === 'dubbed'}
            onLoadedMetadata={onVideoLoadedMetadata}
            onTimeUpdate={onVideoTimeUpdate}
            onEnded={onVideoEnded}
            onClick={onTogglePlay}
            className="w-full h-full object-contain bg-black cursor-pointer"
          />
        ) : (
          <div
            onClick={onTogglePlay}
            role="button"
            tabIndex={0}
            aria-label={isPlaying ? 'Jeda preview demo' : 'Putar preview demo'}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                onTogglePlay();
              }
            }}
            data-testid="demo-video-stage"
            className="w-full h-full relative cursor-pointer select-none flex flex-col justify-between p-3 sm:p-6 pb-12 sm:pb-16 bg-gradient-to-br from-[#0F1322] via-[#13182B] to-[#0B0D14]"
          >
            <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs text-slate-400">
              <span className="truncate">{currentScene.sceneLabel}</span>
              <span className="font-mono tabular-nums text-slate-300 shrink-0">
                {formatTimecodeShort(currentTime)} / {formatTimecodeShort(duration)}
              </span>
            </div>

            <div className="my-auto flex flex-col items-center justify-center text-center gap-2 sm:gap-4">
              <div className="flex items-end gap-1 sm:gap-1.5 h-7 sm:h-11" aria-hidden="true">
                {[0.45, 0.85, 0.6, 1.0, 0.72, 0.9, 0.5, 0.78, 0.4].map(
                  (bar, idx) => {
                    const dynamicScale = isPlaying
                      ? 0.35 + Math.abs(Math.sin(currentTime * 5 + idx * 0.9)) * 0.65
                      : bar * 0.45;
                    return (
                      <span
                        key={idx}
                        className="w-1 sm:w-1.5 rounded-full bg-indigo-400/80 transition-transform duration-150 origin-bottom"
                        style={{
                          height: '100%',
                          transform: `scaleY(${dynamicScale.toFixed(2)})`,
                        }}
                      />
                    );
                  }
                )}
              </div>
              <div>
                <p className="font-display text-sm sm:text-lg font-semibold text-white">
                  {currentScene.speaker}
                </p>
                <p className="hidden sm:block text-xs text-slate-400 mt-1">
                  {audioMode === 'dubbed'
                    ? 'Memutar jalur suara Dubbing AI tersinkronisasi'
                    : 'Memutar jalur suara asli pembicara'}
                </p>
              </div>
            </div>

            <div className="h-4 sm:h-8" />
          </div>
        )}

        {/* Real-time Subtitle Overlay with Dynamic Modes */}
        {hasMedia && activeSubtitleText && (
          <div
            data-testid="subtitle-overlay"
            data-dynamic-mode={subtitleStyle.dynamicMode}
            className="pointer-events-none absolute inset-x-3 sm:inset-x-4 bottom-2.5 sm:bottom-5 flex justify-center"
          >
            {subtitleStyle.dynamicMode === 'word-popup' &&
            !showOriginalSubtitle &&
            popupChunk.words.length > 0 ? (
              <div
                className={`max-w-[94%] sm:max-w-[90%] flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl ${boxStyle}`}
              >
                {popupChunk.words.map((w, idx) => {
                  const isCurrent = idx === popupChunk.activeLocalIndex;
                  return (
                    <span
                      key={`${w.word}-${w.start}-${idx}`}
                      className={`inline-block transition-transform duration-150 ${sizeClass} ${
                        isCurrent
                          ? 'scale-110 font-bold text-yellow-300 px-1.5 py-0.5 rounded bg-indigo-600/70'
                          : `${colorClass} opacity-80`
                      }`}
                    >
                      {w.word}
                    </span>
                  );
                })}
              </div>
            ) : subtitleStyle.dynamicMode === 'karaoke' &&
              !showOriginalSubtitle &&
              effectiveWords.length > 0 ? (
              <p
                className={`max-w-[94%] sm:max-w-[90%] text-center font-medium px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg flex flex-wrap justify-center gap-x-1.5 gap-y-0.5 ${sizeClass} ${boxStyle}`}
              >
                {effectiveWords.map((w, idx) => {
                  const isActive = idx === activeWordIdx;
                  const isSpoken = currentTime >= w.start;
                  return (
                    <span
                      key={`${w.word}-${w.start}-${idx}`}
                      className={`inline-block transition-all duration-150 ${
                        isActive
                          ? 'text-yellow-300 font-bold scale-105 underline decoration-indigo-400 decoration-2 underline-offset-4'
                          : isSpoken
                          ? `${colorClass} opacity-100`
                          : `${colorClass} opacity-45`
                      }`}
                    >
                      {w.word}
                    </span>
                  );
                })}
              </p>
            ) : (
              <p
                className={`max-w-[94%] sm:max-w-[90%] text-center font-medium px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-lg transition-opacity duration-150 ${sizeClass} ${colorClass} ${boxStyle}`}
              >
                {activeSubtitleText}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Player Controls Bar */}
      <div className="px-4 py-3 bg-[#0E111A] border-t border-white/8 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!hasMedia}
            aria-label={isPlaying ? 'Jeda video' : 'Putar video'}
            className="w-9 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shrink-0"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" aria-hidden="true" />
            )}
          </button>

          <span className="font-mono text-xs tabular-nums text-slate-300 whitespace-nowrap shrink-0">
            {formatTimecodeShort(currentTime)} / {formatTimecodeShort(duration)}
          </span>

          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.05}
            value={Math.min(currentTime, Math.max(duration, 0.1))}
            disabled={!hasMedia}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="Garis waktu pemutaran video"
            className="w-full h-1.5 accent-indigo-500 bg-slate-800 rounded-lg cursor-pointer disabled:opacity-40"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="text-xs text-slate-400">Sumber Audio Preview</span>

          <div
            role="group"
            aria-label="Pilih mode audio"
            className="inline-flex items-center p-1 rounded-lg bg-[#0B0D14] border border-white/8"
          >
            <button
              type="button"
              onClick={() => onAudioModeChange('original')}
              aria-pressed={audioMode === 'original'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                audioMode === 'original'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {audioMode === 'dubbed' ? (
                <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Suara Asli</span>
            </button>

            <button
              type="button"
              onClick={() => onAudioModeChange('dubbed')}
              aria-pressed={audioMode === 'dubbed'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                audioMode === 'dubbed'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Suara Dubbing AI</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
