import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { AudioMode, DubSegment } from '../types/dubbing';
import { formatTimecodeShort } from '../utils/subtitleUtils';
import {
  buildTimelineWaveformBuckets,
  computeSegmentTimelineBands,
  extractSegmentPeakEnvelopes,
} from '../utils/waveformUtils';

interface WaveformVisualizerProps {
  segments: DubSegment[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  audioMode: AudioMode;
  activeSegment: DubSegment | null;
  hasMedia: boolean;
  onSeek: (timeSec: number) => void;
}

const BUCKET_COUNT = 120;

export function WaveformVisualizer({
  segments,
  currentTime,
  duration,
  isPlaying,
  audioMode,
  activeSegment,
  hasMedia,
  onSeek,
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [segmentPeaks, setSegmentPeaks] = useState<Map<number, number[]>>(
    () => new Map()
  );
  const [hoverInfo, setHoverInfo] = useState<{
    timeSec: number;
    xPct: number;
    segmentIndex: number | null;
  } | null>(null);

  // Extract real PCM peak envelopes whenever segment audioUrls change
  const audioSignature = useMemo(
    () => segments.map((s) => `${s.id}:${s.audioUrl || ''}:${s.startTime}-${s.endTime}`).join('|'),
    [segments]
  );

  useEffect(() => {
    let cancelled = false;
    if (segments.length === 0) {
      setSegmentPeaks(new Map());
      return;
    }

    void extractSegmentPeakEnvelopes(segments, 48).then((map) => {
      if (!cancelled) {
        setSegmentPeaks(map);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [audioSignature, segments]);

  const effectiveDuration = useMemo(() => {
    const bands = computeSegmentTimelineBands(segments, duration);
    const maxEnd = bands.reduce((acc, b) => Math.max(acc, b.endSec), 0);
    return Math.max(duration || 0, maxEnd, 1);
  }, [duration, segments]);

  const buckets = useMemo(
    () =>
      buildTimelineWaveformBuckets(
        segments,
        effectiveDuration,
        segmentPeaks,
        BUCKET_COUNT
      ),
    [effectiveDuration, segmentPeaks, segments]
  );

  const segmentBands = useMemo(
    () => computeSegmentTimelineBands(segments, effectiveDuration),
    [effectiveDuration, segments]
  );

  const progressRatio = Math.max(
    0,
    Math.min(1, currentTime / Math.max(effectiveDuration, 0.1))
  );

  // Render high-DPI canvas waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(100, rect.width);
    const cssHeight = Math.max(64, rect.height);

    if (
      canvas.width !== Math.round(cssWidth * dpr) ||
      canvas.height !== Math.round(cssHeight * dpr)
    ) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Subtle center baseline
    const centerY = cssHeight / 2;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(cssWidth, centerY);
    ctx.stroke();

    const stepX = cssWidth / buckets.length;
    const barWidth = Math.max(2, stepX * 0.62);
    const maxHalfHeight = cssHeight * 0.42;

    buckets.forEach((bucket, idx) => {
      const bucketRatio = (idx + 0.5) / buckets.length;
      const isPlayed = bucketRatio <= progressRatio;
      const isActiveSegBar =
        activeSegment !== null && bucket.segmentId === activeSegment.id;

      let dynamicBoost = 1;
      if (isPlaying && isActiveSegBar && bucket.hasAudio && audioMode === 'dubbed') {
        dynamicBoost = 0.88 + 0.24 * Math.abs(Math.sin(currentTime * 10 + idx * 0.65));
      }

      const halfH = Math.max(
        2,
        Math.min(maxHalfHeight, bucket.amplitude * maxHalfHeight * dynamicBoost)
      );
      const x = idx * stepX + (stepX - barWidth) / 2;
      const y = centerY - halfH;
      const h = halfH * 2;

      if (!bucket.hasAudio && bucket.segmentId === null) {
        ctx.fillStyle = 'rgba(71, 85, 105, 0.25)';
      } else if (!bucket.hasAudio) {
        ctx.fillStyle = isPlayed
          ? 'rgba(148, 163, 184, 0.45)'
          : 'rgba(100, 116, 139, 0.32)';
      } else if (audioMode === 'original') {
        ctx.fillStyle = isPlayed
          ? 'rgba(148, 163, 184, 0.65)'
          : 'rgba(100, 116, 139, 0.35)';
      } else if (isActiveSegBar && isPlaying) {
        ctx.fillStyle = isPlayed ? '#A5B4FC' : '#6366F1';
      } else if (isPlayed) {
        ctx.fillStyle = '#818CF8';
      } else {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.38)';
      }

      const radius = Math.min(barWidth / 2, 2);
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, h, radius);
      ctx.fill();
    });

    // Playhead vertical line
    const playheadX = Math.max(1, Math.min(cssWidth - 1, progressRatio * cssWidth));
    ctx.strokeStyle = '#F8FAFC';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 4);
    ctx.lineTo(playheadX, cssHeight - 4);
    ctx.stroke();

    // Playhead cap
    ctx.fillStyle = '#6366F1';
    ctx.beginPath();
    ctx.arc(playheadX, 6, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }, [activeSegment, audioMode, buckets, currentTime, isPlaying, progressRatio]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!hasMedia) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(relX * effectiveDuration);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!hasMedia) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const timeSec = relX * effectiveDuration;
    const matchingBand = segmentBands.find(
      (b) => timeSec >= b.startSec && timeSec <= b.endSec
    );
    setHoverInfo({
      timeSec,
      xPct: relX * 100,
      segmentIndex: matchingBand ? matchingBand.index : null,
    });
  };

