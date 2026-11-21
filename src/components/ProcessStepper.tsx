import { Check, Loader2 } from 'lucide-react';
import type { ProcessingStage } from '../types/dubbing';

interface ProcessStepperProps {
  stage: ProcessingStage;
  progressPercent: number;
  statusDetail: string;
}

const STEPS: { key: ProcessingStage; number: number; label: string }[] = [
  { key: 'uploading', number: 1, label: 'Mengunggah Media' },
  { key: 'analyzing', number: 2, label: 'Menganalisis & Menerjemahkan' },
  { key: 'dubbing', number: 3, label: 'Menyiapkan Dubbing' },
  { key: 'completed', number: 4, label: 'Selesai' },
];

const STAGE_ORDER: Record<ProcessingStage, number> = {
  idle: 0,
  uploading: 1,
  analyzing: 2,
  dubbing: 3,
  completed: 4,
  error: 0,
};

export function ProcessStepper({ stage, progressPercent, statusDetail }: ProcessStepperProps) {
  if (stage === 'idle') return null;

  const currentOrder = STAGE_ORDER[stage];

  return (
    <section
      aria-label="Progres Pemrosesan AI"
      className="bg-[#121520] border border-white/8 rounded-xl px-4 py-3.5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <p className="text-xs font-medium text-slate-200">{statusDetail}</p>
        <span className="font-mono text-xs tabular-nums text-indigo-300 shrink-0">
          {Math.round(progressPercent)}%
        </span>
      </div>

      <div className="w-full h-1.5 bg-slate-800/90 rounded-full overflow-hidden mb-3.5">
        <div
          className={`h-full transition-all duration-300 ease-out rounded-full ${
            stage === 'error'
              ? 'bg-rose-500'
              : stage === 'completed'
              ? 'bg-emerald-500'
              : 'bg-indigo-500'
          }`}
          style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }}
        />
      </div>

      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {STEPS.map((step) => {
          const isDone =
            stage === 'completed' ? true : currentOrder > step.number;
          const isActive = stage !== 'completed' && currentOrder === step.number;

          return (
            <li
              key={step.key}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs transition-colors ${
                isActive
                  ? 'bg-indigo-500/12 border-indigo-500/40 text-indigo-100'
                  : isDone
                  ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-200'
                  : 'bg-[#0E111A] border-white/6 text-slate-500'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[11px] shrink-0 ${
                  isDone
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : isActive
                    ? 'bg-indigo-500/25 text-indigo-200'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {isDone ? (
                  <Check className="w-3 h-3" aria-hidden="true" />
                ) : isActive ? (
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                ) : (
                  step.number
                )}
              </span>
              <span className="truncate font-medium">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
