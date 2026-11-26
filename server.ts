import 'dotenv/config';
import { execFile } from 'child_process';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import {
  analyzeMediaWithOpenAiCompatible,
  buildCandidateList,
  createGeminiClientForConfig,
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
import { resolveAnalysisModelSelection } from './src/utils/aiRouting.ts';
import {
  buildFfmpegRenderArgs,
  getMp4DownloadFilename,
  mapLangToIso639_2,
  normalizeSubtitleRenderMode,
  type RenderAudioMixMode,
} from './src/utils/mp4RenderConfig.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_SIZE_BYTES = 80 * 1024 * 1024; // 80 MB limit
const INLINE_THRESHOLD_BYTES = 15 * 1024 * 1024; // 15 MB threshold for inlineData vs File API

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

function formatSecondsToTimestampServer(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  if (millis === 1000) {
    return formatSecondsToTimestampServer(Math.floor(safe) + 1);
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function parseSecondsServer(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) return val;
  if (typeof val === 'string') {
    const clean = val.trim().replace(',', '.');
    const parts = clean.split(':');
    if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const s = Number(parts[2]);
      if (![h, m, s].some(Number.isNaN)) return h * 3600 + m * 60 + s;
    }
    if (parts.length === 2) {
      const m = Number(parts[0]);
      const s = Number(parts[1]);
      if (![m, s].some(Number.isNaN)) return m * 60 + s;
    }
    const n = Number(clean);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return 0;
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

async function runAnalyzeWithModel(
  ai: GoogleGenAI,
  model: string,
  mediaPart: Record<string, unknown>,
  promptText: string,
  systemInstruction: string
) {
  return ai.models.generateContent({
    model,
    contents: {
      parts: [mediaPart, { text: promptText }],
    },
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: {
              type: Type.INTEGER,
              description: 'Sequential segment index starting at 1',
            },
            startTime: {
              type: Type.NUMBER,
              description: 'Segment start time in seconds, e.g. 1.0',
            },
            endTime: {
              type: Type.NUMBER,
              description: 'Segment end time in seconds, e.g. 4.5',
            },
            originalText: {
              type: Type.STRING,
              description: 'Transcribed speech in the source language',
            },
            translatedText: {
              type: Type.STRING,
              description: 'Natural translation with syllable length proportional to segment duration',
            },
            words: {
              type: Type.ARRAY,
              description: 'Word-level timestamps for every word in translatedText',
              items: {
                type: Type.OBJECT,
                properties: {
                  word: {
                    type: Type.STRING,
                    description: 'Individual word token from translatedText',
                  },
                  start: {
                    type: Type.NUMBER,
                    description: 'Word start time in seconds within [startTime, endTime]',
                  },
                  end: {
                    type: Type.NUMBER,
                    description: 'Word end time in seconds within [startTime, endTime]',
                  },
                },
                required: ['word', 'start', 'end'],
              },
            },
          },
          required: ['id', 'startTime', 'endTime', 'originalText', 'translatedText', 'words'],
        },
      },
    },
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
    const sourceLabel = LANGUAGE_LABELS[sourceLang] ?? sourceLang;
    const targetLabel = LANGUAGE_LABELS[targetLang] ?? targetLang;
    const mimeType = normalizeMimeType(file.mimetype, file.originalname);

    const normalizeAnalyzedSegments = (rawList: unknown[]) =>
      rawList.map((rawItem, idx) => {
        const item = (rawItem ?? {}) as {
          id?: unknown;
          startTime?: unknown;
          endTime?: unknown;
          originalText?: unknown;
          translatedText?: unknown;
          words?: unknown;
        };
        const startSec = parseSecondsServer(item.startTime);
        const rawEnd = parseSecondsServer(item.endTime);
        const endSec = rawEnd > startSec ? rawEnd : startSec + 2.5;
        const words = Array.isArray(item.words)
          ? item.words
              .filter((w: unknown) => w && typeof (w as { word?: unknown }).word === 'string')
              .map((w: { word: string; start?: number; end?: number }) => {
                const ws = Math.max(startSec, Math.min(endSec, parseSecondsServer(w.start)));
                const we = Math.max(ws + 0.05, Math.min(endSec, parseSecondsServer(w.end)));
                return {
                  word: String(w.word).trim(),
                  start: Number(ws.toFixed(3)),
                  end: Number(we.toFixed(3)),
                };
              })
          : [];

        return {
          id: typeof item.id === 'number' ? item.id : idx + 1,
          startTime: formatSecondsToTimestampServer(startSec),
          endTime: formatSecondsToTimestampServer(endSec),
          originalText: typeof item.originalText === 'string' ? item.originalText.trim() : '',
          translatedText: typeof item.translatedText === 'string' ? item.translatedText.trim() : '',
          words,
        };
      });

    const analyzeWithSingleCandidate = async (candidate: AiProviderRequestConfig) => {
      const resolvedModel = resolveAnalysisModelSelection({
        provider: candidate.provider,
        requestedModel: candidate.model,
        hasMediaAttachment: true,
      });

      if (candidate.provider !== 'gemini_server' && candidate.provider !== 'gemini_custom') {
        const rawSegments = await analyzeMediaWithOpenAiCompatible({
          filePath: file.path,
          fileSize: file.size,
          originalName: file.originalname,
          mimeType,
          sourceLabel,
          targetLabel,
          aiConfig: { ...candidate, model: resolvedModel },
        });
        return {
          segments: normalizeAnalyzedSegments(rawSegments),
          usedModel: resolvedModel,
        };
      }

      const ai = await createGeminiClientForConfig(candidate);
      if (!ai) {
        throw new Error('GEMINI_API_KEY belum dikonfigurasi di server. Atur di panel Settings > Secrets.');
      }

      let uploadedFileName: string | null = null;
      try {
        let mediaPart: Record<string, unknown>;

        if (file.size <= INLINE_THRESHOLD_BYTES) {
          const buffer = await fs.promises.readFile(file.path);
          mediaPart = {
            inlineData: {
              mimeType,
              data: buffer.toString('base64'),
            },
          };
        } else {
          const uploaded = await ai.files.upload({
            file: file.path,
            config: { mimeType },
          });
          uploadedFileName = uploaded.name ?? null;

          let currentFile = uploaded;
          const startPoll = Date.now();
          while (currentFile.state === 'PROCESSING') {
            if (Date.now() - startPoll > 90000) {
              throw new Error('Waktu pemrosesan file di Gemini File API habis.');
            }
            await new Promise((r) => setTimeout(r, 2000));
            if (!currentFile.name) break;
            currentFile = await ai.files.get({ name: currentFile.name });
          }

          if (currentFile.state === 'FAILED') {
            throw new Error('Gemini File API gagal memproses file media ini.');
          }

          mediaPart = {
            fileData: {
              mimeType: currentFile.mimeType || mimeType,
              fileUri: currentFile.uri,
            },
          };
        }

        const systemInstruction = [
          'You are an expert audiovisual translator and dubbing script adapter.',
          'Transcribe all spoken dialogue accurately into chronological segments with numeric startTime and endTime in seconds.',
          'Translate each segment into the requested target language naturally.',
          'CRITICAL DUBBING CONSTRAINT: Adjust the phrasing and syllable count of translatedText so that when spoken aloud at a normal pace, it fits proportionally inside (endTime - startTime).',
          'CRITICAL WORD-LEVEL TIMESTAMPS: Include a "words" array for EVERY word in translatedText, with exact numeric "start" and "end" timestamps in seconds strictly ordered inside [startTime, endTime].',
        ].join(' ');

        const promptText = `Analyze this media. Source language hint: ${sourceLabel}. Target translation language: ${targetLabel}. Return the structured JSON array of segments including word-level timestamps ("words") for translatedText.`;

        let usedAnalyzeModel = resolvedModel;
        let response;
        try {
          response = await runAnalyzeWithModel(
            ai,
            resolvedModel,
            mediaPart,
            promptText,
            systemInstruction
          );
        } catch (primaryErr) {
          const msg = primaryErr instanceof Error ? primaryErr.message.toLowerCase() : '';
          if (
            candidate.provider === 'gemini_server' &&
            (msg.includes('not_found') || msg.includes('404') || msg.includes('not found'))
          ) {
            usedAnalyzeModel = 'gemini-4-hydrogen';
            response = await runAnalyzeWithModel(
              ai,
              usedAnalyzeModel,
              mediaPart,
              promptText,
              systemInstruction
            );
          } else {
            throw primaryErr;
          }
        }

        const rawText = (response.text ?? '[]').trim();
        const parsed = JSON.parse(rawText);
        if (!Array.isArray(parsed)) {
          throw new Error('Format respons Gemini tidak berupa array segmen.');
        }

        return {
          segments: normalizeAnalyzedSegments(parsed),
          usedModel: usedAnalyzeModel,
        };
      } finally {
        if (uploadedFileName) {
          await ai.files.delete({ name: uploadedFileName }).catch(() => {});
        }
      }
    };

    try {
      const outcome = await runWithServerFallback(candidates, (candidate) =>
        analyzeWithSingleCandidate(candidate)
      );
      res.json({
        segments: outcome.result.segments,
        usedModel: outcome.result.usedModel,
        usedProvider: getProviderDisplayName(outcome.usedConfig.provider),
        fallbackUsed: outcome.fallbackUsed,
        attemptCount: outcome.attemptIndex + 1,
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
