import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import {
  AI_PROVIDER_PRESETS,
  AUTO_MODEL_ID,
  DEFAULT_AI_PROVIDER_CONFIG,
  DEFAULT_SERVER_MODELS,
  DEFAULT_SERVER_TTS_MODELS,
  type AiFallbackTarget,
  type AiModelOption,
  type AiProviderConfig,
  type AiProviderId,
  type TtsRoutingMode,
} from '../types/dubbing';
import {
  resolveAnalysisModelSelection,
  resolveTtsModelSelection,
} from '../utils/aiRouting';

interface AiProviderModalProps {
  isOpen: boolean;
  config: AiProviderConfig;
  onClose: () => void;
  onSave: (nextConfig: AiProviderConfig) => void;
}

const TTS_CAPABLE_PRESETS = AI_PROVIDER_PRESETS.filter((p) => p.supportsNativeTts);

function createFallbackId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function AiProviderModal({
  isOpen,
  config,
  onClose,
  onSave,
}: AiProviderModalProps) {
  // Peran 1: Analisis, Transkrip & Terjemahan
  const [provider, setProvider] = useState<AiProviderId>(config.provider);
  const [baseUrl, setBaseUrl] = useState<string>(config.baseUrl);
  const [apiKey, setApiKey] = useState<string>(config.apiKey);
  const [analyzeModel, setAnalyzeModel] = useState<string>(
    config.analyzeModel || config.model || AUTO_MODEL_ID
  );
  const [availableModels, setAvailableModels] = useState<AiModelOption[]>(
    config.availableModels
  );
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [useManualAnalyzeModel, setUseManualAnalyzeModel] = useState<boolean>(false);
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);
  const [fetchStatus, setFetchStatus] = useState<string | null>(null);
  const [analysisFallbacks, setAnalysisFallbacks] = useState<AiFallbackTarget[]>(
    config.analysisFallbacks || []
  );

  // Peran 2: Sulih Suara (TTS)
  const [ttsMode, setTtsMode] = useState<TtsRoutingMode>(config.ttsMode || 'same');
  const [ttsProvider, setTtsProvider] = useState<AiProviderId>(
    config.ttsProvider || 'gemini_server'
  );
  const [ttsBaseUrl, setTtsBaseUrl] = useState<string>(config.ttsBaseUrl || '');
  const [ttsApiKey, setTtsApiKey] = useState<string>(config.ttsApiKey || '');
  const [ttsModel, setTtsModel] = useState<string>(config.ttsModel || AUTO_MODEL_ID);
  const [ttsAvailableModels, setTtsAvailableModels] = useState<AiModelOption[]>(
    config.ttsAvailableModels?.length ? config.ttsAvailableModels : DEFAULT_SERVER_TTS_MODELS
  );
  const [showTtsApiKey, setShowTtsApiKey] = useState<boolean>(false);
  const [useManualTtsModel, setUseManualTtsModel] = useState<boolean>(false);
  const [isFetchingTtsModels, setIsFetchingTtsModels] = useState<boolean>(false);
  const [ttsFetchStatus, setTtsFetchStatus] = useState<string | null>(null);
  const [ttsFallbacks, setTtsFallbacks] = useState<AiFallbackTarget[]>(
    config.ttsFallbacks || []
  );

  const [revealedFallbackKeys, setRevealedFallbackKeys] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setProvider(config.provider);
    setBaseUrl(config.baseUrl);
    setApiKey(config.apiKey);
    setAnalyzeModel(config.analyzeModel || config.model || AUTO_MODEL_ID);
    setAvailableModels(config.availableModels);
    setShowApiKey(false);
    setUseManualAnalyzeModel(false);
    setFetchStatus(null);
    setAnalysisFallbacks(config.analysisFallbacks || []);

    setTtsMode(config.ttsMode || 'same');
    setTtsProvider(config.ttsProvider || 'gemini_server');
    setTtsBaseUrl(config.ttsBaseUrl || '');
    setTtsApiKey(config.ttsApiKey || '');
    setTtsModel(config.ttsModel || AUTO_MODEL_ID);
    setTtsAvailableModels(
      config.ttsAvailableModels?.length
        ? config.ttsAvailableModels
        : DEFAULT_SERVER_TTS_MODELS
    );
    setShowTtsApiKey(false);
    setUseManualTtsModel(false);
    setTtsFetchStatus(null);
    setTtsFallbacks(config.ttsFallbacks || []);
    setRevealedFallbackKeys({});
    setErrorMsg(null);
  }, [config, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const activePreset =
    AI_PROVIDER_PRESETS.find((p) => p.id === provider) ?? AI_PROVIDER_PRESETS[0];

  const effectiveTtsProvider = ttsMode === 'custom_tts' ? ttsProvider : provider;
  const activeTtsPreset =
    AI_PROVIDER_PRESETS.find((p) => p.id === effectiveTtsProvider) ??
    AI_PROVIDER_PRESETS[0];

  const previewAutoAnalyzeModel = useMemo(
    () =>
      resolveAnalysisModelSelection({
        provider,
        requestedModel: AUTO_MODEL_ID,
        availableModels,
        hasMediaAttachment: true,
      }),
    [availableModels, provider]
  );

  const previewAutoTtsModel = useMemo(
    () =>
      resolveTtsModelSelection({
        provider: effectiveTtsProvider,
        requestedModel: AUTO_MODEL_ID,
        availableModels: ttsMode === 'custom_tts' ? ttsAvailableModels : availableModels,
      }),
    [availableModels, effectiveTtsProvider, ttsAvailableModels, ttsMode]
  );

  if (!isOpen) return null;

  const handleProviderChange = (nextProvider: AiProviderId) => {
    setProvider(nextProvider);
    setFetchStatus(null);
    setErrorMsg(null);
    setUseManualAnalyzeModel(false);

    const preset =
      AI_PROVIDER_PRESETS.find((p) => p.id === nextProvider) ??
      AI_PROVIDER_PRESETS[0];

    if (nextProvider === 'gemini_server') {
      setBaseUrl('');
      setAvailableModels(DEFAULT_SERVER_MODELS);
    } else {
      setBaseUrl(preset.defaultBaseUrl);
      const fallbackModels = preset.defaultModel
        ? [{ id: preset.defaultModel, label: `${preset.defaultModel} (Default)` }]
        : [];
      setAvailableModels(fallbackModels);
    }
    setAnalyzeModel(AUTO_MODEL_ID);

    if (!preset.supportsNativeTts && ttsMode === 'same') {
      setTtsMode('custom_tts');
      setTtsProvider('gemini_server');
      setTtsBaseUrl('');
      setTtsApiKey('');
      setTtsAvailableModels(DEFAULT_SERVER_TTS_MODELS);
      setTtsModel(AUTO_MODEL_ID);
    } else if (ttsMode === 'same') {
      setTtsModel(AUTO_MODEL_ID);
    }
  };

  const handleTtsProviderChange = (nextTtsProvider: AiProviderId) => {
    setTtsProvider(nextTtsProvider);
    setTtsFetchStatus(null);
    setErrorMsg(null);
    setUseManualTtsModel(false);
    setTtsModel(AUTO_MODEL_ID);

    const preset =
      AI_PROVIDER_PRESETS.find((p) => p.id === nextTtsProvider) ??
      AI_PROVIDER_PRESETS[0];

    if (nextTtsProvider === 'gemini_server') {
      setTtsBaseUrl('');
      setTtsAvailableModels(DEFAULT_SERVER_TTS_MODELS);
    } else {
      setTtsBaseUrl(preset.defaultBaseUrl);
      setTtsAvailableModels(
        preset.defaultTtsModel
          ? [{ id: preset.defaultTtsModel, label: `${preset.defaultTtsModel} (Default TTS)` }]
          : []
      );
    }
  };

  const handleFetchModels = async (role: 'analysis' | 'tts') => {
    setErrorMsg(null);
    if (role === 'analysis') setFetchStatus(null);
    else setTtsFetchStatus(null);

    const targetProvider = role === 'analysis' ? provider : ttsProvider;
    const targetPreset =
      AI_PROVIDER_PRESETS.find((p) => p.id === targetProvider) ??
      AI_PROVIDER_PRESETS[0];
    const targetUrl = (role === 'analysis' ? baseUrl : ttsBaseUrl).trim();
    const rawKey = (role === 'analysis' ? apiKey : ttsApiKey).trim();
    const firstKey = rawKey.split(/[\r\n;]+/)[0]?.trim() || '';

    if (targetPreset.requiresKey) {
      if (!targetUrl) {
        setErrorMsg(
          `Base URL ${role === 'tts' ? 'TTS ' : ''}wajib diisi sebelum melakukan Fetch Model.`
        );
        return;
      }
      if (!firstKey) {
        setErrorMsg(
          `API Key ${role === 'tts' ? 'TTS ' : ''}wajib diisi sebelum melakukan Fetch Model.`
        );
        return;
      }
    }

    if (role === 'analysis') setIsFetchingModels(true);
    else setIsFetchingTtsModels(true);

    try {
      const res = await fetch('/api/ai/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: targetProvider,
          baseUrl: targetUrl,
          apiKey: firstKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal mengambil daftar model dari provider.');
      }

      const list: AiModelOption[] = Array.isArray(data?.models) ? data.models : [];
      if (list.length === 0) {
        throw new Error('Provider tidak mengembalikan daftar model yang tersedia.');
      }

      if (role === 'analysis') {
        setAvailableModels(list);
        setUseManualAnalyzeModel(false);
        setFetchStatus(
          `Berhasil mengambil ${list.length} model untuk Analisis (${targetPreset.label}).`
        );
      } else {
        setTtsAvailableModels(list);
        setUseManualTtsModel(false);
        setTtsFetchStatus(
          `Berhasil mengambil ${list.length} model untuk TTS (${targetPreset.label}).`
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Terjadi kesalahan saat mengambil daftar model.'
      );
    } finally {
      if (role === 'analysis') setIsFetchingModels(false);
      else setIsFetchingTtsModels(false);
    }
  };

  const addFallbackItem = (role: 'analysis' | 'tts') => {
    setErrorMsg(null);
    if (role === 'analysis') {
      const defaultFbProvider = provider;
      const preset =
        AI_PROVIDER_PRESETS.find((p) => p.id === defaultFbProvider) ??
        AI_PROVIDER_PRESETS[0];
      setAnalysisFallbacks((prev) => [
        ...prev,
        {
          id: createFallbackId('fb_ana'),
          provider: defaultFbProvider,
          baseUrl: baseUrl.trim() || preset.defaultBaseUrl,
          apiKey: '',
          model: AUTO_MODEL_ID,
        },
      ]);
    } else {
      const preferredFbProvider = activeTtsPreset.supportsNativeTts
        ? effectiveTtsProvider
        : 'gemini_server';
      const preset =
        AI_PROVIDER_PRESETS.find((p) => p.id === preferredFbProvider) ??
        AI_PROVIDER_PRESETS[0];
      setTtsFallbacks((prev) => [
        ...prev,
        {
          id: createFallbackId('fb_tts'),
          provider: preferredFbProvider,
          baseUrl:
            ttsMode === 'custom_tts'
              ? ttsBaseUrl.trim() || preset.defaultBaseUrl
              : baseUrl.trim() || preset.defaultBaseUrl,
          apiKey: '',
          model: AUTO_MODEL_ID,
        },
      ]);
    }
  };

  const updateFallbackItem = (
    role: 'analysis' | 'tts',
    id: string,
    patch: Partial<AiFallbackTarget>
  ) => {
    const updater = (prev: AiFallbackTarget[]) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (patch.provider && patch.provider !== item.provider) {
          const preset =
            AI_PROVIDER_PRESETS.find((p) => p.id === patch.provider) ??
            AI_PROVIDER_PRESETS[0];
          return {
            ...item,
            ...patch,
            baseUrl: preset.defaultBaseUrl,
            model: AUTO_MODEL_ID,
          };
        }
        return { ...item, ...patch };
      });

    if (role === 'analysis') setAnalysisFallbacks(updater);
    else setTtsFallbacks(updater);
  };

  const moveFallbackItem = (role: 'analysis' | 'tts', idx: number, dir: -1 | 1) => {
    const updater = (prev: AiFallbackTarget[]) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[idx];
      copy[idx] = copy[target];
      copy[target] = temp;
      return copy;
    };
    if (role === 'analysis') setAnalysisFallbacks(updater);
    else setTtsFallbacks(updater);
  };

  const removeFallbackItem = (role: 'analysis' | 'tts', id: string) => {
    if (role === 'analysis') {
      setAnalysisFallbacks((prev) => prev.filter((item) => item.id !== id));
    } else {
      setTtsFallbacks((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (activePreset.requiresKey) {
      if (!baseUrl.trim()) {
        setErrorMsg('Base URL provider Analisis tidak boleh kosong.');
        return;
      }
      if (!apiKey.trim()) {
        setErrorMsg('API Key provider Analisis tidak boleh kosong.');
        return;
      }
    }

    if (ttsMode === 'custom_tts' && activeTtsPreset.requiresKey) {
      if (!ttsBaseUrl.trim()) {
        setErrorMsg('Base URL provider TTS terpisah tidak boleh kosong.');
        return;
      }
      if (!ttsApiKey.trim()) {
        setErrorMsg('API Key provider TTS terpisah tidak boleh kosong.');
        return;
      }
    }

    for (let i = 0; i < analysisFallbacks.length; i++) {
      const fb = analysisFallbacks[i];
      const preset = AI_PROVIDER_PRESETS.find((p) => p.id === fb.provider);
      if (preset?.requiresKey) {
        if (!fb.baseUrl.trim()) {
          setErrorMsg(`Base URL Cadangan Analisis #${i + 1} belum diisi.`);
          return;
        }
        if (!fb.apiKey.trim()) {
          setErrorMsg(`API Key Cadangan Analisis #${i + 1} belum diisi.`);
          return;
        }
      }
    }

    for (let i = 0; i < ttsFallbacks.length; i++) {
      const fb = ttsFallbacks[i];
      const preset = AI_PROVIDER_PRESETS.find((p) => p.id === fb.provider);
      if (preset?.requiresKey) {
        if (!fb.baseUrl.trim()) {
          setErrorMsg(`Base URL Cadangan TTS #${i + 1} belum diisi.`);
          return;
        }
        if (!fb.apiKey.trim()) {
          setErrorMsg(`API Key Cadangan TTS #${i + 1} belum diisi.`);
          return;
        }
      }
    }

    const cleanAnalyzeModel = analyzeModel.trim() || AUTO_MODEL_ID;
    const cleanTtsModel = ttsModel.trim() || AUTO_MODEL_ID;

    const ensuredModels =
      cleanAnalyzeModel !== AUTO_MODEL_ID &&
      !availableModels.some((m) => m.id === cleanAnalyzeModel)
        ? [{ id: cleanAnalyzeModel, label: cleanAnalyzeModel }, ...availableModels]
        : availableModels;

    const ensuredTtsModels =
      cleanTtsModel !== AUTO_MODEL_ID &&
      !ttsAvailableModels.some((m) => m.id === cleanTtsModel)
        ? [{ id: cleanTtsModel, label: cleanTtsModel }, ...ttsAvailableModels]
        : ttsAvailableModels;

    onSave({
      provider,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: cleanAnalyzeModel,
      availableModels: ensuredModels,
      analyzeModel: cleanAnalyzeModel,
      ttsMode,
      ttsProvider,
      ttsBaseUrl: ttsBaseUrl.trim(),
      ttsApiKey: ttsApiKey.trim(),
      ttsModel: cleanTtsModel,
      ttsAvailableModels: ensuredTtsModels,
      analysisFallbacks: analysisFallbacks.map((fb) => ({
        ...fb,
        baseUrl: fb.baseUrl.trim(),
        apiKey: fb.apiKey.trim(),
        model: fb.model.trim() || AUTO_MODEL_ID,
      })),
      ttsFallbacks: ttsFallbacks.map((fb) => ({
        ...fb,
        baseUrl: fb.baseUrl.trim(),
        apiKey: fb.apiKey.trim(),
        model: fb.model.trim() || AUTO_MODEL_ID,
      })),
    });
    onClose();
  };

  const handleResetDefault = () => {
    setProvider(DEFAULT_AI_PROVIDER_CONFIG.provider);
    setBaseUrl('');
    setApiKey('');
    setAnalyzeModel(AUTO_MODEL_ID);
    setAvailableModels(DEFAULT_SERVER_MODELS);
    setUseManualAnalyzeModel(false);
    setFetchStatus(null);
    setAnalysisFallbacks([]);

    setTtsMode('same');
    setTtsProvider('gemini_server');
    setTtsBaseUrl('');
    setTtsApiKey('');
    setTtsModel(AUTO_MODEL_ID);
    setTtsAvailableModels(DEFAULT_SERVER_TTS_MODELS);
    setUseManualTtsModel(false);
    setTtsFetchStatus(null);
    setTtsFallbacks([]);
    setRevealedFallbackKeys({});
    setErrorMsg(null);
  };

  const sameModeTtsChoices =
    provider === 'gemini_server'
      ? DEFAULT_SERVER_TTS_MODELS
      : availableModels.filter((m) => /tts|speech|kokoro|orpheus|playai|audio/i.test(m.id));

  const effectiveTtsDropdownOptions =
    ttsMode === 'custom_tts'
      ? ttsProvider === 'gemini_server'
        ? DEFAULT_SERVER_TTS_MODELS
        : ttsAvailableModels
      : sameModeTtsChoices;

  const renderFallbackList = (
    role: 'analysis' | 'tts',
    items: AiFallbackTarget[],
    presets: typeof AI_PROVIDER_PRESETS
  ) => (
    <div className="pt-3 mt-2 border-t border-white/8 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
          <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          <span>
            Auto-Fallback {role === 'analysis' ? 'Analisis' : 'TTS'} ({items.length}{' '}
            cadangan)
          </span>
        </div>
        <button
          type="button"
          onClick={() => addFallbackItem(role)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-amber-400/30 text-[11px] font-medium text-amber-200 transition-colors whitespace-nowrap"
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
          <span>Tambah Cadangan API Key / Provider</span>
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          Belum ada cadangan. Tambahkan API Key kedua atau provider cadangan agar proses otomatis berpindah jika utama gagal.
        </p>
      ) : (
        <div className="space-y-2.5">
          {items.map((fb, idx) => {
            const fbPreset =
              presets.find((p) => p.id === fb.provider) ?? presets[0];
            const isRevealed = Boolean(revealedFallbackKeys[fb.id]);
            return (
              <div
                key={fb.id}
                className="rounded-lg border border-white/10 bg-[#0B0D14] p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-amber-300">
                    Cadangan #{idx + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveFallbackItem(role, idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Naikkan urutan cadangan ${idx + 1}`}
                      className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveFallbackItem(role, idx, 1)}
                      disabled={idx === items.length - 1}
                      aria-label={`Turunkan urutan cadangan ${idx + 1}`}
                      className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFallbackItem(role, fb.id)}
                      aria-label={`Hapus cadangan ${idx + 1}`}
                      className="p-1 rounded text-slate-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Provider Cadangan
                    </label>
                    <select
                      aria-label={`Provider cadangan ${role} ${idx + 1}`}
                      value={fb.provider}
                      onChange={(e) =>
                        updateFallbackItem(role, fb.id, {
                          provider: e.target.value as AiProviderId,
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-lg bg-[#121520] border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    >
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Model (ketik "auto" untuk otomatis)
                    </label>
                    <input
                      type="text"
                      aria-label={`Model cadangan ${role} ${idx + 1}`}
                      value={fb.model}
                      onChange={(e) =>
                        updateFallbackItem(role, fb.id, { model: e.target.value })
                      }
                      placeholder="auto"
                      className="w-full h-9 px-2.5 rounded-lg bg-[#121520] border border-white/10 text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                {fbPreset.requiresKey && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Base URL Cadangan
                      </label>
                      <input
                        type="url"
                        aria-label={`Base URL cadangan ${role} ${idx + 1}`}
                        value={fb.baseUrl}
                        onChange={(e) =>
                          updateFallbackItem(role, fb.id, { baseUrl: e.target.value })
                        }
                        placeholder={fbPreset.defaultBaseUrl || 'https://api.openai.com/v1'}
                        className="w-full h-9 px-2.5 rounded-lg bg-[#121520] border border-white/10 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        API Key Cadangan
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type={isRevealed ? 'text' : 'password'}
                          aria-label={`API Key cadangan ${role} ${idx + 1}`}
                          value={fb.apiKey}
                          onChange={(e) =>
                            updateFallbackItem(role, fb.id, { apiKey: e.target.value })
                          }
                          placeholder="API Key cadangan..."
                          autoComplete="off"
                          spellCheck={false}
                          className="w-full h-9 pl-2.5 pr-9 rounded-lg bg-[#121520] border border-white/10 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setRevealedFallbackKeys((prev) => ({
                              ...prev,
                              [fb.id]: !prev[fb.id],
                            }))
                          }
                          aria-label={`Tampilkan API Key cadangan ${idx + 1}`}
                          className="absolute right-1.5 p-1 rounded text-slate-400 hover:text-white"
                        >
                          {isRevealed ? (
                            <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-provider-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#121520] border border-white/12 rounded-xl max-w-2xl w-full overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between gap-3 bg-[#0E111A]">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-indigo-400 shrink-0" aria-hidden="true" />
            <div>
              <h2
                id="ai-provider-modal-title"
                className="font-display text-base font-semibold text-white"
              >
                Pengaturan Dual-Role AI &amp; Auto-Fallback
              </h2>
              <p className="text-xs text-slate-400">
                Atur provider utama &amp; cadangan multi-API key untuk Analisis/Transkrip dan TTS.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pengaturan AI Provider"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* PERAN 1: ANALISIS, TRANSKRIP & TERJEMAHAN */}
          <fieldset className="rounded-xl border border-white/10 bg-[#0E111A] p-4 space-y-3.5">
            <legend className="px-2 text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Peran 1: Analisis Video, Transkrip &amp; Terjemahan</span>
            </legend>

            <div>
              <label
                htmlFor="ai-provider-select"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Provider Utama Analisis (aiProvider)
              </label>
              <select
                id="ai-provider-select"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as AiProviderId)}
                className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/12 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                {AI_PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                {activePreset.description}
              </p>
            </div>

            {activePreset.requiresKey && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="ai-base-url"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Base URL Analisis
                  </label>
                  <input
                    id="ai-base-url"
                    type="url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={activePreset.defaultBaseUrl || 'https://api.openai.com/v1'}
                    className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/12 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ai-api-key"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    API Key Utama (atau pisahkan dengan ;)
                  </label>
                  <div className="relative flex items-center">
                    <input
                      id="ai-api-key"
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="key1 atau key1;key2"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full h-10 pl-3 pr-10 rounded-lg bg-[#0B0D14] border border-white/12 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((prev) => !prev)}
                      aria-label={showApiKey ? 'Sembunyikan API Key Analisis' : 'Tampilkan API Key Analisis'}
                      className="absolute right-2 p-1.5 rounded text-slate-400 hover:text-white transition-colors"
                    >
                      {showApiKey ? (
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="ai-analyze-model-select"
                  className="block text-xs font-medium text-slate-300"
                >
                  Model Analisis &amp; Terjemahan
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setUseManualAnalyzeModel((prev) => !prev)}
                    className="text-[11px] text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline"
                  >
                    {useManualAnalyzeModel ? 'Pilih dari daftar' : 'Ketik ID manual'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleFetchModels('analysis')}
                    disabled={isFetchingModels}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-indigo-400/35 disabled:opacity-50 text-xs font-medium text-indigo-200 transition-colors whitespace-nowrap"
                  >
                    {isFetchingModels ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                    )}
                    <span>{isFetchingModels ? 'Mengambil...' : 'Fetch Model'}</span>
                  </button>
                </div>
              </div>

              {useManualAnalyzeModel ? (
                <input
                  id="ai-analyze-model-select"
                  type="text"
                  value={analyzeModel}
                  onChange={(e) => setAnalyzeModel(e.target.value)}
                  placeholder="auto atau contoh: gemini-2.5-flash"
                  className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/12 text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              ) : (
                <select
                  id="ai-analyze-model-select"
                  value={analyzeModel}
                  onChange={(e) => setAnalyzeModel(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/12 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value={AUTO_MODEL_ID}>
                    Otomatis (Smart Routing → {previewAutoAnalyzeModel})
                  </option>
                  {analyzeModel !== AUTO_MODEL_ID &&
                    !availableModels.some((m) => m.id === analyzeModel) && (
                      <option value={analyzeModel}>{analyzeModel}</option>
                    )}
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}

              <p className="text-[11px] text-slate-400">
                Saat tombol <strong className="text-slate-200">Analisis Video</strong> ditekan, sistem memakai{' '}
                <span className="font-mono text-indigo-300">
                  {analyzeModel === AUTO_MODEL_ID ? previewAutoAnalyzeModel : analyzeModel}
                </span>
                .
              </p>
            </div>

            {fetchStatus && (
              <div className="flex items-center gap-2 text-xs text-emerald-200 bg-emerald-500/12 border border-emerald-500/30 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>{fetchStatus}</span>
              </div>
            )}

            {renderFallbackList('analysis', analysisFallbacks, AI_PROVIDER_PRESETS)}
          </fieldset>

          {/* PERAN 2: SULIH SUARA (AI DUBBING TTS) */}
          <fieldset className="rounded-xl border border-white/10 bg-[#0E111A] p-4 space-y-3.5">
            <legend className="px-2 text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Peran 2: Sulih Suara AI (Dubbing / TTS)</span>
            </legend>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={ttsMode === 'same'}
                onClick={() => {
                  setTtsMode('same');
                  setTtsModel(AUTO_MODEL_ID);
                }}
                className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                  ttsMode === 'same'
                    ? 'bg-emerald-600/15 border-emerald-500/60 text-white'
                    : 'bg-[#0B0D14] border-white/10 text-slate-300 hover:border-white/20'
                }`}
              >
                <div className="font-semibold">Gunakan Provider Analisis</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Pilih model TTS otomatis dari provider yang sama
                </div>
              </button>

              <button
                type="button"
                aria-pressed={ttsMode === 'custom_tts'}
                onClick={() => {
                  setTtsMode('custom_tts');
                  setTtsModel(AUTO_MODEL_ID);
                }}
                className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                  ttsMode === 'custom_tts'
                    ? 'bg-emerald-600/15 border-emerald-500/60 text-white'
                    : 'bg-[#0B0D14] border-white/10 text-slate-300 hover:border-white/20'
                }`}
              >
                <div className="font-semibold">Provider TTS Terpisah</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Cocok jika Analisis pakai OpenRouter / Claude / Groq
                </div>
              </button>
            </div>

            {ttsMode === 'custom_tts' && (
              <div className="space-y-3 pt-1">
                <div>
                  <label
                    htmlFor="ai-tts-provider-select"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Provider Utama TTS
                  </label>
                  <select
                    id="ai-tts-provider-select"
                    value={ttsProvider}
                    onChange={(e) => handleTtsProviderChange(e.target.value as AiProviderId)}
                    className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/12 text-sm text-white focus:outline-none focus:border-emerald-500"
                  >
                    {TTS_CAPABLE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {activeTtsPreset.requiresKey && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="ai-tts-base-url"
                        className="block text-xs font-medium text-slate-300 mb-1.5"
                      >
                        Base URL TTS
                      </label>
                      <input
                        id="ai-tts-base-url"
                        type="url"
                        value={ttsBaseUrl}
                        onChange={(e) => setTtsBaseUrl(e.target.value)}
                        placeholder={activeTtsPreset.defaultBaseUrl || 'https://api.openai.com/v1'}
                        className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/12 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="ai-tts-api-key"
                        className="block text-xs font-medium text-slate-300 mb-1.5"
                      >
                        API Key TTS (atau pisahkan dengan ;)
                      </label>
                      <div className="relative flex items-center">
                        <input
                          id="ai-tts-api-key"
                          type={showTtsApiKey ? 'text' : 'password'}
                          value={ttsApiKey}
                          onChange={(e) => setTtsApiKey(e.target.value)}
                          placeholder="key1 atau key1;key2"
                          autoComplete="off"
                          spellCheck={false}
                          className="w-full h-10 pl-3 pr-10 rounded-lg bg-[#0B0D14] border border-white/12 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowTtsApiKey((prev) => !prev)}
                          aria-label={showTtsApiKey ? 'Sembunyikan API Key TTS' : 'Tampilkan API Key TTS'}
                          className="absolute right-2 p-1.5 rounded text-slate-400 hover:text-white transition-colors"
                        >
                          {showTtsApiKey ? (
                            <EyeOff className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <Eye className="w-4 h-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="ai-tts-model-select"
                  className="block text-xs font-medium text-slate-300"
                >
                  Model Suara (TTS)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setUseManualTtsModel((prev) => !prev)}
                    className="text-[11px] text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline"
                  >
                    {useManualTtsModel ? 'Pilih dari daftar' : 'Ketik ID manual'}
                  </button>
                  {ttsMode === 'custom_tts' && (
                    <button
                      type="button"
                      onClick={() => void handleFetchModels('tts')}
                      disabled={isFetchingTtsModels}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-emerald-400/35 disabled:opacity-50 text-xs font-medium text-emerald-200 transition-colors whitespace-nowrap"
                    >
                      {isFetchingTtsModels ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                      )}
                      <span>{isFetchingTtsModels ? 'Mengambil...' : 'Fetch Model TTS'}</span>
                    </button>
                  )}
                </div>
              </div>

              {useManualTtsModel ? (
                <input
                  id="ai-tts-model-select"
                  type="text"
                  value={ttsModel}
                  onChange={(e) => setTtsModel(e.target.value)}
                  placeholder="auto atau contoh: tts-1 / gemini-3.8-flash-lite-tts"
                  className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/12 text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              ) : (
                <select
                  id="ai-tts-model-select"
                  value={ttsModel}
                  onChange={(e) => setTtsModel(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-[#0B0D14] border border-white/12 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value={AUTO_MODEL_ID}>
                    {previewAutoTtsModel
                      ? `Otomatis (Smart Routing → ${previewAutoTtsModel})`
                      : 'Otomatis (Fallback Web Speech Browser)'}
                  </option>
                  {ttsModel !== AUTO_MODEL_ID &&
                    !effectiveTtsDropdownOptions.some((m) => m.id === ttsModel) && (
                      <option value={ttsModel}>{ttsModel}</option>
                    )}
                  {effectiveTtsDropdownOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}

              <p className="text-[11px] text-slate-400">
                Saat tombol <strong className="text-slate-200">Generate Dubbing AI (TTS)</strong> ditekan, sistem memakai{' '}
                <span className="font-mono text-emerald-300">
                  {ttsModel === AUTO_MODEL_ID
                    ? previewAutoTtsModel || 'Web Speech Browser'
                    : ttsModel}
                </span>
                .
              </p>
            </div>

            {ttsFetchStatus && (
              <div className="flex items-center gap-2 text-xs text-emerald-200 bg-emerald-500/12 border border-emerald-500/30 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>{ttsFetchStatus}</span>
              </div>
            )}

            {renderFallbackList('tts', ttsFallbacks, TTS_CAPABLE_PRESETS)}
          </fieldset>

          {errorMsg && (
            <p className="text-xs text-rose-200 bg-rose-500/12 border border-rose-500/30 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            API key hanya disimpan di memori sesi browser saat ini. Jika utama mengalami error/rate-limit, server otomatis beralih ke cadangan secara berurutan.
          </p>

          <div className="pt-2 border-t border-white/8 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleResetDefault}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset ke Default</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg bg-[#1A1E2E] hover:bg-[#23283D] border border-white/10 text-xs font-medium text-slate-200 transition-colors"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors"
              >
                Simpan Routing AI
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
