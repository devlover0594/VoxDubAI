import {
  AI_PROVIDER_PRESETS,
  AUTO_MODEL_ID,
  type AiModelOption,
  type AiProviderConfig,
  type AiProviderId,
} from '../types/dubbing.ts';

const TTS_MODEL_PATTERN = /(^|[-_/])(tts|speech|kokoro|orpheus|playai|eleven|bark|voice)([-_/]|$)/i;
const NON_CHAT_MODEL_PATTERN = /(embedding|moderation|dall-e|imagen|whisper|transcribe|tts|speech|kokoro|orpheus|playai)/i;

export function isTtsOnlyModelId(modelId: string): boolean {
  return TTS_MODEL_PATTERN.test(modelId.trim());
}

export function isTtsCapableModelId(modelId: string): boolean {
  return TTS_MODEL_PATTERN.test(modelId.trim());
}

export function isAutoModel(modelId?: string | null): boolean {
  const clean = (modelId || '').trim().toLowerCase();
  return !clean || clean === AUTO_MODEL_ID;
}

export function resolveAnalysisModelSelection(params: {
  provider: AiProviderId;
  requestedModel?: string;
  availableModels?: AiModelOption[];
  hasMediaAttachment?: boolean;
}): string {
  const {
    provider,
    requestedModel,
    availableModels = [],
    hasMediaAttachment = true,
  } = params;

  const cleanRequested = (requestedModel || '').trim();
  const explicitOverride =
    cleanRequested && !isAutoModel(cleanRequested) && !isTtsOnlyModelId(cleanRequested);

  if (explicitOverride) {
    return cleanRequested;
  }

  const chatCandidates = availableModels
    .map((m) => m.id)
    .filter((id) => id && !NON_CHAT_MODEL_PATTERN.test(id));

  switch (provider) {
    case 'gemini_server': {
      return hasMediaAttachment ? 'gemini-2.5-flash' : 'gemini-4-hydrogen';
    }
    case 'gemini_custom': {
      const geminiModels = chatCandidates.filter((id) => !/^(claude-|gpt-|llama-)/i.test(id));
      const preferred = hasMediaAttachment
        ? geminiModels.find((id) =>
            /gemini-2\.5-flash|gemini-2\.5-pro|gemini-2\.0-flash|gemini-4/i.test(id)
          )
        : geminiModels.find((id) =>
            /gemini-4|gemini-2\.5-flash|gemini-3\.1-flash|gemini-2\.0-flash/i.test(id)
          );
      return preferred || geminiModels[0] || 'gemini-2.5-flash';
    }
    case 'openai': {
      const openAiModels = chatCandidates.filter((id) => !/^(gemini-|claude-)/i.test(id));
      const preferred = hasMediaAttachment
        ? openAiModels.find((id) => /gpt-4o-audio|gpt-4o/i.test(id))
        : openAiModels.find((id) => /gpt-4o-mini|gpt-4\.1-mini|gpt-4o/i.test(id));
      return preferred || openAiModels[0] || (hasMediaAttachment ? 'gpt-4o' : 'gpt-4o-mini');
    }
    case 'openrouter': {
      const preferred = chatCandidates.find((id) =>
        /gemini-2\.5-flash|gpt-4o|claude|llama-3\.3/i.test(id)
      );
      return preferred || chatCandidates[0] || 'google/gemini-2.5-flash';
    }
    case 'groq': {
      const groqModels = chatCandidates.filter((id) => !/^(gemini-|claude-|gpt-)/i.test(id));
      const preferred = groqModels.find((id) =>
        /llama-3\.3-70b|llama-3\.1|mixtral|qwen/i.test(id)
      );
      return preferred || groqModels[0] || 'llama-3.3-70b-versatile';
    }
    case 'anthropic': {
      const claudeModels = chatCandidates.filter((id) => /claude/i.test(id));
      const preferred = claudeModels.find((id) =>
        /claude-sonnet-4|claude-3-7|claude-3-5|claude/i.test(id)
      );
      return preferred || claudeModels[0] || 'claude-sonnet-4-5-20250929';
    }
    case 'custom_openai': {
      return chatCandidates[0] || cleanRequested || 'gpt-4o-mini';
    }
  }
}

