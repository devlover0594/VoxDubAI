import 'dotenv/config';
import { execFile, spawn } from 'child_process';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import multer from 'multer';
import {
  buildCandidateList,
  fetchProviderModels,
  fixGrammarWithProvider,
  getProviderDisplayName,
  mapProviderError,
  parseAiConfigFromRequest,
  parseFallbackConfigsFromRequest,
  runWithServerFallback,
  synthesizeTtsWithProvider,
  transcribeAudioWithProvider,
  translateTextWithProvider,
  TtsUnsupportedByProviderError,
  type AiProviderRequestConfig,
} from './server/aiProviders.ts';
import {
  buildFfmpegRenderArgs,
  getMp4DownloadFilename,
  mapLangToIso639_2,
  normalizeSubtitleRenderMode,
  type RenderAudioMixMode,
} from './src/utils/mp4RenderConfig.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_SIZE_BYTES = 80 * 1024 * 1024; // 80 MB limit
const ANALYSIS_SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server', 'analyze_media.py');
const PYTHON_EXECUTABLE =
  process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3');

const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
  'audio/webm',
  'audio/ogg',
]);

const LANGUAGE_LABELS: Record<string, string> = {
  auto: 'Auto-Detect (detect the spoken language automatically)',
  id: 'Indonesian (Bahasa Indonesia)',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Mandarin Chinese',
  ar: 'Arabic',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

const VOICE_MAP: Record<string, { voiceName: string; style: string }> = {
  male_pro: {
    voiceName: 'Charon',
    style: 'Clear, authoritative, professional male documentary and corporate dubbing voice with crisp articulation',
  },
  female_friendly: {
    voiceName: 'Kore',
    style: 'Warm, friendly, articulate and expressive female dubbing voice with natural conversational pacing',
  },
  narrator_casual: {
    voiceName: 'Puck',
    style: 'Relaxed, engaging, conversational casual narrator dubbing voice',
  },
};

function normalizeMimeType(mimeType: string, originalName: string): string {
  const cleanMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (cleanMime && ALLOWED_MIME_TYPES.has(cleanMime)) {
    if (cleanMime === 'audio/mp3') return 'audio/mpeg';
    if (cleanMime === 'audio/x-wav') return 'audio/wav';
    return cleanMime;
  }
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  return 'video/mp4';
}

const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const validExt = ['.mp4', '.webm', '.mov', '.mkv', '.mp3', '.wav', '.m4a', '.ogg'].includes(ext);
    const cleanMime = (file.mimetype || '').split(';')[0].trim().toLowerCase();
    if (ALLOWED_MIME_TYPES.has(cleanMime) || validExt) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Gunakan MP4, WebM, MOV, MP3, WAV, atau OGG.'));
    }
  },
});

