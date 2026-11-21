import { Download, Subtitles } from 'lucide-react';
import type {
  SubtitleDynamicMode,
  SubtitleSize,
  SubtitleStyle,
} from '../types/dubbing';

interface SubtitleCustomizerProps {
  style: SubtitleStyle;
  onChange: (next: SubtitleStyle) => void;
  onDownloadSrt: () => void;
  onDownloadVtt: () => void;
  hasSegments: boolean;
}

const SIZE_OPTIONS: { value: SubtitleSize; label: string }[] = [
  { value: 'sm', label: 'Kecil' },
  { value: 'md', label: 'Sedang' },
  { value: 'lg', label: 'Besar' },
  { value: 'xl', label: 'Ekstra' },
];

const COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: '#FFFFFF', label: 'Putih' },
  { value: '#FDE047', label: 'Kuning' },
  { value: '#A5F3FC', label: 'Cyan' },
  { value: '#E0E7FF', label: 'Indigo Muda' },
];

const DYNAMIC_MODE_OPTIONS: { value: SubtitleDynamicMode; label: string }[] = [
  { value: 'classic', label: 'Klasik (Baris Penuh)' },
  { value: 'word-popup', label: 'Word-by-Word Pop-up' },
  { value: 'karaoke', label: 'Karaoke Highlight' },
];

export function SubtitleCustomizer({
  style,
  onChange,
  onDownloadSrt,
  onDownloadVtt,
  hasSegments,
}: SubtitleCustomizerProps) {
  return (
    <div className="bg-[#121520] border border-white/8 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Subtitles className="w-4 h-4 text-indigo-400 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Gaya Subtitle Dinamis &amp; Ekspor
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDownloadSrt}
            disabled={!hasSegments}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
            <span>Download Subtitle (.SRT)</span>
          </button>
          <button
            type="button"
            onClick={onDownloadVtt}
            disabled={!hasSegments}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
            <span>.VTT</span>
          </button>
        </div>
      </div>

      {/* Dynamic Caption Mode Segmented Control */}
      <div className="pt-2 border-t border-white/6 space-y-2">
        <span className="block text-xs text-slate-400">
          Gaya Subtitle Dinamis (Word-level Timestamps)
        </span>
        <div
          role="group"
          aria-label="Pilih gaya subtitle dinamis"
          className="grid grid-cols-1 sm:grid-cols-3 gap-2"
        >
          {DYNAMIC_MODE_OPTIONS.map((opt) => {
            const active = style.dynamicMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ ...style, dynamicMode: opt.value })}
                className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-indigo-600/20 border-indigo-500 text-white'
                    : 'bg-[#0B0D14] border-white/10 text-slate-300 hover:border-white/25'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
        <div>
          <label
            htmlFor="subtitle-size"
            className="block text-xs text-slate-400 mb-1.5"
          >
            Ukuran Font
          </label>
          <select
            id="subtitle-size"
            value={style.fontSize}
            onChange={(e) =>
              onChange({ ...style, fontSize: e.target.value as SubtitleSize })
            }
            className="w-full h-9 px-3 rounded-lg bg-[#0B0D14] border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
          >
            {SIZE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="subtitle-color"
            className="block text-xs text-slate-400 mb-1.5"
          >
            Warna Teks
          </label>
          <select
            id="subtitle-color"
            value={style.textColor}
            onChange={(e) => onChange({ ...style, textColor: e.target.value })}
            className="w-full h-9 px-3 rounded-lg bg-[#0B0D14] border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
          >
            {COLOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col justify-between">
          <span className="block text-xs text-slate-400 mb-1.5">
            Latar Hitam Transparan
          </span>
          <label className="inline-flex items-center gap-2.5 h-9 px-3 rounded-lg bg-[#0B0D14] border border-white/10 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={style.backgroundEnabled}
              onChange={(e) =>
                onChange({ ...style, backgroundEnabled: e.target.checked })
              }
              className="w-4 h-4 accent-indigo-500 rounded"
            />
            <span className="text-xs text-slate-200">
              {style.backgroundEnabled ? 'Aktif (75%)' : 'Nonaktif'}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
