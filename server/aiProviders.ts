import dns from 'dns/promises';
import fs from 'fs';
import net from 'net';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  resolveAnalysisModelSelection,
  resolveTtsModelSelection,
} from '../src/utils/aiRouting.ts';

export type AiProviderId =
  | 'gemini_server'
  | 'gemini_custom'
  | 'openai'
  | 'openrouter'
  | 'groq'
  | 'anthropic'
  | 'custom_openai';

export interface AiModelOption {
  id: string;
  label: string;
}

export interface AiProviderRequestConfig {
  provider: AiProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AnalyzedSegmentRaw {
  id: number;
  startTime: number | string;
  endTime: number | string;
  originalText: string;
  translatedText: string;
  words: Array<{ word: string; start: number; end: number }>;
}

export class TtsUnsupportedByProviderError extends Error {
  providerLabel: string;
  constructor(provider: AiProviderId) {
    const label = getProviderDisplayName(provider);
    super(
      `Provider ${label} tidak menyediakan endpoint TTS audio (/audio/speech). Pemutaran dubbing dialihkan ke suara browser (Web Speech API).`
    );
    this.name = 'TtsUnsupportedByProviderError';
    this.providerLabel = label;
  }
}

const VALID_PROVIDERS = new Set<AiProviderId>([
  'gemini_server',
  'gemini_custom',
  'openai',
  'openrouter',
  'groq',
  'anthropic',
  'custom_openai',
]);

export const DEFAULT_GEMINI_SERVER_MODELS: AiModelOption[] = [
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (Multimodal Video/Audio)' },
  { id: 'gemini-4-hydrogen', label: 'gemini-4-hydrogen (Teks & Penalaran)' },
  { id: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite (Cepat)' },
];

export function getProviderDisplayName(provider: AiProviderId): string {
  switch (provider) {
    case 'gemini_server':
      return 'VoxDub Default (Gemini Server)';
    case 'gemini_custom':
      return 'Google Gemini (Custom)';
    case 'openai':
      return 'OpenAI';
    case 'openrouter':
      return 'OpenRouter';
    case 'groq':
      return 'Groq';
    case 'anthropic':
      return 'Anthropic (Claude)';
    case 'custom_openai':
      return 'Custom AI Provider';
  }
}

export function mapProviderError(
  err: unknown,
  provider: AiProviderId = 'gemini_server'
): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  const label = getProviderDisplayName(provider);

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('invalid_api_key') ||
    lower.includes('permission_denied') ||
    lower.includes('api key not valid') ||
    lower.includes('unauthorized') ||
    /\b401\b/.test(lower) ||
    /\b403\b/.test(lower)
  ) {
    return {
      status: 403,
      message:
        provider === 'gemini_server'
          ? 'API Key Gemini server tidak valid atau belum memiliki izin. Periksa pengaturan API Key di panel Settings > Secrets.'
          : `API Key ${label} tidak valid atau ditolak (401/403). Periksa API Key pada Pengaturan AI Provider.`,
    };
  }

  if (
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    /\b429\b/.test(lower)
  ) {
    return {
      status: 429,
      message: `Kuota permintaan ${label} sedang penuh (rate limit). Tunggu beberapa saat lalu coba lagi atau ganti model/provider lain.`,
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
        'Ukuran media terlalu besar untuk diproses sekaligus. Coba unggah file lebih kecil atau potong durasinya.',
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
      message: `Layanan ${label} sedang sibuk sementara (503). Tunggu beberapa detik lalu coba lagi.`,
    };
  }

  return {
    status: 500,
    message: `Gagal memproses permintaan (${label}): ${raw}`,
  };
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  if (!clean) return true;

  if (clean.startsWith('::ffff:')) {
    return isPrivateOrReservedIp(clean.slice(7));
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(clean)) return true;
    if (clean.startsWith('ff')) return true;
    return false;
  }

  return true;
}

export async function validateProviderBaseUrl(rawUrl: string): Promise<string> {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('Base URL provider wajib diisi.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Format Base URL tidak valid. Gunakan format https://...');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Base URL harus menggunakan protokol HTTPS.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Base URL tidak boleh menyertakan username atau password.');
  }

  if (parsed.search || parsed.hash) {
    throw new Error('Base URL tidak boleh menyertakan query string atau fragment.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Hostname lokal atau internal tidak diizinkan.');
  }

  const strippedHost = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(strippedHost)) {
    if (isPrivateOrReservedIp(strippedHost)) {
      throw new Error('Alamat IP privat atau loopback tidak diizinkan.');
    }
  } else {
    let resolved: Array<{ address: string }>;
    try {
      resolved = await dns.lookup(strippedHost, { all: true });
    } catch {
      throw new Error(`Hostname "${strippedHost}" tidak dapat diresolusi.`);
    }
    if (!resolved || resolved.length === 0) {
      throw new Error(`Hostname "${strippedHost}" tidak memiliki alamat IP valid.`);
    }
    for (const entry of resolved) {
      if (isPrivateOrReservedIp(entry.address)) {
        throw new Error('Alamat tujuan mengarah ke jaringan privat dan diblokir.');
      }
    }
  }

  return parsed.toString().replace(/\/+$/, '');
}

