import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_MODEL_ID,
  DEFAULT_AI_PROVIDER_CONFIG,
  type AiProviderConfig,
} from '../types/dubbing.ts';
import {
  buildAnalysisCandidateChain,
  buildTtsCandidateChain,
  getDualRoleSummary,
  getEffectiveAnalysisRequestConfig,
  getEffectiveTtsRequestConfig,
  resolveAnalysisModelSelection,
  resolveTtsModelSelection,
  splitApiKeys,
} from './aiRouting.ts';

test('resolveAnalysisModelSelection picks task-appropriate multimodal vs text models in auto mode', () => {
  assert.equal(
    resolveAnalysisModelSelection({
      provider: 'gemini_server',
      requestedModel: AUTO_MODEL_ID,
      hasMediaAttachment: true,
    }),
    'gemini-2.5-flash'
  );
  assert.equal(
    resolveAnalysisModelSelection({
      provider: 'gemini_server',
      requestedModel: AUTO_MODEL_ID,
      hasMediaAttachment: false,
    }),
    'gemini-4-hydrogen'
  );
  // Ignores accidental TTS-only model override when running analysis
  assert.equal(
    resolveAnalysisModelSelection({
      provider: 'openai',
      requestedModel: 'tts-1',
      hasMediaAttachment: true,
    }),
    'gpt-4o'
  );
  // Respects explicit compatible override
  assert.equal(
    resolveAnalysisModelSelection({
      provider: 'gemini_custom',
      requestedModel: 'gemini-2.5-pro',
      hasMediaAttachment: true,
    }),
    'gemini-2.5-pro'
  );
});

test('resolveTtsModelSelection picks dedicated TTS models in auto mode and ignores non-TTS chat models', () => {
  assert.equal(
    resolveTtsModelSelection({
      provider: 'gemini_server',
      requestedModel: AUTO_MODEL_ID,
    }),
    'gemini-3.8-flash-lite-tts'
  );
  // Ignores text/chat model if passed to TTS auto-router
  assert.equal(
    resolveTtsModelSelection({
      provider: 'openai',
      requestedModel: 'gpt-4o-mini',
    }),
    'tts-1'
  );
  assert.equal(
    resolveTtsModelSelection({
      provider: 'groq',
      requestedModel: 'llama-3.3-70b-versatile',
    }),
    'playai-tts'
  );
  assert.equal(
    resolveTtsModelSelection({
      provider: 'openrouter',
      requestedModel: AUTO_MODEL_ID,
    }),
    null
  );
});

test('Dual-Role routing splits Analysis and TTS providers cleanly when ttsMode is custom_tts', () => {
  const splitConfig: AiProviderConfig = {
    ...DEFAULT_AI_PROVIDER_CONFIG,
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-or-test',
    analyzeModel: AUTO_MODEL_ID,
    availableModels: [{ id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5' }],
    ttsMode: 'custom_tts',
    ttsProvider: 'openai',
    ttsBaseUrl: 'https://api.openai.com/v1',
    ttsApiKey: 'sk-oa-test',
    ttsModel: AUTO_MODEL_ID,
    ttsAvailableModels: [{ id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts' }],
  };

  const analysisReq = getEffectiveAnalysisRequestConfig(splitConfig, {
    hasMediaAttachment: true,
  });
  assert.equal(analysisReq.provider, 'openrouter');
  assert.equal(analysisReq.model, 'anthropic/claude-3.5-sonnet');

  const ttsReq = getEffectiveTtsRequestConfig(splitConfig);
  assert.equal(ttsReq.provider, 'openai');
  assert.equal(ttsReq.apiKey, 'sk-oa-test');
  assert.equal(ttsReq.model, 'gpt-4o-mini-tts');

  const summary = getDualRoleSummary(splitConfig);
  assert.equal(summary.isSplitTts, true);
  assert.equal(summary.resolvedAnalysisVideo, 'anthropic/claude-3.5-sonnet');
  assert.equal(summary.resolvedTts, 'gpt-4o-mini-tts');
});

test('splitApiKeys parses semicolon and newline separated keys and deduplicates', () => {
  assert.deepEqual(
    splitApiKeys('key-1; key-2\nkey-1\r\n  key-3  ; '),
    ['key-1', 'key-2', 'key-3']
  );
  assert.deepEqual(splitApiKeys(''), []);
});

test('buildAnalysisCandidateChain and buildTtsCandidateChain expand multi-keys, deduplicate, and skip non-TTS backups', () => {
  const config: AiProviderConfig = {
    ...DEFAULT_AI_PROVIDER_CONFIG,
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-primary-1; sk-primary-2',
    analyzeModel: AUTO_MODEL_ID,
    ttsMode: 'custom_tts',
    ttsProvider: 'openai',
    ttsBaseUrl: 'https://api.openai.com/v1',
    ttsApiKey: 'sk-tts-1\nsk-tts-2',
    ttsModel: AUTO_MODEL_ID,
    analysisFallbacks: [
      {
        id: 'afb-1',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-primary-2', // duplicate of expanded primary
        model: AUTO_MODEL_ID,
      },
      {
        id: 'afb-2',
        provider: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: 'gsk-backup-1;gsk-backup-2',
        model: AUTO_MODEL_ID,
      },
    ],
    ttsFallbacks: [
      {
        id: 'tfb-skip',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-unused',
        model: AUTO_MODEL_ID,
      },
      {
        id: 'tfb-groq',
        provider: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: 'gsk-tts-backup',
        model: AUTO_MODEL_ID,
      },
      {
        id: 'tfb-gemini-server',
        provider: 'gemini_server',
        baseUrl: '',
        apiKey: '',
        model: AUTO_MODEL_ID,
      },
    ],
  };

  const analysisChain = buildAnalysisCandidateChain(config, {
    hasMediaAttachment: true,
  });
  assert.equal(analysisChain.length, 4);
  assert.deepEqual(
    analysisChain.map((c) => `${c.provider}:${c.apiKey}:${c.model}`),
    [
      'openai:sk-primary-1:gpt-4o',
      'openai:sk-primary-2:gpt-4o',
      'groq:gsk-backup-1:llama-3.3-70b-versatile',
      'groq:gsk-backup-2:llama-3.3-70b-versatile',
    ]
  );

  const ttsChain = buildTtsCandidateChain(config);
  assert.equal(ttsChain.length, 4);
  assert.deepEqual(
    ttsChain.map((c) => `${c.provider}:${c.apiKey}:${c.model}`),
    [
      'openai:sk-tts-1:tts-1',
      'openai:sk-tts-2:tts-1',
      'groq:gsk-tts-backup:playai-tts',
      'gemini_server::gemini-3.8-flash-lite-tts',
    ]
  );

  const summary = getDualRoleSummary(config);
  assert.equal(summary.analysisFallbackCount, 3);
  assert.equal(summary.ttsFallbackCount, 3);
});
