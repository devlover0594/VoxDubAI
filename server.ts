import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
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

function getGeminiClient(apiVersion = 'v1beta'): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    apiVersion,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

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

function mapGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('api key not valid') ||
    lower.includes('403')
  ) {
    return {
      status: 403,
      message:
        'API Key Gemini tidak valid atau belum memiliki izin. Periksa pengaturan API Key Anda di panel Settings > Secrets.',
    };
  }

  if (
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('429')
  ) {
    return {
      status: 429,
      message:
        'Kuota permintaan Gemini API sedang penuh (rate limit). Tunggu beberapa saat lalu coba lagi.',
    };
  }

  if (
    lower.includes('entity too large') ||
    lower.includes('payload too large') ||
    lower.includes('request entity too large') ||
    /\b413\b/.test(lower)
  ) {
    return {
      status: 413,
      message:
        'Ukuran media terlalu besar untuk diproses sekaligus. Coba unggah video di bawah 80 MB atau potong durasinya.',
    };
  }

  if (
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    /\b503\b/.test(lower)
  ) {
    return {
      status: 503,
      message:
        'Layanan Gemini API sedang sibuk sementara (503). Tunggu beberapa detik lalu coba lagi.',
    };
  }

  return {
    status: 500,
    message: `Gagal memproses permintaan AI: ${raw}`,
  };
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

  app.post('/api/analyze', upload.single('media'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Tidak ada file video atau audio yang diunggah.' });
      return;
    }

    const ai = getGeminiClient('v1beta');
    if (!ai) {
      await fs.promises.unlink(file.path).catch(() => {});
      res.status(400).json({
        error: 'GEMINI_API_KEY belum dikonfigurasi di server. Atur di panel Settings > Secrets.',
      });
      return;
    }

    const sourceLang = typeof req.body?.sourceLanguage === 'string' ? req.body.sourceLanguage : 'auto';
    const targetLang = typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage : 'id';
    const sourceLabel = LANGUAGE_LABELS[sourceLang] ?? sourceLang;
    const targetLabel = LANGUAGE_LABELS[targetLang] ?? targetLang;
    const mimeType = normalizeMimeType(file.mimetype, file.originalname);

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

      let response;
      try {
        response = await runAnalyzeWithModel(
          ai,
          'gemini-2.5-flash',
          mediaPart,
          promptText,
          systemInstruction
        );
      } catch (primaryErr) {
        const msg = primaryErr instanceof Error ? primaryErr.message.toLowerCase() : '';
        if (msg.includes('not_found') || msg.includes('404') || msg.includes('not found')) {
          response = await runAnalyzeWithModel(
            ai,
            'gemini-4-hydrogen',
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

      const segments = parsed.map((item, idx) => {
        const startSec = parseSecondsServer(item?.startTime);
        const rawEnd = parseSecondsServer(item?.endTime);
        const endSec = rawEnd > startSec ? rawEnd : startSec + 2.5;
        const words = Array.isArray(item?.words)
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
          id: typeof item?.id === 'number' ? item.id : idx + 1,
          startTime: formatSecondsToTimestampServer(startSec),
          endTime: formatSecondsToTimestampServer(endSec),
          originalText: typeof item?.originalText === 'string' ? item.originalText.trim() : '',
          translatedText: typeof item?.translatedText === 'string' ? item.translatedText.trim() : '',
          words,
        };
      });

      res.json({ segments });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message });
    } finally {
      await fs.promises.unlink(file.path).catch(() => {});
      if (uploadedFileName) {
        await ai.files.delete({ name: uploadedFileName }).catch(() => {});
      }
    }
  });

  /**
   * Microphone Audio Transcription using gemini-3.5-transcribe
   * Optionally translates the transcript into targetLanguage with word-level timestamps.
   */
  app.post('/api/transcribe-mic', upload.single('audio'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Tidak ada rekaman audio mikrofon yang diterima.' });
      return;
    }

    const ai = getGeminiClient('v1beta');
    if (!ai) {
      await fs.promises.unlink(file.path).catch(() => {});
      res.status(400).json({
        error: 'GEMINI_API_KEY belum dikonfigurasi di server.',
      });
      return;
    }

    const targetLang = typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage : 'id';
    const targetLabel = LANGUAGE_LABELS[targetLang] ?? targetLang;
    const mimeType = normalizeMimeType(file.mimetype, file.originalname || 'mic.webm');

    try {
      const buffer = await fs.promises.readFile(file.path);
      const audioPart = {
        inlineData: {
          mimeType,
          data: buffer.toString('base64'),
        },
      };

      const transcribeResponse = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [audioPart, { text: 'Transcribe this audio accurately.' }],
        },
      });

      const transcript = (transcribeResponse.text ?? '').trim();
      if (!transcript) {
        res.status(422).json({
          error: 'Tidak ada ucapan yang terdengar pada rekaman mikrofon. Coba rekam ulang dengan suara lebih jelas.',
        });
        return;
      }

      // Translate transcript into targetLanguage cleanly
      let translatedText = transcript;
      try {
        const translateRes = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Translate the following spoken transcript naturally into ${targetLabel}. Return only the translated sentence without quotes or commentary:\n\n${transcript}`,
        });
        const translatedCandidate = (translateRes.text ?? '').trim();
        if (translatedCandidate) {
          translatedText = translatedCandidate;
        }
      } catch {
        // Keep transcript as fallback if translation fails
      }

      res.json({
        transcript,
        translatedText,
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message });
    } finally {
      await fs.promises.unlink(file.path).catch(() => {});
    }
  });

  app.post('/api/fix-grammar', async (req: Request, res: Response) => {
    const ai = getGeminiClient('v1beta');
    if (!ai) {
      res.status(400).json({
        error: 'GEMINI_API_KEY belum dikonfigurasi di server.',
      });
      return;
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const originalText = typeof req.body?.originalText === 'string' ? req.body.originalText.trim() : '';
    const targetLanguage = typeof req.body?.targetLanguage === 'string' ? req.body.targetLanguage : 'id';

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
      const systemInstruction = [
        `You are a strict, accurate proofreader and copyeditor for ${langLabel} video dubbing scripts.`,
        'Fix only spelling mistakes, typos, punctuation, and grammatical errors in the provided translated text.',
        'Preserve the exact meaning, natural spoken tone, and approximate syllable length/conciseness so it still fits the same dubbing timestamp window.',
        'Do not add commentary, extra sentences, or surrounding quotation marks. If the text is already grammatically correct, return it unchanged.',
      ].join(' ');

      const promptParts = [
        `Target language: ${langLabel}`,
        originalText ? `Source reference (for context only): ${originalText}` : '',
        `Translated text to proofread and fix:\n${text}`,
      ].filter(Boolean);

      const promptContent = promptParts.join('\n\n');
      const runFixWithModel = (modelName: string) =>
        ai.models.generateContent({
          model: modelName,
          contents: promptContent,
          config: {
            systemInstruction,
            ...(modelName === 'gemini-4-hydrogen'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                correctedText: {
                  type: Type.STRING,
                  description: 'The spelling- and grammar-corrected version of the translated text.',
                },
              },
              required: ['correctedText'],
            },
          },
        });

      let response;
      try {
        response = await runFixWithModel('gemini-4-hydrogen');
      } catch (primaryErr) {
        const msg = primaryErr instanceof Error ? primaryErr.message.toLowerCase() : '';
        const isTransient =
          msg.includes('503') ||
          msg.includes('unavailable') ||
          msg.includes('high demand') ||
          msg.includes('not_found') ||
          msg.includes('404');
        if (isTransient) {
          await new Promise((r) => setTimeout(r, 700));
          try {
            response = await runFixWithModel('gemini-3.1-flash-lite');
          } catch {
            await new Promise((r) => setTimeout(r, 1200));
            response = await runFixWithModel('gemini-4-hydrogen');
          }
        } else {
          throw primaryErr;
        }
      }

      const raw = (response.text ?? '{}').trim();
      const parsed = JSON.parse(raw) as { correctedText?: unknown };
      const correctedText =
        typeof parsed.correctedText === 'string' && parsed.correctedText.trim()
          ? parsed.correctedText.trim()
          : text;

      res.json({ correctedText });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.post('/api/tts', async (req: Request, res: Response) => {
    const ai = getGeminiClient('v1beta');
    if (!ai) {
      res.status(400).json({
        error: 'GEMINI_API_KEY belum dikonfigurasi di server.',
      });
      return;
    }

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

    const extractBase64Audio = (response: Awaited<ReturnType<typeof ai.models.generateContent>>) => {
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return {
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'audio/wav',
          };
        }
      }
      return null;
    };

    try {
      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text,
                  speechMetadata: {
                    style: `${voiceProfile.style}, spoken naturally in ${langLabel}`,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voiceProfile.voiceName,
                },
              },
            },
          },
        });
      } catch (primaryErr) {
        const msg = primaryErr instanceof Error ? primaryErr.message.toLowerCase() : '';
        if (msg.includes('speechmetadata') || msg.includes('unknown name') || msg.includes('not_found') || msg.includes('404')) {
          const fallbackModel =
            msg.includes('not_found') || msg.includes('404')
              ? 'gemini-2.5-flash-preview-tts'
              : 'gemini-3.8-flash-lite-tts';
          response = await ai.models.generateContent({
            model: fallbackModel,
            contents: [
              {
                role: 'user',
                parts: [{ text }],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voiceProfile.voiceName,
                  },
                },
              },
            },
          });
        } else {
          throw primaryErr;
        }
      }

      const audioResult = extractBase64Audio(response);
      if (!audioResult) {
        res.status(502).json({
          error: 'Model TTS tidak mengembalikan data audio. Silakan coba lagi.',
        });
        return;
      }

      res.json({
        audioBase64: audioResult.data,
        mimeType: audioResult.mimeType,
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

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