export function parseAiConfigFromRequest(raw: unknown): AiProviderRequestConfig {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }

  const rawProvider = typeof obj.provider === 'string' ? obj.provider.trim() : 'gemini_server';
  const provider: AiProviderId = VALID_PROVIDERS.has(rawProvider as AiProviderId)
    ? (rawProvider as AiProviderId)
    : 'gemini_server';

  return {
    provider,
    baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl.trim() : '',
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey.trim() : '',
    model: typeof obj.model === 'string' ? obj.model.trim() : '',
  };
}

export function parseFallbackConfigsFromRequest(
  raw: unknown,
  maxCount = 6
): AiProviderRequestConfig[] {
  let list: unknown[] = [];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  }

  return list
    .filter((item) => item && typeof item === 'object')
    .slice(0, maxCount)
    .map((item) => parseAiConfigFromRequest(item));
}

export function buildCandidateList(
  primary: AiProviderRequestConfig,
  fallbacks: AiProviderRequestConfig[],
  maxTotal = 7
): AiProviderRequestConfig[] {
  const rawList = [primary, ...fallbacks];
  const seen = new Set<string>();
  const out: AiProviderRequestConfig[] = [];

  for (const cfg of rawList) {
    const sig = `${cfg.provider}|${cfg.baseUrl}|${cfg.apiKey}|${cfg.model}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(cfg);
    if (out.length >= maxTotal) break;
  }
  return out;
}

export async function runWithServerFallback<T>(
  candidates: AiProviderRequestConfig[],
  executor: (candidate: AiProviderRequestConfig, index: number) => Promise<T>
): Promise<{
  result: T;
  usedConfig: AiProviderRequestConfig;
  fallbackUsed: boolean;
  attemptIndex: number;
}> {
  const attemptErrors: Array<{ status: number; message: string; label: string }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const result = await executor(candidate, i);
      return {
        result,
        usedConfig: candidate,
        fallbackUsed: i > 0,
        attemptIndex: i,
      };
    } catch (err) {
      const mapped = mapProviderError(err, candidate.provider);
      attemptErrors.push({
        status: mapped.status,
        message: mapped.message,
        label: getProviderDisplayName(candidate.provider),
      });
    }
  }

  const hasRetryable = attemptErrors.some((e) => e.status === 429 || e.status === 503);
  const allClientOrAuth =
    attemptErrors.length > 0 &&
    attemptErrors.every((e) => e.status === 400 || e.status === 401 || e.status === 403);
  const finalStatus = hasRetryable ? 429 : allClientOrAuth ? 403 : attemptErrors[0]?.status ?? 500;

  const combinedMessage =
    attemptErrors.length <= 1
      ? attemptErrors[0]?.message || 'Gagal memproses permintaan AI.'
      : `Semua ${attemptErrors.length} konfigurasi AI gagal (${attemptErrors
          .map((e, idx) => `[#${idx + 1} ${e.label}: ${e.message}]`)
          .join(' | ')})`;

  const finalErr = new Error(combinedMessage) as Error & { httpStatus?: number };
  finalErr.httpStatus = finalStatus;
  throw finalErr;
}

export async function fetchProviderModels(input: {
  provider: AiProviderId;
  baseUrl: string;
  apiKey: string;
}): Promise<AiModelOption[]> {
  if (input.provider === 'gemini_server') {
    return DEFAULT_GEMINI_SERVER_MODELS;
  }

  const apiKey = (input.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('API Key wajib diisi sebelum mengambil daftar model.');
  }

  const safeBaseUrl = await validateProviderBaseUrl(input.baseUrl);

  if (input.provider === 'gemini_custom') {
    const cleanRoot = safeBaseUrl.replace(/\/v1beta$/i, '');
    const res = await fetch(`${cleanRoot}/v1beta/models?pageSize=100`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(
        `Gagal fetch model Gemini (${res.status}): ${errBody.slice(0, 200) || res.statusText}`
      );
    }

    const data = (await res.json()) as {
      models?: Array<{
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
    };

    const models = (data.models ?? [])
      .filter((m) => {
        if (!m.name) return false;
        const methods = m.supportedGenerationMethods ?? [];
        return methods.length === 0 || methods.includes('generateContent');
      })
      .map((m) => {
        const id = String(m.name).replace(/^models\//, '');
        return {
          id,
          label: m.displayName ? `${id} — ${m.displayName}` : id,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 250);

    if (models.length === 0) {
      throw new Error('Provider tidak mengembalikan daftar model Gemini yang tersedia.');
    }
    return models;
  }

  if (input.provider === 'anthropic') {
    const cleanV1 = safeBaseUrl.endsWith('/v1') ? safeBaseUrl : `${safeBaseUrl}/v1`;
    const res = await fetch(`${cleanV1}/models`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(
        `Gagal fetch model Anthropic (${res.status}): ${errBody.slice(0, 200) || res.statusText}`
      );
    }

    const data = (await res.json()) as {
      data?: Array<{ id?: string; display_name?: string }>;
    };

    const models = (data.data ?? [])
      .filter((m) => typeof m.id === 'string' && m.id.trim())
      .map((m) => ({
        id: String(m.id),
        label: m.display_name ? `${m.id} — ${m.display_name}` : String(m.id),
      }))
      .slice(0, 250);

    if (models.length === 0) {
      throw new Error('Tidak ada model Anthropic yang dikembalikan oleh endpoint.');
    }
    return models;
  }

  const res = await fetch(`${safeBaseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `Gagal fetch model dari provider (${res.status}): ${errBody.slice(0, 200) || res.statusText}`
    );
  }

  const data = (await res.json()) as {
    data?: Array<{ id?: string; name?: string }>;
    models?: Array<{ id?: string; name?: string }>;
  };

  const rawList = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
    ? data.models
    : [];

  const models = rawList
    .filter((m) => typeof (m.id || m.name) === 'string' && (m.id || m.name)!.trim())
    .map((m) => {
      const id = String(m.id || m.name);
      return {
        id,
        label: m.name && m.name !== id ? `${id} — ${m.name}` : id,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 250);

  if (models.length === 0) {
    throw new Error('Endpoint tidak mengembalikan model apa pun.');
  }
  return models;
}

export async function createGeminiClientForConfig(
  aiConfig: AiProviderRequestConfig
): Promise<GoogleGenAI | null> {
  if (aiConfig.provider === 'gemini_custom') {
    if (!aiConfig.apiKey) {
      throw new Error('API Key Gemini Custom belum diisi pada pengaturan AI Provider.');
    }
    const safeUrl = await validateProviderBaseUrl(
      aiConfig.baseUrl || 'https://generativelanguage.googleapis.com'
    );
    const cleanRoot = safeUrl.replace(/\/v1beta$/i, '');
    return new GoogleGenAI({
      apiKey: aiConfig.apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        baseUrl: cleanRoot,
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  const serverKey = process.env.GEMINI_API_KEY?.trim();
  if (!serverKey) return null;
  return new GoogleGenAI({
    apiKey: serverKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function runOpenAiChat(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: unknown[];
  jsonMode?: boolean;
}): Promise<string> {
  const safeBaseUrl = await validateProviderBaseUrl(params.baseUrl);
  if (!params.apiKey) {
    throw new Error('API Key provider belum diisi.');
  }
  if (!params.model) {
    throw new Error('Model AI belum dipilih. Klik Fetch Model lalu pilih model terlebih dahulu.');
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
  };
  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${safeBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Provider mengembalikan error ${res.status}: ${errText.slice(0, 260) || res.statusText}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

async function runAnthropicChat(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemInstruction: string;
  userPrompt: string;
}): Promise<string> {
  const safeBaseUrl = await validateProviderBaseUrl(params.baseUrl);
  if (!params.apiKey) {
    throw new Error('API Key Anthropic belum diisi.');
  }
  if (!params.model) {
    throw new Error('Model Claude belum dipilih.');
  }

  const cleanV1 = safeBaseUrl.endsWith('/v1') ? safeBaseUrl : `${safeBaseUrl}/v1`;
  const res = await fetch(`${cleanV1}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 1024,
      system: params.systemInstruction,
      messages: [{ role: 'user', content: params.userPrompt }],
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Anthropic mengembalikan error ${res.status}: ${errText.slice(0, 220) || res.statusText}`
    );
  }

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const textPart = (data.content ?? []).find((c) => c.type === 'text');
  return (textPart?.text ?? '').trim();
}

export async function fixGrammarWithProvider(params: {
  text: string;
  originalText: string;
  langLabel: string;
  aiConfig: AiProviderRequestConfig;
}): Promise<string> {
  const systemInstruction = [
    `You are a strict, accurate proofreader and copyeditor for ${params.langLabel} video dubbing scripts.`,
    'Fix only spelling mistakes, typos, punctuation, and grammatical errors in the provided translated text.',
    'Preserve the exact meaning, natural spoken tone, and approximate syllable length/conciseness so it still fits the same dubbing timestamp window.',
    'Do not add commentary, extra sentences, or surrounding quotation marks. If the text is already grammatically correct, return it unchanged.',
  ].join(' ');

  const promptContent = [
    `Target language: ${params.langLabel}`,
    params.originalText ? `Source reference (for context only): ${params.originalText}` : '',
    `Translated text to proofread and fix:\n${params.text}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const resolvedTextModel = resolveAnalysisModelSelection({
    provider: params.aiConfig.provider,
    requestedModel: params.aiConfig.model,
    hasMediaAttachment: false,
  });

  if (params.aiConfig.provider === 'gemini_server' || params.aiConfig.provider === 'gemini_custom') {
    const ai = await createGeminiClientForConfig(params.aiConfig);
    if (!ai) {
      throw new Error('GEMINI_API_KEY belum dikonfigurasi di server.');
    }

    const chosenModel = resolvedTextModel || 'gemini-4-hydrogen';
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
      response = await runFixWithModel(chosenModel);
    } catch (primaryErr) {
      const msg = primaryErr instanceof Error ? primaryErr.message.toLowerCase() : '';
      const isTransient =
        params.aiConfig.provider === 'gemini_server' &&
        (msg.includes('503') ||
          msg.includes('unavailable') ||
          msg.includes('high demand') ||
          msg.includes('not_found') ||
          msg.includes('404'));
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
    return typeof parsed.correctedText === 'string' && parsed.correctedText.trim()
      ? parsed.correctedText.trim()
      : params.text;
  }

  if (params.aiConfig.provider === 'anthropic') {
    const out = await runAnthropicChat({
      baseUrl: params.aiConfig.baseUrl,
      apiKey: params.aiConfig.apiKey,
      model: resolvedTextModel,
      systemInstruction: `${systemInstruction} Return ONLY the corrected text string without quotes or explanations.`,
      userPrompt: promptContent,
    });
    return out || params.text;
  }

  const jsonPrompt = `${promptContent}\n\nRespond with a JSON object in the shape {"correctedText": "..."}.`;
  let rawOut: string;
  try {
    rawOut = await runOpenAiChat({
      baseUrl: params.aiConfig.baseUrl,
      apiKey: params.aiConfig.apiKey,
      model: resolvedTextModel,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: jsonPrompt },
      ],
      jsonMode: true,
    });
  } catch {
    rawOut = await runOpenAiChat({
      baseUrl: params.aiConfig.baseUrl,
      apiKey: params.aiConfig.apiKey,
      model: resolvedTextModel,
      messages: [
        { role: 'system', content: `${systemInstruction} Return ONLY the corrected sentence.` },
        { role: 'user', content: promptContent },
      ],
      jsonMode: false,
    });
  }

  try {
    const parsed = JSON.parse(rawOut) as { correctedText?: unknown };
    if (typeof parsed.correctedText === 'string' && parsed.correctedText.trim()) {
      return parsed.correctedText.trim();
    }
  } catch {
    // Plain text fallback
  }
  return rawOut.replace(/^["']|["']$/g, '').trim() || params.text;
}

export async function translateTextWithProvider(params: {
  text: string;
  langLabel: string;
  aiConfig: AiProviderRequestConfig;
}): Promise<string> {
  const prompt = `Translate the following spoken transcript naturally into ${params.langLabel}. Return only the translated sentence without quotes or commentary:\n\n${params.text}`;
  const resolvedTextModel = resolveAnalysisModelSelection({
    provider: params.aiConfig.provider,
    requestedModel: params.aiConfig.model,
    hasMediaAttachment: false,
  });

  if (params.aiConfig.provider === 'gemini_server' || params.aiConfig.provider === 'gemini_custom') {
    const ai = await createGeminiClientForConfig(params.aiConfig);
    if (!ai) return params.text;
    const chosenModel =
      resolvedTextModel === 'gemini-3.5-transcribe' ? 'gemini-4-hydrogen' : resolvedTextModel;
    const res = await ai.models.generateContent({
      model: chosenModel,
      contents: prompt,
    });
    return (res.text ?? '').trim() || params.text;
  }

  if (params.aiConfig.provider === 'anthropic') {
    const out = await runAnthropicChat({
      baseUrl: params.aiConfig.baseUrl,
      apiKey: params.aiConfig.apiKey,
      model: resolvedTextModel,
      systemInstruction: 'You are a concise, accurate translator.',
      userPrompt: prompt,
    });
    return out || params.text;
  }

  const out = await runOpenAiChat({
    baseUrl: params.aiConfig.baseUrl,
    apiKey: params.aiConfig.apiKey,
    model: resolvedTextModel,
    messages: [
      { role: 'system', content: 'You are a concise, accurate translator.' },
      { role: 'user', content: prompt },
    ],
  });
  return out || params.text;
}

/**
 * Call OpenAI/Groq-compatible /audio/transcriptions endpoint.
 */
async function callOpenAiWhisperTranscription(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  filePath: string;
  originalName: string;
  mimeType: string;
  verbose?: boolean;
}): Promise<{
  text: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  words?: Array<{ word: string; start: number; end: number }>;
}> {
  const safeBaseUrl = await validateProviderBaseUrl(params.baseUrl);
  const buffer = await fs.promises.readFile(params.filePath);
  const formData = new FormData();
  const blob = new Blob([buffer], { type: params.mimeType || 'audio/wav' });
  formData.append('file', blob, params.originalName || 'audio.wav');
  formData.append('model', params.model);
  if (params.verbose) {
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    formData.append('timestamp_granularities[]', 'word');
  }

  const res = await fetch(`${safeBaseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: formData,
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err = new Error(
      `Audio transcription error (${res.status}): ${errText.slice(0, 240) || res.statusText}`
    ) as Error & { httpStatus?: number };
    err.httpStatus = res.status;
    throw err;
  }

  const data = (await res.json()) as {
    text?: string;
    segments?: Array<{ start?: number; end?: number; text?: string }>;
    words?: Array<{ word?: string; start?: number; end?: number }>;
  };

  return {
    text: (data.text ?? '').trim(),
    segments: Array.isArray(data.segments)
      ? data.segments.map((s) => ({
          start: Number(s.start ?? 0),
          end: Number(s.end ?? 0),
          text: String(s.text ?? '').trim(),
        }))
      : undefined,
    words: Array.isArray(data.words)
      ? data.words.map((w) => ({
          word: String(w.word ?? '').trim(),
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
        }))
      : undefined,
  };
}

export async function transcribeAudioWithProvider(params: {
  filePath: string;
  originalName: string;
  mimeType: string;
  aiConfig: AiProviderRequestConfig;
}): Promise<string> {
  const { provider } = params.aiConfig;

  if (provider === 'gemini_server' || provider === 'gemini_custom') {
    const ai = await createGeminiClientForConfig(params.aiConfig);
    if (!ai) {
      throw new Error('GEMINI_API_KEY belum dikonfigurasi di server.');
    }
    const buffer = await fs.promises.readFile(params.filePath);
    const audioPart = {
      inlineData: {
        mimeType: params.mimeType,
        data: buffer.toString('base64'),
      },
    };

    try {
      const transcribeResponse = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [audioPart, { text: 'Transcribe this audio accurately.' }],
        },
      });
      return (transcribeResponse.text ?? '').trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (provider === 'gemini_custom' && (msg.includes('404') || msg.includes('not_found'))) {
        const fallbackModel = params.aiConfig.model || 'gemini-2.5-flash';
        const fallbackRes = await ai.models.generateContent({
          model: fallbackModel,
          contents: {
            parts: [audioPart, { text: 'Transcribe all speech in this audio accurately. Return only the spoken transcript.' }],
          },
        });
        return (fallbackRes.text ?? '').trim();
      }
      throw err;
    }
  }

  if (provider === 'anthropic') {
    throw new Error(
      'Anthropic (Claude) tidak menyediakan endpoint transkripsi audio. Pilih OpenAI, Groq, atau Gemini untuk fitur transkripsi mikrofon.'
    );
  }

  if (!params.aiConfig.apiKey) {
    throw new Error(`API Key ${getProviderDisplayName(provider)} belum diisi.`);
  }

  if (provider === 'openai' || provider === 'groq' || provider === 'custom_openai') {
    const whisperModel = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';
    try {
      const res = await callOpenAiWhisperTranscription({
        baseUrl: params.aiConfig.baseUrl,
        apiKey: params.aiConfig.apiKey,
        model: whisperModel,
        filePath: params.filePath,
        originalName: params.originalName,
        mimeType: params.mimeType,
        verbose: false,
      });
      return res.text;
    } catch (err) {
      const status = (err as { httpStatus?: number }).httpStatus;
      if (provider === 'custom_openai' && (status === 404 || status === 405)) {
        // Fallback to OpenAI multimodal chat/completions input_audio
      } else {
        throw err;
      }
    }
  }

  // Multimodal chat/completions input_audio (OpenRouter or custom OpenAI audio-capable models)
  const buffer = await fs.promises.readFile(params.filePath);
  const format = params.mimeType.includes('wav')
    ? 'wav'
    : params.mimeType.includes('mpeg') || params.mimeType.includes('mp3')
    ? 'mp3'
    : params.mimeType.includes('ogg')
    ? 'ogg'
    : 'webm';

  const resolvedMultimodalModel = resolveAnalysisModelSelection({
    provider,
    requestedModel: params.aiConfig.model,
    hasMediaAttachment: true,
  });

  const out = await runOpenAiChat({
    baseUrl: params.aiConfig.baseUrl,
    apiKey: params.aiConfig.apiKey,
    model: resolvedMultimodalModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this audio accurately. Return only the spoken transcript.' },
          {
            type: 'input_audio',
            input_audio: {
              data: buffer.toString('base64'),
              format,
            },
          },
        ],
      },
    ],
  });
  return out;
}

function buildProportionalWordsServer(
  text: string,
  startSec: number,
  endSec: number
): Array<{ word: string; start: number; end: number }> {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const safeStart = Math.max(0, startSec);
  const safeEnd = Math.max(safeStart + 0.1, endSec);
  const totalDur = safeEnd - safeStart;
  const weights = tokens.map((t) => Math.max(1, t.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let cursor = safeStart;
  return tokens.map((word, idx) => {
    const slice = (weights[idx] / totalWeight) * totalDur;
    const wStart = Number(cursor.toFixed(3));
    const wEnd = idx === tokens.length - 1 ? Number(safeEnd.toFixed(3)) : Number((cursor + slice).toFixed(3));
    cursor += slice;
    return { word, start: wStart, end: Math.max(wStart + 0.05, wEnd) };
  });
}

function extractJsonArrayFromLlm(rawText: string): unknown[] {
  const trimmed = rawText.trim();
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(fenced) as unknown;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { segments?: unknown[] }).segments)) {
    return (parsed as { segments: unknown[] }).segments;
  }
  throw new Error('Respons model tidak berupa array segmen JSON.');
}

export async function analyzeMediaWithOpenAiCompatible(params: {
  filePath: string;
  fileSize: number;
  originalName: string;
  mimeType: string;
  sourceLabel: string;
  targetLabel: string;
  aiConfig: AiProviderRequestConfig;
}): Promise<AnalyzedSegmentRaw[]> {
  const { provider, baseUrl, apiKey, model } = params.aiConfig;

  if (provider === 'anthropic') {
    throw new Error(
      'Anthropic (Claude) tidak mendukung unggahan video/audio langsung. Gunakan Gemini, OpenAI, Groq, atau OpenRouter model multimodal untuk analisis media.'
    );
  }

  if (!apiKey) {
    throw new Error(`API Key ${getProviderDisplayName(provider)} belum diisi.`);
  }
  const resolvedAnalyzeModel = resolveAnalysisModelSelection({
    provider,
    requestedModel: model,
    hasMediaAttachment: true,
  });
  if (!resolvedAnalyzeModel) {
    throw new Error('Model AI belum dipilih pada Pengaturan AI Provider.');
  }

  let whisperSegments: Array<{ start: number; end: number; text: string }> = [];
  let usedWhisper = false;

  if (provider === 'openai' || provider === 'groq' || provider === 'custom_openai') {
    const whisperModel = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';
    try {
      const whisperRes = await callOpenAiWhisperTranscription({
        baseUrl,
        apiKey,
        model: whisperModel,
        filePath: params.filePath,
        originalName: params.originalName,
        mimeType: params.mimeType,
        verbose: true,
      });
      if (whisperRes.segments && whisperRes.segments.length > 0) {
        whisperSegments = whisperRes.segments.filter((s) => s.text.length > 0);
      } else if (whisperRes.text) {
        whisperSegments = [{ start: 0, end: 5, text: whisperRes.text }];
      }
      usedWhisper = true;
    } catch (err) {
      const status = (err as { httpStatus?: number }).httpStatus;
      if (provider === 'custom_openai' && (status === 404 || status === 405)) {
        usedWhisper = false;
      } else {
        throw err;
      }
    }
  }

  if (usedWhisper) {
    if (whisperSegments.length === 0) {
      return [];
    }

    const inputPayload = whisperSegments.map((s, idx) => ({
      id: idx + 1,
      startTime: Number(s.start.toFixed(3)),
      endTime: Number((s.end > s.start ? s.end : s.start + 2.5).toFixed(3)),
      originalText: s.text,
    }));

    const systemInstruction = [
      'You are an expert audiovisual translator and dubbing script adapter.',
      `Translate each segment into ${params.targetLabel} naturally (source hint: ${params.sourceLabel}).`,
      'CRITICAL DUBBING CONSTRAINT: Adjust phrasing and syllable length so translatedText fits comfortably inside (endTime - startTime).',
      'Return a JSON object {"segments": [{"id": number, "startTime": number, "endTime": number, "originalText": string, "translatedText": string}]} preserving exact id, startTime, endTime, and originalText.',
    ].join(' ');

    const rawChat = await runOpenAiChat({
      baseUrl,
      apiKey,
      model: resolvedAnalyzeModel,
      jsonMode: true,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: JSON.stringify(inputPayload) },
      ],
    });

    const translatedArr = extractJsonArrayFromLlm(rawChat) as Array<{
      id?: number;
      startTime?: number;
      endTime?: number;
      originalText?: string;
      translatedText?: string;
    }>;

    return inputPayload.map((orig, idx) => {
      const match = translatedArr.find((t) => t.id === orig.id) ?? translatedArr[idx];
      const translatedText =
        typeof match?.translatedText === 'string' && match.translatedText.trim()
          ? match.translatedText.trim()
          : orig.originalText;
      return {
        id: orig.id,
        startTime: orig.startTime,
        endTime: orig.endTime,
        originalText: orig.originalText,
        translatedText,
        words: buildProportionalWordsServer(translatedText, orig.startTime, orig.endTime),
      };
    });
  }

  // OpenRouter / multimodal custom_openai fallback via chat/completions
  if (params.fileSize > 15 * 1024 * 1024) {
    throw new Error(
      `File melebihi 15 MB untuk pengiriman inline ke ${getProviderDisplayName(provider)}. Gunakan file di bawah 15 MB atau pilih OpenAI/Gemini.`
    );
  }

  const buffer = await fs.promises.readFile(params.filePath);
  const b64 = buffer.toString('base64');
  const isAudio = params.mimeType.startsWith('audio/');
  const mediaContent = isAudio
    ? {
        type: 'input_audio',
        input_audio: {
          data: b64,
          format: params.mimeType.includes('wav')
            ? 'wav'
            : params.mimeType.includes('mp3') || params.mimeType.includes('mpeg')
            ? 'mp3'
            : 'webm',
        },
      }
    : {
        type: 'video_url',
        video_url: {
          url: `data:${params.mimeType};base64,${b64}`,
        },
      };

  const promptText = [
    `Analyze this media. Source language hint: ${params.sourceLabel}. Target translation language: ${params.targetLabel}.`,
    'Return ONLY a JSON object {"segments": [{"id": 1, "startTime": 0.5, "endTime": 3.5, "originalText": "...", "translatedText": "...", "words": [{"word": "...", "start": 0.5, "end": 1.0}]}]}.',
    'Ensure translatedText syllable pacing fits inside (endTime - startTime) and include word-level timestamps in words.',
  ].join(' ');

  const rawOut = await runOpenAiChat({
    baseUrl,
    apiKey,
    model: resolvedAnalyzeModel,
    jsonMode: true,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: promptText }, mediaContent],
      },
    ],
  });

  const arr = extractJsonArrayFromLlm(rawOut) as AnalyzedSegmentRaw[];
  return arr.map((seg, idx) => ({
    id: typeof seg.id === 'number' ? seg.id : idx + 1,
    startTime: seg.startTime ?? 0,
    endTime: seg.endTime ?? 3,
    originalText: typeof seg.originalText === 'string' ? seg.originalText : '',
    translatedText: typeof seg.translatedText === 'string' ? seg.translatedText : '',
    words: Array.isArray(seg.words) ? seg.words : [],
  }));
}