export function resolveTtsModelSelection(params: {
  provider: AiProviderId;
  requestedModel?: string;
  availableModels?: AiModelOption[];
}): string | null {
  const { provider, requestedModel, availableModels = [] } = params;

  if (provider === 'openrouter' || provider === 'anthropic') {
    return null;
  }

  const cleanRequested = (requestedModel || '').trim();
  const explicitTtsOverride =
    cleanRequested &&
    !isAutoModel(cleanRequested) &&
    isTtsCapableModelId(cleanRequested);

  if (explicitTtsOverride) {
    return cleanRequested;
  }

  const availableIds = availableModels.map((m) => m.id).filter(Boolean);

  switch (provider) {
    case 'gemini_server':
      return 'gemini-3.8-flash-lite-tts';
    case 'gemini_custom': {
      const detected = availableIds.find((id) => /^gemini-/i.test(id) && isTtsCapableModelId(id));
      return detected || 'gemini-2.5-flash-preview-tts';
    }
    case 'openai': {
      const openAiTts = availableIds.filter((id) => !/^gemini-/i.test(id));
      const preferred = openAiTts.find((id) =>
        /gpt-4o-mini-tts|tts-1-hd|tts-1/i.test(id)
      );
      const detected = openAiTts.find((id) => isTtsCapableModelId(id));
      return preferred || detected || 'tts-1';
    }
    case 'groq': {
      const groqTts = availableIds.filter((id) => !/^gemini-/i.test(id));
      const preferred = groqTts.find((id) => /playai|orpheus/i.test(id));
      const detected = groqTts.find((id) => isTtsCapableModelId(id));
      return preferred || detected || 'playai-tts';
    }
    case 'custom_openai': {
      const customTts = availableIds.filter((id) => !/^gemini-/i.test(id));
      const detected = customTts.find((id) => isTtsCapableModelId(id));
      return detected || 'tts-1';
    }
  }
}

export function getEffectiveAnalysisRequestConfig(
  config: AiProviderConfig,
  options?: { hasMediaAttachment?: boolean }
) {
  const requested =
    config.analyzeModel && !isAutoModel(config.analyzeModel)
      ? config.analyzeModel
      : config.model;
  const resolvedModel = resolveAnalysisModelSelection({
    provider: config.provider,
    requestedModel: requested,
    availableModels: config.availableModels,
    hasMediaAttachment: options?.hasMediaAttachment ?? true,
  });

  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: resolvedModel,
  };
}

export function getEffectiveTtsRequestConfig(config: AiProviderConfig) {
  const useCustomTts = config.ttsMode === 'custom_tts';
  const ttsProvider = useCustomTts ? config.ttsProvider : config.provider;
  const ttsBaseUrl = useCustomTts ? config.ttsBaseUrl : config.baseUrl;
  const ttsApiKey = useCustomTts ? config.ttsApiKey : config.apiKey;
  const ttsAvailableModels = useCustomTts
    ? config.ttsAvailableModels
    : config.availableModels;

  const resolvedModel = resolveTtsModelSelection({
    provider: ttsProvider,
    requestedModel: config.ttsModel,
    availableModels: ttsAvailableModels,
  });

  return {
    provider: ttsProvider,
    baseUrl: ttsBaseUrl,
    apiKey: ttsApiKey,
    model: resolvedModel ?? '',
  };
}

