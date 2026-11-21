import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Plus, Square } from 'lucide-react';

interface MicTranscriberProps {
  targetLanguage: string;
  onAddTranscribedSegment: (originalText: string, translatedText: string) => void;
}

export function MicTranscriber({
  targetLanguage,
  onAddTranscribedSegment,
}: MicTranscriberProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const uploadAudioForTranscription = async (audioBlob: Blob) => {
    setIsTranscribing(true);
    setMicError(null);
    try {
      const formData = new FormData();
      const ext = audioBlob.type.includes('mp4')
        ? 'm4a'
        : audioBlob.type.includes('ogg')
        ? 'ogg'
        : 'webm';
      formData.append('audio', audioBlob, `mic_recording.${ext}`);
      formData.append('targetLanguage', targetLanguage);

      const res = await fetch('/api/transcribe-mic', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal mentranskripsi audio mikrofon.');
      }

      setTranscript(data.transcript || '');
      setTranslatedText(data.translatedText || data.transcript || '');
    } catch (err) {
      setMicError(
        err instanceof Error
          ? err.message
          : 'Terjadi kesalahan saat memproses rekaman mikrofon.'
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleStartRecording = async () => {
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError(
        'Browser ini tidak mendukung perekaman mikrofon (getUserMedia).'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size > 0) {
          void uploadAudioForTranscription(blob);
        }
      };

      recorder.start();
      setIsRecording(true);
      setElapsedSec(0);
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
    } catch {
      setMicError(
        'Izin mikrofon ditolak atau perangkat mikrofon tidak ditemukan.'
      );
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleInsertSegment = () => {
    if (!transcript.trim() && !translatedText.trim()) return;
    onAddTranscribedSegment(
      transcript.trim() || translatedText.trim(),
      translatedText.trim() || transcript.trim()
    );
    setTranscript('');
    setTranslatedText('');
  };

  return (
    <section
      aria-label="Transkripsi Suara Mikrofon"
      className="bg-[#121520] border border-white/8 rounded-xl p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-indigo-400 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Dikte &amp; Transkripsi Mikrofon
            </h2>
            <p className="text-xs text-slate-400">
              Rekam suara Anda untuk membuat segmen baru dengan Gemini Transcribe
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRecording && (
            <span className="font-mono text-xs tabular-nums text-rose-300">
              {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:
              {String(elapsedSec % 60).padStart(2, '0')}
            </span>
          )}

          {!isRecording ? (
            <button
              type="button"
              onClick={() => void handleStartRecording()}
              disabled={isTranscribing}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 disabled:opacity-50 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              {isTranscribing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" aria-hidden="true" />
              ) : (
                <Mic className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
              )}
              <span>{isTranscribing ? 'Mentranskripsi...' : 'Rekam Mikrofon'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStopRecording}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>Hentikan Rekaman</span>
            </button>
          )}
        </div>
      </div>

      {micError && (
        <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">
          {micError}
        </p>
      )}

      {(transcript || translatedText) && (
        <div className="space-y-2.5 pt-2 border-t border-white/6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label
                htmlFor="mic-transcript"
                className="block text-[11px] text-slate-400 mb-1"
              >
                Hasil Transkrip (gemini-3.5-transcribe)
              </label>
              <textarea
                id="mic-transcript"
                rows={2}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label
                htmlFor="mic-translated"
                className="block text-[11px] text-indigo-300 mb-1"
              >
                Terjemahan Siap Dubbing
              </label>
              <textarea
                id="mic-translated"
                rows={2}
                value={translatedText}
                onChange={(e) => setTranslatedText(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-indigo-500/30 text-xs text-white focus:outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleInsertSegment}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Tambahkan ke Daftar Segmen</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