function runPythonAnalysis(payload: {
  candidates: AiProviderRequestConfig[];
  sourceLabel: string;
  targetLabel: string;
  media: {
    filePath: string;
    fileSize: number;
    originalName: string;
    mimeType: string;
  };
}): Promise<{
  segments: Array<{
    id: number;
    startTime: string;
    endTime: string;
    originalText: string;
    translatedText: string;
    words: Array<{ word: string; start: number; end: number }>;
  }>;
  usedModel: string;
  usedProvider: string;
  fallbackUsed: boolean;
  attemptCount: number;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_EXECUTABLE, [ANALYSIS_SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 300000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error('Waktu analisis Python habis. Coba lagi atau gunakan file yang lebih singkat.'));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Proses analisis Python berhenti dengan kode ${code}.`));
        return;
      }
      try {
        const result = JSON.parse(stdout) as {
          ok?: boolean;
          error?: string;
          httpStatus?: number;
          segments?: Array<{
            id: number;
            startTime: string;
            endTime: string;
            originalText: string;
            translatedText: string;
            words: Array<{ word: string; start: number; end: number }>;
          }>;
          usedModel?: string;
          usedProvider?: string;
          fallbackUsed?: boolean;
          attemptCount?: number;
        };
        if (!result.ok) {
          const error = new Error(result.error || 'Gagal menganalisis media dengan Python.') as Error & {
            httpStatus?: number;
          };
          error.httpStatus = result.httpStatus;
          reject(error);
          return;
        }
        resolve({
          segments: result.segments ?? [],
          usedModel: result.usedModel ?? '',
          usedProvider: result.usedProvider ?? '',
          fallbackUsed: result.fallbackUsed ?? false,
          attemptCount: result.attemptCount ?? 1,
        });
      } catch {
        reject(new Error('Respons proses analisis Python tidak valid.'));
      }
    });
    child.stdin.on('error', (error) => {
      clearTimeout(timeout);
      child.kill();
      reject(error);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const apiKeyConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
    res.json({
      ok: true,
      apiKeyConfigured,
    });
  });

  app.post('/api/ai/fetch-models', async (req: Request, res: Response) => {
    try {
      const cfg = parseAiConfigFromRequest(req.body);
      const models = await fetchProviderModels({
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
      });
      res.json({ models });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil daftar model AI.';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/analyze', upload.single('media'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Tidak ada file video atau audio yang diunggah.' });
      return;
    }

    const aiConfig = parseAiConfigFromRequest(req.body?.aiConfig);
    const fallbackConfigs = parseFallbackConfigsFromRequest(req.body?.fallbackConfigs);
    const candidates = buildCandidateList(aiConfig, fallbackConfigs);
    const sourceLang = typeof req.body?.sourceLanguage === 'string' ? req.body.sourceLanguage : 'auto';
    const targetLang = typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage : 'id';

    try {
      const result = await runPythonAnalysis({
        candidates,
        sourceLabel: LANGUAGE_LABELS[sourceLang] ?? sourceLang,
        targetLabel: LANGUAGE_LABELS[targetLang] ?? targetLang,
        media: {
          filePath: file.path,
          fileSize: file.size,
          originalName: file.originalname,
          mimeType: normalizeMimeType(file.mimetype, file.originalname),
        },
      });
      res.json(result);
    } catch (err) {
      const httpStatus = (err as { httpStatus?: number }).httpStatus;
      if (httpStatus) {
        res.status(httpStatus).json({ error: err instanceof Error ? err.message : String(err) });
      } else {
        const mapped = mapProviderError(err, aiConfig.provider);
        res.status(mapped.status).json({ error: mapped.message });
      }
    } finally {
      await fs.promises.unlink(file.path).catch(() => {});
    }
  });

  /**
   * Microphone Audio Transcription using the active AI provider + Auto-Fallback
   * Optionally translates the transcript into targetLanguage.
   */
  app.post('/api/transcribe-mic', upload.single('audio'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Tidak ada rekaman audio mikrofon yang diterima.' });
      return;
    }

    const aiConfig = parseAiConfigFromRequest(req.body?.aiConfig);
    const fallbackConfigs = parseFallbackConfigsFromRequest(req.body?.fallbackConfigs);
    const candidates = buildCandidateList(aiConfig, fallbackConfigs);

    const targetLang = typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage : 'id';
    const targetLabel = LANGUAGE_LABELS[targetLang] ?? targetLang;
    const mimeType = normalizeMimeType(file.mimetype, file.originalname || 'mic.webm');

    try {
      const outcome = await runWithServerFallback(candidates, async (candidate) => {
        const transcript = await transcribeAudioWithProvider({
          filePath: file.path,
          originalName: file.originalname || 'mic.webm',
          mimeType,
          aiConfig: candidate,
        });

        if (!transcript) {
          throw new Error(
            'Tidak ada ucapan yang terdengar pada rekaman mikrofon. Coba rekam ulang dengan suara lebih jelas.'
          );
        }

        let translatedText = transcript;
        try {
          translatedText = await translateTextWithProvider({
            text: transcript,
            langLabel: targetLabel,
            aiConfig: candidate,
          });
        } catch {
          // Keep transcript as fallback if translation fails
        }

        return { transcript, translatedText };
      });

      res.json({
        transcript: outcome.result.transcript,
        translatedText: outcome.result.translatedText,
        usedProvider: getProviderDisplayName(outcome.usedConfig.provider),
        fallbackUsed: outcome.fallbackUsed,
      });
    } catch (err) {
      const httpStatus = (err as { httpStatus?: number }).httpStatus;
      if (httpStatus) {
        res.status(httpStatus).json({ error: err instanceof Error ? err.message : String(err) });
      } else {
        const mapped = mapProviderError(err, aiConfig.provider);
        res.status(mapped.status).json({ error: mapped.message });
      }
    } finally {
      await fs.promises.unlink(file.path).catch(() => {});
    }
  });

  app.post('/api/fix-grammar', async (req: Request, res: Response) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const originalText = typeof req.body?.originalText === 'string' ? req.body.originalText.trim() : '';
    const targetLanguage = typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage : 'id';
    const aiConfig = parseAiConfigFromRequest(req.body?.aiConfig);
    const fallbackConfigs = parseFallbackConfigsFromRequest(req.body?.fallbackConfigs);
    const candidates = buildCandidateList(aiConfig, fallbackConfigs);

    if (!text) {
      res.status(400).json({ error: 'Teks terjemahan kosong, tidak ada yang dapat diperbaiki.' });
      return;
    }

    if (text.length > 2000) {
      res.status(400).json({ error: 'Teks segmen terlalu panjang (maksimal 2000 karakter).' });
      return;
    }

    const langLabel = LANGUAGE_LABELS[targetLanguage] ?? targetLanguage;

    try {
      const outcome = await runWithServerFallback(candidates, (candidate) =>
        fixGrammarWithProvider({
          text,
          originalText,
          langLabel,
          aiConfig: candidate,
        })
      );
      res.json({
        correctedText: outcome.result,
        usedProvider: getProviderDisplayName(outcome.usedConfig.provider),
        fallbackUsed: outcome.fallbackUsed,
      });
    } catch (err) {
      const httpStatus = (err as { httpStatus?: number }).httpStatus;
      if (httpStatus) {
        res.status(httpStatus).json({ error: err instanceof Error ? err.message : String(err) });
      } else {
        const mapped = mapProviderError(err, aiConfig.provider);
        res.status(mapped.status).json({ error: mapped.message });
      }
    }
  });

  app.post('/api/tts', async (req: Request, res: Response) => {
    const aiConfig = parseAiConfigFromRequest(req.body?.aiConfig);
    const fallbackConfigs = parseFallbackConfigsFromRequest(req.body?.fallbackConfigs);
    const candidates = buildCandidateList(aiConfig, fallbackConfigs);

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const voiceStyle = typeof req.body?.voiceStyle === 'string' ? req.body.voiceStyle : 'male_pro';
    const targetLanguage = typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage : 'id';

    if (!text) {
      res.status(400).json({ error: 'Teks terjemahan tidak boleh kosong untuk dibuatkan suara.' });
      return;
    }

    if (text.length > 2000) {
      res.status(400).json({ error: 'Teks segmen terlalu panjang (maksimal 2000 karakter).' });
      return;
    }

    const voiceProfile = VOICE_MAP[voiceStyle] ?? VOICE_MAP.male_pro;
    const langLabel = LANGUAGE_LABELS[targetLanguage] ?? targetLanguage;

    const attemptErrors: Array<{ status: number; message: string; label: string }> = [];
    let lastUnsupportedErr: TtsUnsupportedByProviderError | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        const audioResult = await synthesizeTtsWithProvider({
          text,
          voiceStyle,
          langLabel,
          voiceProfile,
          aiConfig: candidate,
        });

        res.json({
          audioBase64: audioResult.audioBase64,
          mimeType: audioResult.mimeType,
          usedModel: audioResult.usedModel,
          usedProvider: getProviderDisplayName(candidate.provider),
          fallbackUsed: i > 0,
          attemptCount: i + 1,
        });
        return;
      } catch (err) {
        if (err instanceof TtsUnsupportedByProviderError) {
          lastUnsupportedErr = err;
          continue;
        }
        const mapped = mapProviderError(err, candidate.provider);
        attemptErrors.push({
          status: mapped.status,
          message: mapped.message,
          label: getProviderDisplayName(candidate.provider),
        });
      }
    }

    if (attemptErrors.length === 0 && lastUnsupportedErr) {
      res.status(200).json({
        audioBase64: null,
        unsupportedTts: true,
        providerLabel: lastUnsupportedErr.providerLabel,
        message: lastUnsupportedErr.message,
      });
      return;
    }

    const hasRetryable = attemptErrors.some((e) => e.status === 429 || e.status === 503);
    const allClientOrAuth =
      attemptErrors.length > 0 &&
      attemptErrors.every((e) => e.status === 400 || e.status === 401 || e.status === 403);
    const finalStatus = hasRetryable ? 429 : allClientOrAuth ? 403 : attemptErrors[0]?.status ?? 500;
    const combinedMessage =
      attemptErrors.length <= 1
        ? attemptErrors[0]?.message || 'Gagal membuat audio dubbing.'
        : `Semua ${attemptErrors.length} API/provider TTS gagal (${attemptErrors
            .map((e, idx) => `[#${idx + 1} ${e.label}: ${e.message}]`)
            .join(' | ')})`;

    res.status(finalStatus).json({ error: combinedMessage });
  });

  const execFileAsync = promisify(execFile);

  async function isFfmpegAvailable(): Promise<boolean> {
    try {
      await execFileAsync('ffmpeg', ['-version'], { timeout: 4000 });
      return true;
    } catch {
      return false;
    }
  }

  async function probeMediaStreams(
    filePath: string
  ): Promise<{ hasVideo: boolean; hasAudio: boolean; durationSeconds?: number }> {
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type:format=duration',
          '-of',
          'json',
          filePath,
        ],
        { timeout: 10000 }
      );
      const parsed = JSON.parse(stdout || '{}') as {
        streams?: Array<{ codec_type?: string }>;
        format?: { duration?: string };
      };
      const types = (parsed.streams ?? [])
        .map((s) => String(s.codec_type || '').trim().toLowerCase())
        .filter(Boolean);
      const parsedDuration = Number(parsed.format?.duration);
      return {
        hasVideo: types.includes('video'),
        hasAudio: types.includes('audio'),
        durationSeconds:
          Number.isFinite(parsedDuration) && parsedDuration > 0
            ? parsedDuration
            : undefined,
      };
    } catch {
      return { hasVideo: false, hasAudio: false };
    }
  }

  app.post(
    '/api/render-mp4',
    upload.fields([
      { name: 'media', maxCount: 1 },
      { name: 'dubAudio', maxCount: 1 },
    ]),
    async (req: Request, res: Response) => {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const mediaFile = files.media?.[0];
      const dubAudioFile = files.dubAudio?.[0];
      const subtitleMode = normalizeSubtitleRenderMode(req.body?.subtitleMode);
      const assContent =
        typeof req.body?.assContent === 'string' ? req.body.assContent : '';
      const srtContent =
        typeof req.body?.srtContent === 'string' ? req.body.srtContent : '';
      const targetLanguage =
        typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage : 'id';
      const rawAudioMixMode =
        typeof req.body?.audioMixMode === 'string'
          ? req.body.audioMixMode
          : 'dubbed_only';
      const audioMixMode: RenderAudioMixMode =
        rawAudioMixMode === 'dubbed_with_bg' || rawAudioMixMode === 'original'
          ? rawAudioMixMode
          : 'dubbed_only';
      const rawDuration = Number(req.body?.durationSeconds);
      const safeDuration =
        Number.isFinite(rawDuration) && rawDuration > 0
          ? Math.min(3600, Math.max(1, rawDuration))
          : 15;

      const cleanupUploaded = async () => {
        if (mediaFile) await fs.promises.unlink(mediaFile.path).catch(() => {});
        if (dubAudioFile) await fs.promises.unlink(dubAudioFile.path).catch(() => {});
      };

      if (!(await isFfmpegAvailable())) {
        await cleanupUploaded();
        res.status(501).json({
          ffmpegUnavailable: true,
          error: 'FFmpeg tidak tersedia di server; menggunakan renderer browser.',
        });
        return;
      }

      let jobDir: string | null = null;
      try {
        jobDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voxdub-mp4-'));
        const hasAss = subtitleMode === 'hardsub' && assContent.trim().length > 0;
        if (hasAss) {
          await fs.promises.writeFile(
            path.join(jobDir, 'subtitles.ass'),
            assContent,
            'utf8'
          );
        }

        const hasSrt = subtitleMode === 'softsub' && srtContent.trim().length > 0;
        const srtFilePath = hasSrt ? path.join(jobDir, 'subtitles.srt') : undefined;
        if (srtFilePath) {
          await fs.promises.writeFile(srtFilePath, srtContent, 'utf8');
        }

        const streams = mediaFile
          ? await probeMediaStreams(mediaFile.path)
          : { hasVideo: false, hasAudio: false };

        const targetDuration =
          mediaFile && streams.hasVideo && streams.durationSeconds
            ? Math.min(3600, Math.max(1, streams.durationSeconds))
            : safeDuration;

        const outPath = path.join(jobDir, 'output.mp4');
        const args = buildFfmpegRenderArgs({
          mediaFilePath: mediaFile?.path,
          hasVideoStream: streams.hasVideo,
          hasMediaAudioStream: streams.hasAudio,
          dubAudioFilePath: dubAudioFile?.path,
          audioMixMode,
          subtitleMode,
          hasAssFile: hasAss,
          srtFilePath,
          subtitleLanguageIso: mapLangToIso639_2(targetLanguage),
          durationSeconds: targetDuration,
          outputPath: outPath,
        });

        await execFileAsync('ffmpeg', args, {
          cwd: jobDir,
          timeout: 180000,
          maxBuffer: 8 * 1024 * 1024,
        });

        const mp4Buffer = await fs.promises.readFile(outPath);
        const downloadName = getMp4DownloadFilename(
          typeof req.body?.title === 'string' ? req.body.title : 'voxdub',
          subtitleMode
        );
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${downloadName.replace(/"/g, '')}"`
        );
        res.send(mp4Buffer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal merender video MP4.';
        res.status(500).json({ error: `Render video MP4 gagal: ${msg}` });
      } finally {
        await cleanupUploaded();
        if (jobDir) {
          await fs.promises
            .rm(jobDir, { recursive: true, force: true })
            .catch(() => {});
        }
      }
    }
  );

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) {
      next(err);
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: 'Ukuran file terlalu besar (maksimal 80 MB). Silakan kompres video terlebih dahulu.',
        });
        return;
      }
      res.status(400).json({ error: `Gagal mengunggah file: ${err.message}` });
      return;
    }

    const msg = err instanceof Error ? err.message : 'Terjadi kesalahan pada server.';
    res.status(400).json({ error: msg });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*all', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VoxDub AI server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start VoxDub AI server:', err);
  process.exit(1);
});
