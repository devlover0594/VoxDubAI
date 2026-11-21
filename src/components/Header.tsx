import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  AudioWaveform,
  CheckCircle2,
  Cloud,
  FolderOpen,
  LogIn,
  LogOut,
  Upload,
} from 'lucide-react';
import type { ApiHealthStatus } from '../types/dubbing';

interface HeaderProps {
  apiHealth: ApiHealthStatus;
  user: User | null;
  authLoading: boolean;
  savedProjectsCount: number;
  hasSegments: boolean;
  isSavingProject: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenProjects: () => void;
  onSaveProject: () => void;
  onTriggerUpload: () => void;
  isBusy: boolean;
}

export function Header({
  apiHealth,
  user,
  authLoading,
  savedProjectsCount,
  hasSegments,
  isSavingProject,
  onSignIn,
  onSignOut,
  onOpenProjects,
  onSaveProject,
  onTriggerUpload,
  isBusy,
}: HeaderProps) {
  return (
    <header className="h-16 border-b border-white/8 bg-[#0E111A] px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
          <AudioWaveform className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
        </div>
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="font-display text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            VoxDub AI
          </span>
          <span className="hidden xl:inline text-xs text-slate-400 whitespace-nowrap truncate">
            Studio Subtitle &amp; Sulih Suara Otomatis
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div
          className="hidden lg:flex items-center gap-1.5 text-xs text-slate-300 mr-1"
          aria-live="polite"
        >
          {!apiHealth.checked ? (
            <span className="text-slate-400 whitespace-nowrap">Memeriksa API...</span>
          ) : apiHealth.apiKeyConfigured ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
              <span className="text-slate-300 whitespace-nowrap">Gemini API Siap</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
              <span className="text-amber-300 whitespace-nowrap">API Key Belum Diatur</span>
            </>
          )}
        </div>

        {!authLoading &&
          (user ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenProjects}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                <span className="hidden sm:inline">Proyek</span>
                <span className="font-mono tabular-nums text-indigo-300">
                  ({savedProjectsCount})
                </span>
              </button>

              <button
                type="button"
                onClick={onSaveProject}
                disabled={!hasSegments || isSavingProject}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                <Cloud className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                <span className="hidden md:inline">
                  {isSavingProject ? 'Menyimpan...' : 'Simpan Cloud'}
                </span>
              </button>

              <button
                type="button"
                onClick={onSignOut}
                aria-label={`Keluar dari akun ${user.displayName || user.email || ''}`}
                title={user.displayName || user.email || 'Keluar'}
                className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#1A1E2E] hover:bg-rose-500/15 border border-white/10 text-xs font-medium text-slate-300 hover:text-rose-200 transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden xl:inline">Keluar</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              <LogIn className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
              <span className="hidden sm:inline">Masuk Google</span>
              <span className="sm:hidden">Masuk</span>
            </button>
          ))}

        <button
          type="button"
          onClick={onTriggerUpload}
          disabled={isBusy}
          className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E111A]"
        >
          <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Upload Video Baru</span>
          <span className="sm:hidden">Upload</span>
        </button>
      </div>
    </header>
  );
}