  return (
    <section
      aria-label="Waveform Visualizer Audio Dubbing"
      data-testid="waveform-visualizer"
      className="bg-[#121520] border border-white/8 rounded-xl p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AudioLines className="w-4 h-4 text-indigo-400 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Waveform Visualizer Audio Dubbing
          </h2>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 tabular-nums">
          <span>
            {audioMode === 'dubbed' ? 'Jalur Dubbing AI' : 'Mode Suara Asli'}
          </span>
          {activeSegment && (
            <span className="text-indigo-300">
              · Segmen #{segments.findIndex((s) => s.id === activeSegment.id) + 1}
            </span>
          )}
        </div>
      </div>

      {/* Canvas Waveform Track */}
      <div className="relative rounded-lg bg-[#0B0D14] border border-white/8 px-2 py-2">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          aria-label="Grafik gelombang audio dubbing, klik untuk melompat ke waktu tertentu"
          className={`w-full h-20 block ${
            hasMedia ? 'cursor-pointer' : 'opacity-45 cursor-default'
          }`}
        />

        {hoverInfo && (
          <div className="pointer-events-none mt-1 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400 px-1">
            <span>
              Kursor: {formatTimecodeShort(hoverInfo.timeSec)}
              {hoverInfo.segmentIndex ? ` · Segmen #${hoverInfo.segmentIndex}` : ' · Jeda'}
            </span>
            <span>Klik grafik untuk seek</span>
          </div>
        )}
      </div>

      {/* Synchronized Segment Timeline Strip */}
      {segments.length > 0 && (
        <div className="space-y-1.5">
          <div className="relative h-6 rounded-md bg-[#0B0D14] border border-white/6 overflow-hidden">
            {segmentBands.map((band) => {
              const isActiveBand = activeSegment?.id === band.id;
              return (
                <button
                  key={band.id}
                  type="button"
                  onClick={() => onSeek(band.startSec)}
                  title={`Segmen #${band.index}: ${formatTimecodeShort(
                    band.startSec
                  )} - ${formatTimecodeShort(band.endSec)}`}
                  style={{
                    left: `${band.leftPct}%`,
                    width: `${band.widthPct}%`,
                  }}
                  className={`absolute top-0.5 bottom-0.5 rounded px-1 text-[10px] font-mono tabular-nums truncate transition-colors border ${
                    isActiveBand
                      ? 'bg-indigo-600/80 border-indigo-400 text-white z-10'
                      : band.hasAudio
                      ? 'bg-indigo-500/20 border-indigo-500/35 text-indigo-200 hover:bg-indigo-500/35'
                      : 'bg-slate-800/70 border-white/10 text-slate-400 hover:bg-slate-700/70'
                  }`}
                >
                  #{band.index}
                </button>
              );
            })}

            {/* Timeline playhead tick */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white z-20"
              style={{ left: `${progressRatio * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500">
            <span>00:00</span>
            <span>Sinkronisasi {segments.length} segmen terhadap durasi video</span>
            <span>{formatTimecodeShort(effectiveDuration)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
