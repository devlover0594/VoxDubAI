import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCandidateList,
  getProviderDisplayName,
  isPrivateOrReservedIp,
  mapProviderError,
  parseAiConfigFromRequest,
  parseFallbackConfigsFromRequest,
  runWithServerFallback,
  synthesizeTtsWithProvider,
  TtsUnsupportedByProviderError,
  validateProviderBaseUrl,
} from './aiProviders.ts';

test('isPrivateOrReservedIp blocks loopback, private ranges, and cloud metadata IPs', () => {
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('10.0.0.5'), true);
  assert.equal(isPrivateOrReservedIp('172.16.0.1'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.10'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
});

test('validateProviderBaseUrl rejects non-HTTPS, credentials, and local/private targets', async () => {
  await assert.rejects(() => validateProviderBaseUrl('http://api.openai.com/v1'));
  await assert.rejects(() => validateProviderBaseUrl('https://localhost:8080/v1'));
  await assert.rejects(() => validateProviderBaseUrl('https://127.0.0.1/v1'));
  await assert.rejects(() => validateProviderBaseUrl('https://169.254.169.254/latest'));
  await assert.rejects(() => validateProviderBaseUrl('https://user:pass@api.openai.com/v1'));
  await assert.rejects(() => validateProviderBaseUrl('https://api.openai.com/v1?foo=bar'));
});

test('parseAiConfigFromRequest safely parses JSON strings and falls back invalid providers', () => {
  const valid = parseAiConfigFromRequest(
    JSON.stringify({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-123',
      model: 'gpt-4o-mini',
    })
  );
  assert.equal(valid.provider, 'openai');
  assert.equal(valid.baseUrl, 'https://api.openai.com/v1');
  assert.equal(valid.model, 'gpt-4o-mini');

  const invalid = parseAiConfigFromRequest({ provider: 'unknown_provider' });
  assert.equal(invalid.provider, 'gemini_server');
});

test('mapProviderError names the configured provider instead of attributing errors to Gemini', () => {
  const rateLimitOpenAi = mapProviderError(new Error('HTTP 429 rate limit exceeded'), 'openai');
  assert.equal(rateLimitOpenAi.status, 429);
  assert.match(rateLimitOpenAi.message, /OpenAI/);
  assert.doesNotMatch(rateLimitOpenAi.message, /Gemini/i);

  const authOpenRouter = mapProviderError(new Error('401 Unauthorized'), 'openrouter');
  assert.equal(authOpenRouter.status, 403);
  assert.match(authOpenRouter.message, /OpenRouter/);
  assert.doesNotMatch(authOpenRouter.message, /Gemini/i);

  const busyGroq = mapProviderError(new Error('503 service unavailable'), 'groq');
  assert.equal(busyGroq.status, 503);
  assert.match(busyGroq.message, /Groq/);
  assert.doesNotMatch(busyGroq.message, /Gemini/i);

  const customGemini = mapProviderError(new Error('quota exceeded 429'), 'gemini_custom');
  assert.equal(customGemini.status, 429);
  assert.equal(getProviderDisplayName('gemini_custom'), 'Google Gemini (Custom)');
  assert.match(customGemini.message, /Google Gemini \(Custom\)/);
});

test('synthesizeTtsWithProvider rejects text-only providers with TtsUnsupportedByProviderError without hitting Gemini', async () => {
  await assert.rejects(
    () =>
      synthesizeTtsWithProvider({
        text: 'Halo semua',
        voiceStyle: 'male_pro',
        langLabel: 'Indonesian',
        voiceProfile: { voiceName: 'Charon', style: 'Clear' },
        aiConfig: {
          provider: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-test',
          model: 'openai/gpt-4o-mini',
        },
      }),
    (err: unknown) =>
      err instanceof TtsUnsupportedByProviderError && err.providerLabel === 'OpenRouter'
  );

  await assert.rejects(
    () =>
      synthesizeTtsWithProvider({
        text: 'Halo semua',
        voiceStyle: 'female_friendly',
        langLabel: 'Indonesian',
        voiceProfile: { voiceName: 'Kore', style: 'Warm' },
        aiConfig: {
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'sk-ant-test',
          model: 'claude-sonnet-4-5-20250929',
        },
      }),
    (err: unknown) =>
      err instanceof TtsUnsupportedByProviderError &&
      err.providerLabel === 'Anthropic (Claude)'
  );
});

test('parseFallbackConfigsFromRequest and buildCandidateList parse, deduplicate, and cap candidates', () => {
  const parsed = parseFallbackConfigsFromRequest(
    JSON.stringify([
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k1', model: 'gpt-4o' },
      { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k2', model: 'llama-3.3-70b-versatile' },
    ])
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].provider, 'groq');

  const primary = {
    provider: 'openai' as const,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'k1',
    model: 'gpt-4o',
  };
  const candidates = buildCandidateList(primary, parsed);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].apiKey, 'k1');
  assert.equal(candidates[1].provider, 'groq');
});

test('runWithServerFallback continues to backup candidate on failure and aggregates status when all fail', async () => {
  const candidates = [
    { provider: 'openai' as const, baseUrl: 'https://api.openai.com/v1', apiKey: 'bad-1', model: 'tts-1' },
    { provider: 'groq' as const, baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'good-2', model: 'playai-tts' },
  ];

  const okOutcome = await runWithServerFallback(candidates, async (cfg) => {
    if (cfg.apiKey === 'bad-1') {
      throw new Error('HTTP 429 rate limit exceeded');
    }
    return `ok-with-${cfg.provider}`;
  });
  assert.equal(okOutcome.result, 'ok-with-groq');
  assert.equal(okOutcome.fallbackUsed, true);
  assert.equal(okOutcome.attemptIndex, 1);

  await assert.rejects(
    () =>
      runWithServerFallback(candidates, async (cfg) => {
        if (cfg.provider === 'openai') throw new Error('401 Unauthorized');
        throw new Error('HTTP 429 rate limit exceeded');
      }),
    (err: unknown) => {
      const e = err as Error & { httpStatus?: number };
      return (
        e.httpStatus === 429 &&
        /Semua 2 konfigurasi AI gagal/.test(e.message) &&
        !e.message.includes('bad-1') &&
        !e.message.includes('good-2')
      );
    }
  );

  await assert.rejects(
    () =>
      runWithServerFallback(candidates, async () => {
        throw new Error('401 Unauthorized');
      }),
    (err: unknown) => (err as Error & { httpStatus?: number }).httpStatus === 403
  );
});
