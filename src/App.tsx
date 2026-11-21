import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { auth, googleProvider } from './firebase';
import {
  deleteDubbingProject,
  saveDubbingProject,
  subscribeUserProjects,
  syncUserProfile,
} from './services/projectService';
import { Header } from './components/Header';
import { ProcessStepper } from './components/ProcessStepper';
import { SubtitleCustomizer } from './components/SubtitleCustomizer';
import { VideoPreview } from './components/VideoPreview';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { SegmentEditor } from './components/SegmentEditor';
import { MicTranscriber } from './components/MicTranscriber';
import { CloudProjectsModal } from './components/CloudProjectsModal';
import {
  createDemoSegments,
  DEMO_VIDEO_DURATION,
  DEMO_VIDEO_TITLE,
} from './data/demoProject';
import type {
  ApiHealthStatus,
  AudioMode,
  DubSegment,
  ProcessingStage,
  SavedDubbingProject,
  SubtitleStyle,
  VoiceStyle,
} from './types/dubbing';
import {
  applyTextCorrectionToWords,
  computeDubbingPlaybackRate,
  findActiveSegment,
  formatSecondsToTimestamp,
  getSegmentDurationSeconds,
  parseTimestampToSeconds,
  segmentsToSrt,
  segmentsToVtt,
  syncWordsWithText,
} from './utils/subtitleUtils';
import {
  base64WavToObjectUrl,
  mergeSegmentsToMasterWav,
} from './utils/audioMixer';

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024; // 80 MB

function triggerFileDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [apiHealth, setApiHealth] = useState<ApiHealthStatus>({
    checked: false,
    apiKeyConfigured: false,
    message: '',
  });

  // Firebase Auth & Firestore state
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [savedProjects, setSavedProjects] = useState<SavedDubbingProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isProjectsModalOpen, setIsProjectsModalOpen] = useState<boolean>(false);
  const [isSavingProject, setIsSavingProject] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string>('');
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [audioMode, setAudioMode] = useState<AudioMode>('dubbed');
  const [showOriginalSubtitle, setShowOriginalSubtitle] = useState<boolean>(false);

  const [sourceLanguage, setSourceLanguage] = useState<string>('auto');
  const [targetLanguage, setTargetLanguage] = useState<string>('id');
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>('male_pro');

  const [segments, setSegments] = useState<DubSegment[]>([]);
  const [stage, setStage] = useState<ProcessingStage>('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusDetail, setStatusDetail] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExportingAudio, setIsExportingAudio] = useState<boolean>(false);

  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>({
    fontSize: 'lg',
    textColor: '#FFFFFF',
    backgroundEnabled: true,
    backgroundOpacity: 0.75,
    dynamicMode: 'karaoke',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dubAudioRef = useRef<HTMLAudioElement | null>(null);
  const singlePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastTriggeredSegmentIdRef = useRef<number | null>(null);
  const demoRafRef = useRef<number | null>(null);
  const demoLastTickRef = useRef<number | null>(null);

  const isBusy =
    stage === 'uploading' || stage === 'analyzing' || stage === 'dubbing';

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      if (firebaseUser) {
        void syncUserProfile(firebaseUser).catch((err) => {
          console.error('Profile sync warning:', err);
        });
      } else {
        setSavedProjects([]);
        setActiveProjectId(null);
      }
    });
    return () => unsubAuth();
  }, []);

  // Subscribe to user's Firestore projects only when authenticated
  useEffect(() => {
    if (authLoading || !user) return;
    const unsubProjects = subscribeUserProjects(
      user.uid,
      (projects) => {
        setSavedProjects(projects);
      },
      (err) => {
        setErrorMessage(
          `Gagal memuat proyek dari Firestore: ${err.message}`
        );
      }
    );
    return () => unsubProjects();
  }, [authLoading, user]);

  // Check API health on mount
  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setApiHealth({
          checked: true,
          apiKeyConfigured: Boolean(data?.apiKeyConfigured),
          message: data?.apiKeyConfigured ? 'Siap' : 'API Key belum diatur',
        });
      })
      .catch(() => {
        if (!active) return;
        setApiHealth({
          checked: true,
          apiKeyConfigured: false,
          message: 'Server tidak terjangkau',
        });
      });

    return () => {
      active = false;
    };
  }, []);

  const stopAllDubbingAudio = useCallback(() => {
    if (dubAudioRef.current) {
      dubAudioRef.current.pause();
      dubAudioRef.current.currentTime = 0;
    }
    if (singlePreviewAudioRef.current) {
      singlePreviewAudioRef.current.pause();
    }
    lastTriggeredSegmentIdRef.current = null;
  }, []);

  const handleLoadDemo = useCallback(() => {
    stopAllDubbingAudio();
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    setSelectedFile(null);
    setActiveProjectId(null);
    setVideoUrl(null);
    setVideoName(DEMO_VIDEO_TITLE);
    setIsDemoMode(true);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(DEMO_VIDEO_DURATION);
    setSegments(createDemoSegments());
    setStage('completed');
    setProgressPercent(100);
    setStatusDetail('Proyek demo siap diputar dan diedit.');
    setErrorMessage(null);
    setAudioMode('dubbed');
  }, [stopAllDubbingAudio, videoUrl]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      handleLoadDemo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      stopAllDubbingAudio();
    };
  }, [stopAllDubbingAudio, videoUrl]);

  const activeSegment = useMemo(
    () => findActiveSegment(segments, currentTime),
    [segments, currentTime]
  );

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = audioMode === 'dubbed';
    }
  }, [audioMode, videoUrl]);

  useEffect(() => {
    if (!isDemoMode || !isPlaying) {
      if (demoRafRef.current !== null) {
        cancelAnimationFrame(demoRafRef.current);
        demoRafRef.current = null;
      }
      demoLastTickRef.current = null;
      return;
    }

    const totalLen = Math.max(duration || DEMO_VIDEO_DURATION, 1);
    const tick = (now: number) => {
      if (demoLastTickRef.current === null) {
        demoLastTickRef.current = now;
      }
      const deltaSec = (now - demoLastTickRef.current) / 1000;
      demoLastTickRef.current = now;

      setCurrentTime((prev) => {
        const next = prev + deltaSec;
        if (next >= totalLen) {
          setIsPlaying(false);
          stopAllDubbingAudio();
          return totalLen;
        }
        return next;
      });

      demoRafRef.current = requestAnimationFrame(tick);
    };

    demoRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (demoRafRef.current !== null) {
        cancelAnimationFrame(demoRafRef.current);
        demoRafRef.current = null;
      }
      demoLastTickRef.current = null;
    };
  }, [duration, isDemoMode, isPlaying, stopAllDubbingAudio]);

  // Synchronized AI Dubbing Audio Playback Engine
  useEffect(() => {
    if (!isPlaying || audioMode !== 'dubbed') {
      if (dubAudioRef.current) {
        dubAudioRef.current.pause();
      }
      lastTriggeredSegmentIdRef.current = null;
      return;
    }

    if (!activeSegment || !activeSegment.audioUrl) {
      if (dubAudioRef.current && !dubAudioRef.current.paused) {
        dubAudioRef.current.pause();
      }
      lastTriggeredSegmentIdRef.current = null;
      return;
    }

    if (lastTriggeredSegmentIdRef.current === activeSegment.id) {
      return;
    }

    lastTriggeredSegmentIdRef.current = activeSegment.id;

    if (!dubAudioRef.current) {
      dubAudioRef.current = new Audio();
    }

    const clip = dubAudioRef.current;
    clip.pause();
    clip.src = activeSegment.audioUrl;

    const segStart = parseTimestampToSeconds(activeSegment.startTime);
    const segDuration = getSegmentDurationSeconds(activeSegment);
    const clipDuration = activeSegment.audioDuration || 0;
    const rate = computeDubbingPlaybackRate(clipDuration, segDuration);
    clip.playbackRate = rate;

    const offsetIntoSeg = Math.max(0, currentTime - segStart);
    const adjustedOffset = offsetIntoSeg * rate;

    const startClip = () => {
      if (adjustedOffset > 0.12 && clip.duration && adjustedOffset < clip.duration) {
        clip.currentTime = adjustedOffset;
      } else {
        clip.currentTime = 0;
      }
      clip.play().catch(() => {});
    };

    if (clip.readyState >= 1) {
      startClip();
    } else {
      clip.addEventListener('loadedmetadata', startClip, { once: true });
    }
  }, [activeSegment, audioMode, currentTime, isPlaying]);

  const handleSignIn = useCallback(async () => {
    setErrorMessage(null);
    try {
      await signInWithPopup(auth, googleProvider);
      showToast('Berhasil masuk dengan akun Google.');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal masuk dengan Google.';
      setErrorMessage(`Login Google gagal: ${msg}`);
    }
  }, [showToast]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut(auth);
      showToast('Berhasil keluar dari akun.');
    } catch {
      setErrorMessage('Gagal keluar dari akun.');
    }
  }, [showToast]);

  const handleSaveProjectToCloud = useCallback(async () => {
    if (!user) {
      setErrorMessage('Silakan masuk dengan Google terlebih dahulu untuk menyimpan ke Cloud.');
      return;
    }
    if (segments.length === 0) return;

    setIsSavingProject(true);
    setErrorMessage(null);
    try {
      const newId = await saveDubbingProject({
        projectId: activeProjectId,
        ownerId: user.uid,
        title: videoName || 'Proyek VoxDub AI',
        sourceLanguage,
        targetLanguage,
        voiceStyle,
        durationSeconds: duration,
        subtitleStyle,
        segments,
      });
      setActiveProjectId(newId);
      showToast('Proyek & word-level timestamps tersimpan di Firestore.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan ke Firestore.';
      setErrorMessage(`Gagal menyimpan proyek: ${msg}`);
    } finally {
      setIsSavingProject(false);
    }
  }, [
    activeProjectId,
    duration,
    segments,
    showToast,
    sourceLanguage,
    subtitleStyle,
    targetLanguage,
    user,
    videoName,
    voiceStyle,
  ]);

  const handleSelectCloudProject = useCallback(
    (proj: SavedDubbingProject) => {
      stopAllDubbingAudio();
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      setSelectedFile(null);
      setVideoUrl(null);
      setVideoName(proj.title);
      setActiveProjectId(proj.id);
      setIsDemoMode(true);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(Math.max(proj.durationSeconds || 16, 1));
      setSourceLanguage(proj.sourceLanguage);
      setTargetLanguage(proj.targetLanguage);
      setVoiceStyle(proj.voiceStyle);
      setSubtitleStyle(proj.subtitleStyle);
      setSegments(proj.segments);
      setStage('completed');
      setProgressPercent(100);
      setStatusDetail(`Proyek "${proj.title}" dimuat dari Cloud. Klik Generate Semua Audio TTS untuk membuat klip suara.`);
      showToast(`Proyek "${proj.title}" berhasil dimuat.`);
    },
    [showToast, stopAllDubbingAudio, videoUrl]
  );

  const handleDeleteCloudProject = useCallback(
    async (projectId: string) => {
      try {
        await deleteDubbingProject(projectId);
        if (activeProjectId === projectId) {
          setActiveProjectId(null);
        }
        showToast('Proyek dihapus dari Cloud.');
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Gagal menghapus proyek.'
        );
      }
    },
    [activeProjectId, showToast]
  );

  const generateSegmentTts = useCallback(
    async (
      segId: number,
      text: string,
      chosenVoice: VoiceStyle,
      chosenTargetLang: string
    ): Promise<{ ok: boolean; error?: string }> => {
      setSegments((prev) =>
        prev.map((s) =>
          s.id === segId
            ? { ...s, isGeneratingAudio: true, audioError: undefined }
            : s
        )
      );

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voiceStyle: chosenVoice,
            targetLanguage: chosenTargetLang,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Gagal membuat audio dubbing.');
        }

        const { url, duration: wavDuration } = await base64WavToObjectUrl(
          data.audioBase64
        );

        setSegments((prev) =>
          prev.map((s) => {
            if (s.id !== segId) return s;
            if (s.audioUrl) URL.revokeObjectURL(s.audioUrl);
            return {
              ...s,
              audioUrl: url,
              audioDuration: wavDuration,
              isGeneratingAudio: false,
              audioError: undefined,
            };
          })
        );

        return { ok: true };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Gagal menghasilkan suara TTS untuk segmen ini.';
        setSegments((prev) =>
          prev.map((s) =>
            s.id === segId
              ? { ...s, isGeneratingAudio: false, audioError: message }
              : s
          )
        );
        return { ok: false, error: message };
      }
    },
    []
  );

  const runFullPipeline = useCallback(
    async (file: File) => {
      setErrorMessage(null);
      setStage('uploading');
      setProgressPercent(15);
      setStatusDetail(`Mengunggah ${file.name} ke server...`);

      try {
        const formData = new FormData();
        formData.append('media', file);
        formData.append('sourceLanguage', sourceLanguage);
        formData.append('targetLanguage', targetLanguage);

        setStage('analyzing');
        setProgressPercent(40);
        setStatusDetail(
          'Menganalisis audio, word-level timestamps & menerjemahkan dengan Gemini AI...'
        );

        const analyzeRes = await fetch('/api/analyze', {
          method: 'POST',
          body: formData,
        });
        const analyzeData = await analyzeRes.json();

        if (!analyzeRes.ok) {
          throw new Error(
            analyzeData?.error || 'Gagal menganalisis dan menerjemahkan video.'
          );
        }

        const extracted: DubSegment[] = Array.isArray(analyzeData?.segments)
          ? analyzeData.segments
          : [];

        if (extracted.length === 0) {
          throw new Error(
            'Tidak ada ucapan yang terdeteksi di dalam media ini. Coba video dengan dialog yang lebih jelas.'
          );
        }

        setSegments(extracted);
        setStage('dubbing');
        setProgressPercent(60);
        setStatusDetail(
          `Menyiapkan sulih suara AI untuk ${extracted.length} segmen...`
        );

        let failedCount = 0;
        let firstTtsError: string | undefined;

        for (let i = 0; i < extracted.length; i++) {
          const seg = extracted[i];
          const pct = 60 + Math.round(((i + 1) / extracted.length) * 38);
          setProgressPercent(pct);
          setStatusDetail(
            `Menyiapkan dubbing segmen ${i + 1} dari ${extracted.length}...`
          );

          if (!seg.translatedText.trim()) continue;
          const result = await generateSegmentTts(
            seg.id,
            seg.translatedText,
            voiceStyle,
            targetLanguage
          );
          if (!result.ok) {
            failedCount++;
            if (!firstTtsError) firstTtsError = result.error;
          }
        }

        setStage('completed');
        setProgressPercent(100);
        setAudioMode('dubbed');

        if (failedCount > 0) {
          setStatusDetail(
            `Transkrip selesai, namun ${failedCount} segmen gagal dibuatkan audio.`
          );
          if (firstTtsError) {
            setErrorMessage(firstTtsError);
          }
        } else {
          setStatusDetail(
            `Selesai! ${extracted.length} segmen subtitle, word timestamps, dan audio dubbing siap.`
          );
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Terjadi kesalahan saat memproses video.';
        setStage('error');
        setProgressPercent(0);
        setStatusDetail('Pemrosesan terhenti.');
        setErrorMessage(msg);
      }
    },
    [generateSegmentTts, sourceLanguage, targetLanguage, voiceStyle]
  );

  const handleFileSelected = useCallback(
    (file: File) => {
      setErrorMessage(null);

      if (file.size > MAX_UPLOAD_BYTES) {
        setErrorMessage(
          `Ukuran file "${file.name}" (${(file.size / (1024 * 1024)).toFixed(
            1
          )} MB) melebihi batas maksimal 80 MB.`
        );
        return;
      }

      const validExt = /\.(mp4|webm|mov|mkv|mp3|wav|m4a|ogg)$/i.test(file.name);
      if (
        !file.type.startsWith('video/') &&
        !file.type.startsWith('audio/') &&
        !validExt
      ) {
        setErrorMessage(
          'Format file tidak didukung. Gunakan video MP4, WebM, MOV, atau audio MP3/WAV.'
        );
        return;
      }

      stopAllDubbingAudio();
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      const objectUrl = URL.createObjectURL(file);
      setSelectedFile(file);
      setActiveProjectId(null);
      setVideoUrl(objectUrl);
      setVideoName(file.name);
      setIsDemoMode(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setSegments([]);

      void runFullPipeline(file);
    },
    [runFullPipeline, stopAllDubbingAudio, videoUrl]
  );

  const handleTogglePlay = useCallback(() => {
    if (isDemoMode) {
      const totalLen = Math.max(duration || DEMO_VIDEO_DURATION, 1);
      if (currentTime >= totalLen) {
        setCurrentTime(0);
      }
      setIsPlaying((prev) => !prev);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.muted = audioMode === 'dubbed';
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
      stopAllDubbingAudio();
    }
  }, [audioMode, currentTime, duration, isDemoMode, stopAllDubbingAudio]);

  const handleSeek = useCallback(
    (targetSec: number) => {
      const clamped = Math.max(0, Math.min(duration || DEMO_VIDEO_DURATION, targetSec));
      lastTriggeredSegmentIdRef.current = null;
      if (dubAudioRef.current) {
        dubAudioRef.current.pause();
      }

      setCurrentTime(clamped);
      if (!isDemoMode && videoRef.current) {
        videoRef.current.currentTime = clamped;
      }
    },
    [duration, isDemoMode]
  );

  const handleSeekToSegment = useCallback(
    (startTimeVal: string | number) => {
      const sec = parseTimestampToSeconds(startTimeVal);
      handleSeek(sec);
    },
    [handleSeek]
  );

  const handleSegmentChange = useCallback(
    (id: number, patch: Partial<DubSegment>) => {
      setSegments((prev) =>
        prev.map((seg) => {
          if (seg.id !== id) return seg;
          const updated = { ...seg, ...patch };
          if (
            patch.translatedText !== undefined ||
            patch.startTime !== undefined ||
            patch.endTime !== undefined
          ) {
            const startSec = parseTimestampToSeconds(updated.startTime);
            const endSec = parseTimestampToSeconds(updated.endTime);
            updated.words = syncWordsWithText(
              updated.translatedText,
              startSec,
              endSec
            );
          }
          return updated;
        })
      );
    },
    []
  );

  const handleAutoFixGrammar = useCallback(
    async (id: number) => {
      const target = segments.find((s) => s.id === id);
      if (!target || !target.translatedText.trim() || target.isFixingGrammar) {
        return;
      }

      setSegments((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, isFixingGrammar: true, grammarError: undefined }
            : s
        )
      );

      try {
        const res = await fetch('/api/fix-grammar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: target.translatedText,
            originalText: target.originalText,
            targetLanguage,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Gagal memperbaiki ejaan dan tata bahasa.');
        }

        const correctedText =
          typeof data?.correctedText === 'string' && data.correctedText.trim()
            ? data.correctedText.trim()
            : target.translatedText;

        const changed = correctedText !== target.translatedText.trim();

        setSegments((prev) =>
          prev.map((s) => {
            if (s.id !== id) return s;
            const startSec = parseTimestampToSeconds(s.startTime);
            const endSec = parseTimestampToSeconds(s.endTime);
            const updatedWords = changed
              ? applyTextCorrectionToWords(s.words, correctedText, startSec, endSec)
              : s.words;

            return {
              ...s,
              translatedText: correctedText,
              words: updatedWords,
              isFixingGrammar: false,
              grammarError: undefined,
            };
          })
        );

        showToast(
          changed
            ? 'Ejaan & tata bahasa segmen diperbaiki (timestamp tetap terjaga).'
            : 'Ejaan & tata bahasa segmen sudah tepat.'
        );
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Gagal memperbaiki tata bahasa segmen.';
        setSegments((prev) =>
          prev.map((s) =>
            s.id === id
              ? { ...s, isFixingGrammar: false, grammarError: msg }
              : s
          )
        );
      }
    },
    [segments, showToast, targetLanguage]
  );

  const handleRegenerateSegmentAudio = useCallback(
    (id: number) => {
      const target = segments.find((s) => s.id === id);
      if (!target || !target.translatedText.trim()) return;
      void generateSegmentTts(
        id,
        target.translatedText,
        voiceStyle,
        targetLanguage
      );
    },
    [generateSegmentTts, segments, targetLanguage, voiceStyle]
  );

  const handleGenerateAllDubbing = useCallback(async () => {
    if (segments.length === 0) return;
    setErrorMessage(null);
    setStage('dubbing');
    setProgressPercent(20);
    setStatusDetail(`Membuat ulang audio dubbing untuk ${segments.length} segmen...`);

    let failedCount = 0;
    let firstErr: string | undefined;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      setProgressPercent(20 + Math.round(((i + 1) / segments.length) * 80));
      setStatusDetail(`Memproses suara segmen ${i + 1} dari ${segments.length}...`);
      if (!seg.translatedText.trim()) continue;
      const res = await generateSegmentTts(
        seg.id,
        seg.translatedText,
        voiceStyle,
        targetLanguage
      );
      if (!res.ok) {
        failedCount++;
        if (!firstErr) firstErr = res.error;
      }
    }

    setStage('completed');
    setProgressPercent(100);
    if (failedCount > 0) {
      setStatusDetail(`${failedCount} segmen gagal dibuatkan audio.`);
      if (firstErr) setErrorMessage(firstErr);
    } else {
      setStatusDetail('Semua klip audio dubbing berhasil diperbarui.');
    }
  }, [generateSegmentTts, segments, targetLanguage, voiceStyle]);

  const handlePlaySingleSegment = useCallback((seg: DubSegment) => {
    if (!seg.audioUrl) return;
    if (!singlePreviewAudioRef.current) {
      singlePreviewAudioRef.current = new Audio();
    }
    const audio = singlePreviewAudioRef.current;
    audio.pause();
    audio.src = seg.audioUrl;
    audio.currentTime = 0;
    const segDur = getSegmentDurationSeconds(seg);
    audio.playbackRate = computeDubbingPlaybackRate(seg.audioDuration || 0, segDur);
    audio.play().catch(() => {});
  }, []);

  const handleAddSegment = useCallback(() => {
    setSegments((prev) => {
      const nextId = prev.reduce((max, s) => Math.max(max, s.id), 0) + 1;
      const lastEndSec =
        prev.length > 0
          ? parseTimestampToSeconds(prev[prev.length - 1].endTime)
          : currentTime;
      const startSec = Math.max(0, lastEndSec + 0.2);
      const endSec = startSec + 3.0;
      return [
        ...prev,
        {
          id: nextId,
          startTime: formatSecondsToTimestamp(startSec),
          endTime: formatSecondsToTimestamp(endSec),
          originalText: '',
          translatedText: '',
          words: [],
        },
      ];
    });
  }, [currentTime]);

  const handleAddTranscribedSegment = useCallback(
    (origText: string, transText: string) => {
      const nextId = segments.reduce((max, s) => Math.max(max, s.id), 0) + 1;
      const lastEndSec =
        segments.length > 0
          ? parseTimestampToSeconds(segments[segments.length - 1].endTime)
          : currentTime;
      const startSec = segments.length > 0 ? lastEndSec + 0.2 : 0;
      const estDuration = Math.max(2.5, Math.min(8, transText.split(/\s+/).length * 0.45));
      const endSec = startSec + estDuration;
      const words = syncWordsWithText(transText, startSec, endSec);

      const newSegment: DubSegment = {
        id: nextId,
        startTime: formatSecondsToTimestamp(startSec),
        endTime: formatSecondsToTimestamp(endSec),
        originalText: origText,
        translatedText: transText,
        words,
      };

      setSegments((prev) => [...prev, newSegment]);
      if (!videoUrl && !isDemoMode) {
        setIsDemoMode(true);
        setVideoName('Rekaman_Mikrofon_VoxDub.webm');
        setDuration(Math.max(endSec + 1, 8));
      } else if (isDemoMode && endSec > duration) {
        setDuration(endSec + 1);
      }

      void generateSegmentTts(nextId, transText, voiceStyle, targetLanguage);
      showToast('Segmen hasil transkripsi mikrofon ditambahkan ke daftar.');
    },
    [
      currentTime,
      duration,
      generateSegmentTts,
      isDemoMode,
      segments,
      showToast,
      targetLanguage,
      videoUrl,
      voiceStyle,
    ]
  );

  const handleDeleteSegment = useCallback((id: number) => {
    setSegments((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target?.audioUrl) URL.revokeObjectURL(target.audioUrl);
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const handleDownloadSrt = useCallback(() => {
    if (segments.length === 0) return;
    const content = segmentsToSrt(segments, false);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const baseName = (videoName || 'voxdub').replace(/\.[^.]+$/, '');
    triggerFileDownload(blob, `${baseName}_subtitle.srt`);
  }, [segments, videoName]);

  const handleDownloadVtt = useCallback(() => {
    if (segments.length === 0) return;
    const content = segmentsToVtt(segments, false);
    const blob = new Blob([content], { type: 'text/vtt;charset=utf-8' });
    const baseName = (videoName || 'voxdub').replace(/\.[^.]+$/, '');
    triggerFileDownload(blob, `${baseName}_subtitle.vtt`);
  }, [segments, videoName]);

  const handleExportBundle = useCallback(async () => {
    if (segments.length === 0) return;
    setIsExportingAudio(true);
    setErrorMessage(null);
    try {
      const baseName = (videoName || 'voxdub').replace(/\.[^.]+$/, '');
      const srtContent = segmentsToSrt(segments, false);
      const srtBlob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
      triggerFileDownload(srtBlob, `${baseName}_subtitle.srt`);

      const hasAudioClips = segments.some((s) => Boolean(s.audioUrl));
      if (hasAudioClips) {
        const masterWav = await mergeSegmentsToMasterWav(segments, duration);
        triggerFileDownload(masterWav, `${baseName}_dubbing.wav`);
      }
    } catch {
      setErrorMessage('Gagal menggabungkan file audio dubbing untuk diekspor.');
    } finally {
      setIsExportingAudio(false);
    }
  }, [duration, segments, videoName]);

  return (
    <div className="min-h-screen bg-[#0B0D14] text-slate-100 flex flex-col">
      <Header
        apiHealth={apiHealth}
        user={user}
        authLoading={authLoading}
        savedProjectsCount={savedProjects.length}
        hasSegments={segments.length > 0}
        isSavingProject={isSavingProject}
        onSignIn={() => void handleSignIn()}
        onSignOut={() => void handleSignOut()}
        onOpenProjects={() => setIsProjectsModalOpen(true)}
        onSaveProject={() => void handleSaveProjectToCloud()}
        isBusy={isBusy}
        onTriggerUpload={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-matroska,audio/*"
        className="hidden"
        aria-label="Upload file video atau audio"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileSelected(f);
          e.target.value = '';
        }}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
        {toastMessage && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 bg-emerald-500/12 border border-emerald-500/35 text-emerald-100 px-4 py-2.5 rounded-xl text-xs sm:text-sm"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
              <span>{toastMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              aria-label="Tutup notifikasi"
              className="text-emerald-300 hover:text-white p-1 rounded"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 bg-rose-500/12 border border-rose-500/35 text-rose-100 px-4 py-3 rounded-xl text-sm"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle
                className="w-4 h-4 text-rose-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="leading-snug">{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              aria-label="Tutup pesan error"
              className="text-rose-300 hover:text-white p-1 rounded shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <ProcessStepper
          stage={stage}
          progressPercent={progressPercent}
          statusDetail={statusDetail}
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left / Top: Video Player, Subtitle Dynamic Customizer, & Mic Transcriber */}
          <div className="lg:col-span-7 space-y-4">
            <VideoPreview
              videoUrl={videoUrl}
              videoName={videoName}
              isDemoMode={isDemoMode}
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              audioMode={audioMode}
              activeSegment={activeSegment}
              subtitleStyle={subtitleStyle}
              showOriginalSubtitle={showOriginalSubtitle}
              onToggleShowOriginalSubtitle={() =>
                setShowOriginalSubtitle((prev) => !prev)
              }
              onTogglePlay={handleTogglePlay}
              onSeek={handleSeek}
              onAudioModeChange={(mode) => {
                if (mode === 'original' && dubAudioRef.current) {
                  dubAudioRef.current.pause();
                }
                lastTriggeredSegmentIdRef.current = null;
                setAudioMode(mode);
              }}
              onFileSelected={handleFileSelected}
              onLoadDemo={handleLoadDemo}
              videoRef={videoRef}
              onVideoLoadedMetadata={() => {
                if (videoRef.current) {
                  setDuration(videoRef.current.duration || 0);
                }
              }}
              onVideoTimeUpdate={() => {
                if (videoRef.current) {
                  setCurrentTime(videoRef.current.currentTime);
                }
              }}
              onVideoEnded={() => {
                setIsPlaying(false);
                stopAllDubbingAudio();
              }}
            />

            <WaveformVisualizer
              segments={segments}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              audioMode={audioMode}
              activeSegment={activeSegment}
              hasMedia={Boolean(videoUrl) || isDemoMode}
              onSeek={handleSeek}
            />

            <SubtitleCustomizer
              style={subtitleStyle}
              onChange={setSubtitleStyle}
              onDownloadSrt={handleDownloadSrt}
              onDownloadVtt={handleDownloadVtt}
              hasSegments={segments.length > 0}
            />

            <MicTranscriber
              targetLanguage={targetLanguage}
              onAddTranscribedSegment={handleAddTranscribedSegment}
            />
          </div>

          {/* Right / Bottom: Language, Voice, & Editable Segment List */}
          <div className="lg:col-span-5">
            <SegmentEditor
              sourceLanguage={sourceLanguage}
              targetLanguage={targetLanguage}
              voiceStyle={voiceStyle}
              segments={segments}
              activeSegmentId={activeSegment?.id ?? null}
              currentTime={currentTime}
              hasUploadedFile={Boolean(selectedFile)}
              isBusy={isBusy}
              isExportingAudio={isExportingAudio}
              onSourceLanguageChange={setSourceLanguage}
              onTargetLanguageChange={setTargetLanguage}
              onVoiceStyleChange={setVoiceStyle}
              onProcessVideo={() => {
                if (selectedFile) void runFullPipeline(selectedFile);
              }}
              onGenerateAllDubbing={() => void handleGenerateAllDubbing()}
              onExportBundle={() => void handleExportBundle()}
              onSegmentChange={handleSegmentChange}
              onSeekToSegment={handleSeekToSegment}
              onAutoFixGrammar={(id) => void handleAutoFixGrammar(id)}
              onRegenerateSegmentAudio={handleRegenerateSegmentAudio}
              onPlaySingleSegment={handlePlaySingleSegment}
              onAddSegment={handleAddSegment}
              onDeleteSegment={handleDeleteSegment}
            />
          </div>
        </div>
      </main>

      <CloudProjectsModal
        isOpen={isProjectsModalOpen}
        projects={savedProjects}
        activeProjectId={activeProjectId}
        onClose={() => setIsProjectsModalOpen(false)}
        onSelectProject={handleSelectCloudProject}
        onDeleteProject={(id) => void handleDeleteCloudProject(id)}
      />
    </div>
  );
}