export async function synthesizeTtsWithProvider(params: {
  text: string;
  voiceStyle: string;
  langLabel: string;
  voiceProfile: { voiceName: string; style: string };
  aiConfig: AiProviderRequestConfig;
}): Promise<{ audioBase64: string; mimeType: string; usedModel: string }> {
  const { provider, baseUrl, apiKey, model } = params.aiConfig;
  const autoTtsModel = resolveTtsModelSelection({
    provider,
    requestedModel: model,
  });

  if (provider === 'gemini_server' || provider === 'gemini_custom') {
    const ai = await createGeminiClientForConfig(params.aiConfig);
    if (!ai) {
      throw new Error('GEMINI_API_KEY belum dikonfigurasi di server.');
    }

    const extractBase64Audio = (
      response: Awaited<ReturnType<typeof ai.models.generateContent>>
    ) => {
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return {
            audioBase64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'audio/wav',
          };
        }
      }
      return null;
    };

    const ttsCandidates = Array.from(
      new Set([
        ...(autoTtsModel ? [autoTtsModel] : []),
        ...(provider === 'gemini_custom'
          ? ['gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-lite-tts']
          : ['gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts']),
      ])
    );

    let lastErr: unknown = null;
    for (const candidateModel of ttsCandidates) {
      try {
        const res = await ai.models.generateContent({
          model: candidateModel,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: params.text,
                  speechMetadata: {
                    style: `${params.voiceProfile.style}, spoken naturally in ${params.langLabel}`,
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
                  voiceName: params.voiceProfile.voiceName,
                },
              },
            },
          },
        });
        const audio = extractBase64Audio(res);
        if (audio) return { ...audio, usedModel: candidateModel };
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (msg.includes('speechmetadata') || msg.includes('unknown name')) {
          try {
            const retryRes = await ai.models.generateContent({
              model: candidateModel,
              contents: [{ role: 'user', parts: [{ text: params.text }] }],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: params.voiceProfile.voiceName,
                    },
                  },
                },
              },
            });
            const audio = extractBase64Audio(retryRes);
            if (audio) return { ...audio, usedModel: candidateModel };
          } catch (retryErr) {
            lastErr = retryErr;
            const retryMsg = retryErr instanceof Error ? retryErr.message.toLowerCase() : '';
            if (retryMsg.includes('404') || retryMsg.includes('not_found')) continue;
            throw retryErr;
          }
        } else if (msg.includes('404') || msg.includes('not_found')) {
          lastErr = err;
          continue;
        } else {
          throw err;
        }
      }
    }

    if (lastErr) throw lastErr;
    throw new Error('Model TTS Gemini tidak mengembalikan data audio.');
  }

  if (provider === 'openrouter' || provider === 'anthropic') {
    throw new TtsUnsupportedByProviderError(provider);
  }

  // OpenAI, Groq, Custom OpenAI-compatible (/audio/speech)
  if (!apiKey) {
    throw new Error(`API Key ${getProviderDisplayName(provider)} belum diisi.`);
  }
  const safeBaseUrl = await validateProviderBaseUrl(baseUrl);

  const openAiVoice =
    params.voiceStyle === 'female_friendly'
      ? 'nova'
      : params.voiceStyle === 'narrator_casual'
      ? 'alloy'
      : 'onyx';
  const groqVoice =
    params.voiceStyle === 'female_friendly'
      ? 'Celeste-PlayAI'
      : params.voiceStyle === 'narrator_casual'
      ? 'Arista-PlayAI'
      : 'Fritz-PlayAI';

  const chosenTtsModel =
    autoTtsModel || (provider === 'groq' ? 'playai-tts' : 'tts-1');

  const attemptSpeech = async (responseFormat: 'wav' | 'mp3', voice: string, ttsModel: string) => {
    const res = await fetch(`${safeBaseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: ttsModel,
        input: params.text,
        voice,
        response_format: responseFormat,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(
        `TTS ${getProviderDisplayName(provider)} error (${res.status}): ${errText.slice(0, 220) || res.statusText}`
      ) as Error & { httpStatus?: number };
      err.httpStatus = res.status;
      throw err;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type')?.split(';')[0].trim() ||
      (responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav');
    return {
      audioBase64: buf.toString('base64'),
      mimeType: contentType,
      usedModel: ttsModel,
    };
  };

  const primaryVoice = provider === 'groq' ? groqVoice : openAiVoice;
  try {
    return await attemptSpeech('wav', primaryVoice, chosenTtsModel);
  } catch (firstErr) {
    const status = (firstErr as { httpStatus?: number }).httpStatus;
    const msg = firstErr instanceof Error ? firstErr.message.toLowerCase() : '';
    if (status === 404 || status === 405 || status === 501) {
      throw new TtsUnsupportedByProviderError(provider);
    }
    if (status === 400 && (msg.includes('format') || msg.includes('wav'))) {
      return await attemptSpeech('mp3', primaryVoice, chosenTtsModel);
    }
    if (provider === 'groq' && status === 400) {
      throw new TtsUnsupportedByProviderError(provider);
    }
    throw firstErr;
  }
}