export interface ResolvedRequestCandidate {
  provider: AiProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function splitApiKeys(rawKey: string): string[] {
  const parts = (rawKey || '')
    .split(/[\r\n;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function providerRequiresKey(provider: AiProviderId): boolean {
  const preset = AI_PROVIDER_PRESETS.find((p) => p.id === provider);
  return preset ? preset.requiresKey : true;
}

function defaultBaseUrlForProvider(provider: AiProviderId): string {
  const preset = AI_PROVIDER_PRESETS.find((p) => p.id === provider);
  return preset?.defaultBaseUrl ?? '';
}

function expandKeysForTarget(target: ResolvedRequestCandidate): ResolvedRequestCandidate[] {
  if (!providerRequiresKey(target.provider)) {
    return [{ ...target, apiKey: '' }];
  }
  const keys = splitApiKeys(target.apiKey);
  if (keys.length === 0) return [];
  return keys.map((key) => ({
    ...target,
    baseUrl: target.baseUrl.trim() || defaultBaseUrlForProvider(target.provider),
    apiKey: key,
  }));
}

function deduplicateCandidates(list: ResolvedRequestCandidate[]): ResolvedRequestCandidate[] {
  const seen = new Set<string>();
  const out: ResolvedRequestCandidate[] = [];
  for (const item of list) {
    const sig = `${item.provider}|${item.baseUrl}|${item.apiKey}|${item.model}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(item);
  }
  return out;
}

export function buildAnalysisCandidateChain(
  config: AiProviderConfig,
  options?: { hasMediaAttachment?: boolean }
): ResolvedRequestCandidate[] {
  const hasMediaAttachment = options?.hasMediaAttachment ?? true;
  const primary = getEffectiveAnalysisRequestConfig(config, { hasMediaAttachment });
  const primaryExpanded = expandKeysForTarget(primary);
  const list: ResolvedRequestCandidate[] =
    primaryExpanded.length > 0 ? [...primaryExpanded] : [primary];

  const fallbacks = Array.isArray(config.analysisFallbacks)
    ? config.analysisFallbacks
    : [];

  for (const fb of fallbacks) {
    const resolvedModel = resolveAnalysisModelSelection({
      provider: fb.provider,
      requestedModel: fb.model,
      hasMediaAttachment,
    });
    const expanded = expandKeysForTarget({
      provider: fb.provider,
      baseUrl: fb.baseUrl,
      apiKey: fb.apiKey,
      model: resolvedModel,
    });
    list.push(...expanded);
  }

  return deduplicateCandidates(list);
}

export function buildTtsCandidateChain(
  config: AiProviderConfig
): ResolvedRequestCandidate[] {
  const primary = getEffectiveTtsRequestConfig(config);
  const primaryExpanded = expandKeysForTarget(primary);
  const list: ResolvedRequestCandidate[] =
    primaryExpanded.length > 0 ? [...primaryExpanded] : [primary];

  const fallbacks = Array.isArray(config.ttsFallbacks) ? config.ttsFallbacks : [];

  for (const fb of fallbacks) {
    const resolvedModel = resolveTtsModelSelection({
      provider: fb.provider,
      requestedModel: fb.model,
    });
    if (!resolvedModel) continue;
    const expanded = expandKeysForTarget({
      provider: fb.provider,
      baseUrl: fb.baseUrl,
      apiKey: fb.apiKey,
      model: resolvedModel,
    });
    list.push(...expanded);
  }

  return deduplicateCandidates(list);
}

export function getDualRoleSummary(config: AiProviderConfig) {
  const analysisPreset =
    AI_PROVIDER_PRESETS.find((p) => p.id === config.provider) ?? AI_PROVIDER_PRESETS[0];

  const isSplitTts = config.ttsMode === 'custom_tts';
  const effectiveTtsProvider = isSplitTts ? config.ttsProvider : config.provider;
  const ttsPreset =
    AI_PROVIDER_PRESETS.find((p) => p.id === effectiveTtsProvider) ??
    AI_PROVIDER_PRESETS[0];

  const analysisRequested = config.analyzeModel || config.model || AUTO_MODEL_ID;
  const isAutoAnalysis = isAutoModel(analysisRequested);
  const resolvedAnalysisVideo = resolveAnalysisModelSelection({
    provider: config.provider,
    requestedModel: analysisRequested,
    availableModels: config.availableModels,
    hasMediaAttachment: true,
  });

  const ttsRequested = config.ttsModel || AUTO_MODEL_ID;
  const isAutoTts = isAutoModel(ttsRequested);
  const resolvedTts = resolveTtsModelSelection({
    provider: effectiveTtsProvider,
    requestedModel: ttsRequested,
    availableModels: isSplitTts ? config.ttsAvailableModels : config.availableModels,
  });

  const analysisCandidates = buildAnalysisCandidateChain(config, {
    hasMediaAttachment: true,
  });
  const ttsCandidates = buildTtsCandidateChain(config);

  return {
    analysisProviderLabel: analysisPreset.label,
    analysisModelLabel: isAutoAnalysis
      ? `Auto → ${resolvedAnalysisVideo}`
      : resolvedAnalysisVideo,
    resolvedAnalysisVideo,
    isAutoAnalysis,
    ttsProviderLabel: ttsPreset.label,
    ttsModelLabel: resolvedTts
      ? isAutoTts
        ? `Auto → ${resolvedTts}`
        : resolvedTts
      : 'Web Speech Browser (Fallback)',
    resolvedTts,
    isAutoTts,
    isSplitTts,
    analysisFallbackCount: Math.max(0, analysisCandidates.length - 1),
    ttsFallbackCount: Math.max(0, ttsCandidates.length - 1),
  };
}

