import { FolderOpen, Trash2, X } from 'lucide-react';
import type { SavedDubbingProject } from '../types/dubbing';
import { formatTimecodeShort } from '../utils/subtitleUtils';

interface CloudProjectsModalProps {
  isOpen: boolean;
  projects: SavedDubbingProject[];
  activeProjectId: string | null;
  onClose: () => void;
  onSelectProject: (project: SavedDubbingProject) => void;
  onDeleteProject: (projectId: string) => void;
}

export function CloudProjectsModal({
  isOpen,
  projects,
  activeProjectId,
  onClose,
  onSelectProject,
  onDeleteProject,
}: CloudProjectsModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-projects-title"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-[#121520] border border-white/10 rounded-xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FolderOpen className="w-4 h-4 text-indigo-400" aria-hidden="true" />
            <h2
              id="cloud-projects-title"
              className="font-display text-base font-semibold text-white"
            >
              Proyek Tersimpan di Cloud
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup daftar proyek"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto divide-y divide-white/8 flex-1">
          {projects.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-200">
                Belum ada proyek tersimpan
              </p>
              <p className="text-xs text-slate-400">
                Klik tombol Simpan Cloud di header untuk menyimpan transkrip, word timestamps, dan pengaturan subtitle proyek Anda.
              </p>
            </div>
          ) : (
            projects.map((proj) => {
              const isCurrent = proj.id === activeProjectId;
              return (
                <div
                  key={proj.id}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {proj.title}
                      {isCurrent && (
                        <span className="ml-2 text-xs text-indigo-300">
                          · Aktif
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 tabular-nums">
                      {proj.segments.length} segmen ·{' '}
                      {formatTimecodeShort(proj.durationSeconds)} ·{' '}
                      {proj.sourceLanguage} → {proj.targetLanguage}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectProject(proj);
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors whitespace-nowrap"
                    >
                      Buka
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteProject(proj.id)}
                      aria-label={`Hapus proyek ${proj.title}`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
