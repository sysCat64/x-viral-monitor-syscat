// I18N-003 / R2 — AI connection-test path.
//
// Contract: the legacy `message` / `error` strings are unchanged; `code` (a
// locale key) and `params` are ADDED. Display (popup.js) translates `code` and
// falls back to the legacy string for anything unexpected.
// R1 (external-provider generation) is covered by ai-generation-errors-i18n.test.js;
// R3 (in-page Grok generation) is a later commit.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');
const bgSrc = read('background.js');
const bridgeSrc = read('bridge.js');
const popupSrc = read('popup.js');
const grokSrc = read('lib/grok-reply.js');
const LOCALES = ['en', 'ja', 'zh_CN'];
const locale = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));
const tFor = (l) => (key) => locale[l][key]?.message || '';

// code -> params emitted for it (R2)
const R2_CODES = {
  aiErrBaseUrlUnsupported: [], aiErrOllamaLocalOnly: [],
  aiErrHttpAuth: ['PROVIDER'], aiErrHttpNotFound: ['PROVIDER'], aiErrHttpRateLimit: ['PROVIDER'],
  aiErrHttpServer: ['PROVIDER', 'STATUS'], aiErrHttpOther: ['DETAIL', 'PROVIDER', 'STATUS'],
  aiErrTimeout: ['PROVIDER'], aiErrConnect: ['PROVIDER'], aiErrApiKeyRequired: [],
  aiErrNoActiveTab: [], aiErrNotOnX: [], aiErrNoCheckResult: [],
  aiOkOllamaConnected: [], aiOkOllamaModelMissing: ['MODEL'],
  aiErrGrokXctMissing: [], aiErrGrokSignInit: ['REASON'], aiErrGrokNoSession: [],
  aiOkGrokReady: [], aiErrGrokCheckFailed: [], aiErrGrokCheckTimeout: [],
  aiTestOk: [], aiTestFailed: [],
};

// ─── popup resolver ─────────────────────────────────────────────────────────
function loadResolver(l) {
  const start = popupSrc.indexOf('const AI_RESULT_CODE_RE');
  const end = popupSrc.indexOf('function setAiTestStatus(', start);
  expect(start).toBeGreaterThan(-1);
  const ctx = { t: tFor(l) };
  vm.runInNewContext(`${popupSrc.slice(start, end)}; this.aiResultText = aiResultText;`, ctx);
  return ctx.aiResultText;
}

// ─── background harness ─────────────────────────────────────────────────────
function loadBackground({ sync = {}, local = {}, fetch, tabs = [{ id: 7 }], reply, disconnect = false, syncError } = {}) {
  let handler;
  vm.runInNewContext(bgSrc, {
    chrome: {
      runtime: { onMessage: { addListener: (fn) => { handler = fn; } } },
      storage: {
        sync: { get: async () => { if (syncError) throw syncError; return sync; } },
        local: { get: async () => local },
      },
      tabs: {
        query: async () => tabs,
        sendMessage: async () => { if (disconnect) throw new Error('No receiving end'); return reply; },
      },
    },
    // Share TypeError so `err instanceof TypeError` in background.js matches errors thrown by the test fetch.
    fetch, console, URL, AbortController, TextDecoder, setTimeout, clearTimeout, TypeError,
  });
  const call = (message) => new Promise((resolve) => handler(message, { tab: { id: 1 } }, resolve));
  return { test: () => call({ type: 'XVM_AI_TEST_CONNECTION' }), generate: () => call({ type: 'XVM_AI_GENERATE', requestId: 'r', payload: { tweetText: 't' } }) };
}
const resp = (status, { body = '', json = {} } = {}) => async () => ({
  ok: status >= 200 && status < 300, status, text: async () => body, json: async () => json,
});
const ollama = (fetch, extra = {}) => loadBackground({ sync: { aiProvider: 'ollama', aiModel: 'llama3.1', aiBaseUrl: 'http://localhost:11434', ...extra }, fetch });
const openai = (fetch, { apiKey = 'k', baseUrl = 'https://api.openai.com/v1' } = {}) => loadBackground({
  sync: { aiProvider: 'openai-compatible', aiOpenAIPlatform: 'openai', aiBaseUrl: baseUrl, aiModel: 'm' },
  local: { xvmAiApiKey: apiKey }, fetch,
});

describe('R2 locale keys', () => {
  it('every R2 code is a locale key in en, ja and zh_CN', () => {
    for (const l of LOCALES) for (const k of Object.keys(R2_CODES)) expect(locale[l][k]?.message, `${l}:${k}`).toBeTruthy();
  });

  it('each message uses exactly the {{NAME}} params its code emits', () => {
    for (const l of LOCALES) {
      for (const [code, params] of Object.entries(R2_CODES)) {
        const found = [...new Set((locale[l][code].message.match(/\{\{([A-Z0-9_]+)\}\}/g) || []).map((m) => m.slice(2, -2)))].sort();
        expect(found, `${l}:${code}`).toEqual([...params].sort());
        expect(locale[l][code].message, `${l}:${code} must not use $-style placeholders`).not.toMatch(/\$[A-Za-z0-9]/);
      }
    }
  });

  it('reuses the existing aiTestOk / aiTestFailed instead of adding new keys', () => {
    expect(locale.ja.aiTestOk.message).toBe('接続テストに成功しました');
    expect(Object.keys(locale.en).includes('aiErrTestFailed')).toBe(false);
  });
});

describe('R2 popup resolver (aiResultText)', () => {
  const sample = { code: 'aiErrHttpServer', params: { PROVIDER: 'OpenAI', STATUS: 503 } };

  it('translates per locale and keeps dynamic values', () => {
    expect(loadResolver('ja')(sample, 'legacy')).toBe('OpenAI: サーバーエラー（503）');
    expect(loadResolver('en')(sample, 'legacy')).toBe('OpenAI: server error (503)');
    expect(loadResolver('zh_CN')(sample, 'legacy')).toBe('OpenAI 服务端错误：503');
  });

  it('reuses aiTestOk and aiTestFailed', () => {
    expect(loadResolver('ja')({ code: 'aiTestOk' }, '连接测试通过')).toBe('接続テストに成功しました');
    expect(loadResolver('en')({ code: 'aiTestFailed' }, '连接测试失败')).toBe('Connection test failed');
  });

  it('falls back to the legacy text for old-format, unknown and unresolved codes', () => {
    const r = loadResolver('ja');
    expect(r({ ok: false, error: 'x' }, 'x')).toBe('x');            // old format
    expect(r({ code: 'aiErrDoesNotExist' }, 'legacy')).toBe('legacy'); // valid shape, key missing
    expect(r({ code: 'notACode' }, 'legacy')).toBe('legacy');       // fails validation
    expect(r({ code: '<script>' }, 'legacy')).toBe('legacy');
    expect(r({ code: 42 }, 'legacy')).toBe('legacy');
    expect(r(null, 'legacy')).toBe('legacy');
    expect(r(undefined, undefined)).toBeUndefined();
    // t() returning the raw key (unresolved) is treated as unresolved
    const ctx = { t: (k) => k };
    vm.runInNewContext(`${popupSrc.slice(popupSrc.indexOf('const AI_RESULT_CODE_RE'), popupSrc.indexOf('function setAiTestStatus('))}; this.f = aiResultText;`, ctx);
    expect(ctx.f({ code: 'aiOkGrokReady' }, 'legacy')).toBe('legacy');
  });

  it('falls back (never shows a raw {{NAME}}) when params are missing or invalid', () => {
    const r = loadResolver('ja');
    for (const params of [undefined, {}, { PROVIDER: 'OpenAI' }, { PROVIDER: 'OpenAI', STATUS: {} },
      { PROVIDER: 'OpenAI', STATUS: NaN }, { PROVIDER: 'OpenAI', STATUS: 'x'.repeat(301) },
      [], 'str', { PROVIDER: ['a'], STATUS: 1 }]) {
      const out = r({ code: 'aiErrHttpServer', params }, 'legacy');
      expect(out, JSON.stringify(params)).toBe('legacy');
    }
    // inherited properties do not count as params
    expect(r({ code: 'aiErrHttpRateLimit', params: Object.create({ PROVIDER: 'inherited' }) }, 'legacy')).toBe('legacy');
  });

  it('substitutes with a function, so $-patterns and braces stay verbatim', () => {
    const out = loadResolver('en')({ code: 'aiErrHttpOther', params: { PROVIDER: "P$&", STATUS: 418, DETAIL: "$1 $$ {{PROVIDER}}" } }, 'legacy');
    expect(out).toBe("P$&: request failed (418) $1 $$ {{PROVIDER}}");
  });

  it('an empty DETAIL is valid and does not leave a trailing space', () => {
    expect(loadResolver('zh_CN')({ code: 'aiErrHttpOther', params: { PROVIDER: 'X', STATUS: 418, DETAIL: '' } }, 'legacy')).toBe('X 请求失败：418');
  });

  it('popup shows legacy text when no code (old backend) and falls back to aiTestOk/aiTestFailed as before', () => {
    expect(popupSrc).toContain("aiResultText(res, res.message) || (tr('aiTestOk') || 'Connection test passed')");
    expect(popupSrc).toContain("aiResultText(res, res?.error) || (tr('aiTestFailed') || 'Connection test failed')");
  });

  it('popup and bridge validate codes with the same pattern', () => {
    const re = (s) => s.match(/const AI_RESULT_CODE_RE = (\/.*\/);/)?.[1];
    expect(re(popupSrc)).toBeTruthy();
    expect(re(popupSrc)).toBe(re(bridgeSrc));
  });
});

describe('R2 background connection test: messages preserved, codes added', () => {
  const cases = [
    ['ollama connected', () => ollama(resp(200, { json: { models: [] } })), { ok: true, message: 'Ollama 已连接', code: 'aiOkOllamaConnected' }],
    ['ollama model missing', () => ollama(resp(200, { json: { models: [{ name: 'other' }] } })),
      { ok: true, message: 'Ollama 已连接，但未在本地模型列表中找到 llama3.1', code: 'aiOkOllamaModelMissing', params: { MODEL: 'llama3.1' } }],
    ['ollama 401', () => ollama(resp(401)), { ok: false, error: 'Ollama API Key 无效或没有权限', code: 'aiErrHttpAuth', params: { PROVIDER: 'Ollama' } }],
    ['ollama 403', () => ollama(resp(403)), { ok: false, error: 'Ollama API Key 无效或没有权限', code: 'aiErrHttpAuth', params: { PROVIDER: 'Ollama' } }],
    ['ollama 404', () => ollama(resp(404)), { ok: false, error: 'Ollama 模型或接口不存在，请检查 Base URL 和 Model', code: 'aiErrHttpNotFound', params: { PROVIDER: 'Ollama' } }],
    ['ollama 429', () => ollama(resp(429)), { ok: false, error: 'Ollama 触发限流，请稍后再试', code: 'aiErrHttpRateLimit', params: { PROVIDER: 'Ollama' } }],
    ['ollama 503', () => ollama(resp(503)), { ok: false, error: 'Ollama 服务端错误：503', code: 'aiErrHttpServer', params: { PROVIDER: 'Ollama', STATUS: 503 } }],
    ['ollama 418 + detail', () => ollama(resp(418, { body: 'teapot' })), { ok: false, error: 'Ollama 请求失败：418 teapot', code: 'aiErrHttpOther', params: { PROVIDER: 'Ollama', STATUS: 418, DETAIL: 'teapot' } }],
    ['ollama 418 no detail', () => ollama(resp(418)), { ok: false, error: 'Ollama 请求失败：418', code: 'aiErrHttpOther', params: { PROVIDER: 'Ollama', STATUS: 418, DETAIL: '' } }],
    ['ollama unreachable', () => ollama(async () => { throw new TypeError('Failed to fetch'); }),
      { ok: false, error: 'Ollama 无法连接，请检查服务是否启动或网络是否可用', code: 'aiErrConnect', params: { PROVIDER: 'Ollama' } }],
    ['ollama timeout', () => ollama(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }),
      { ok: false, error: 'Ollama 请求超时', code: 'aiErrTimeout', params: { PROVIDER: 'Ollama' } }],
    ['ollama non-local url', () => ollama(resp(200), { aiBaseUrl: 'http://example.com' }),
      { ok: false, error: 'Ollama Base URL 仅支持本机地址 localhost / 127.0.0.1。', code: 'aiErrOllamaLocalOnly' }],
    ['openai passed', () => openai(resp(200, { json: { data: [] } })), { ok: true, message: '连接测试通过', code: 'aiTestOk' }],
    ['openai no key', () => openai(resp(200), { apiKey: '' }), { ok: false, error: '请先填写 API Key', code: 'aiErrApiKeyRequired' }],
    ['openai bad base url', () => openai(resp(200), { baseUrl: 'https://evil.example/v1' }),
      { ok: false, error: '暂不支持这个 Base URL。请使用内置平台预设，或本地 OpenAI-compatible 地址（localhost/127.0.0.1）。', code: 'aiErrBaseUrlUnsupported' }],
    ['grok: no active tab', () => loadBackground({ sync: { aiProvider: 'x-grok' }, tabs: [] }),
      { ok: false, error: '请在当前窗口打开 X 页面后再检查 Grok。', code: 'aiErrNoActiveTab' }],
    ['grok: not on X', () => loadBackground({ sync: { aiProvider: 'x-grok' }, disconnect: true }),
      { ok: false, error: '请切换到 X 页面并刷新后，再检查 Grok 就绪状态。', code: 'aiErrNotOnX' }],
    ['grok: no result', () => loadBackground({ sync: { aiProvider: 'x-grok' } }),
      { ok: false, error: '未收到 Grok 就绪检查结果，请刷新 X 后重试。', code: 'aiErrNoCheckResult' }],
    ['unexpected failure without message', () => loadBackground({ syncError: new Error('') }),
      { ok: false, error: '连接测试失败', code: 'aiTestFailed' }],
  ];

  for (const [name, make, expected] of cases) {
    it(`${name}: exact legacy text + code${expected.params ? ' + params' : ''}`, async () => {
      expect(await make().test()).toEqual(expected);
    });

    it(`${name}: zh_CN translation reproduces the legacy text exactly`, async () => {
      const res = await make().test();
      expect(loadResolver('zh_CN')(res, '<<legacy>>')).toBe(res.message || res.error);
    });
  }

  it('an uncoded error keeps the old { ok:false, error } shape', async () => {
    const res = await loadBackground({ syncError: new Error('boom') }).test();
    expect(res).toEqual({ ok: false, error: 'boom' });
  });

  it('the Grok reply from the page is forwarded untouched (code and params kept)', async () => {
    const reply = { ok: false, error: 'Grok 签名初始化失败：x', code: 'aiErrGrokSignInit', params: { REASON: 'x' } };
    expect(await loadBackground({ sync: { aiProvider: 'x-grok' }, reply }).test()).toEqual(reply);
  });

  it('translates every R2 background result in ja and en without leaving placeholders', async () => {
    for (const [, make] of cases) {
      const res = await make().test();
      for (const l of ['ja', 'en']) {
        const out = loadResolver(l)(res, '<<legacy>>');
        expect(out).not.toBe('<<legacy>>');
        expect(out).not.toContain('{{');
      }
    }
  });
});

describe('R1 generation responses: legacy error text preserved, codes added (I18N-003 R1)', () => {
  // The Chinese `error` strings are exactly what they were before R1; only
  // `code` / `params` were added. Full R1 propagation tests live in
  // ai-generation-errors-i18n.test.js.
  it('missing API key: same error text, now with a code', async () => {
    expect(await openai(resp(200), { apiKey: '' }).generate()).toEqual({ ok: false, error: '请先填写 API Key', code: 'aiErrApiKeyRequired' });
  });

  it('shared URL assertions: same error text, now with a code', async () => {
    expect(await openai(resp(200), { baseUrl: 'https://evil.example/v1' }).generate())
      .toEqual({ ok: false, error: '暂不支持这个 Base URL。请使用内置平台预设，或本地 OpenAI-compatible 地址（localhost/127.0.0.1）。', code: 'aiErrBaseUrlUnsupported' });
    expect(await ollama(resp(200), { aiBaseUrl: 'http://example.com' }).generate())
      .toEqual({ ok: false, error: 'Ollama Base URL 仅支持本机地址 localhost / 127.0.0.1。', code: 'aiErrOllamaLocalOnly' });
  });

  it('HTTP and network failures during generation: same error text, now with code/params', async () => {
    expect(await ollama(resp(503)).generate())
      .toEqual({ ok: false, error: 'Ollama 服务端错误：503', code: 'aiErrHttpServer', params: { PROVIDER: 'Ollama', STATUS: 503 } });
    expect(await ollama(async () => { throw new TypeError('x'); }).generate())
      .toEqual({ ok: false, error: 'Ollama 无法连接，请检查服务是否启动或网络是否可用', code: 'aiErrConnect', params: { PROVIDER: 'Ollama' } });
  });

  it('generation logic and streaming are untouched; only the error construction changed', () => {
    expect(bgSrc).toContain("sendResponse({ ok: true, comments: await generateWithOllama(config, message.payload || {}, emitProgress) });");
    expect(bgSrc).toContain("sendResponse({ ok: true, comments: await generateWithOpenAICompatible(config, message.payload || {}, emitProgress) });");
    expect(bgSrc).toContain("const reader = res.body?.getReader?.();");
    expect(bgSrc).toContain("throw codedError('请先填写模型名称', 'aiErrModelRequired');");
    expect(bgSrc).toContain("throw codedError('模型返回中没有解析到评论候选', 'aiErrNoComments');");
  });

  it('the prompt builder is untouched (I18N-010)', () => {
    expect(bgSrc).toContain('请只输出可直接发布的评论候选，优先使用代码块分隔。最多返回 ${replyCount} 条。');
  });
});

describe('R2 bridge: sanitizing and forwarding the Grok readiness result', () => {
  function loadSanitizer() {
    const start = bridgeSrc.indexOf('const AI_RESULT_CODE_RE');
    const end = bridgeSrc.indexOf('function safeChromeCall(', start);
    const ctx = {};
    vm.runInNewContext(`${bridgeSrc.slice(start, end)}; this.s = sanitizeAiResultMeta;`, ctx);
    return ctx.s;
  }

  // Run the real XVM_GROK_CHECK branch of the bridge's onMessage listener.
  function runCheck(pageResult, { timeout = false } = {}) {
    const start = bridgeSrc.indexOf("if (message?.type === 'XVM_GROK_CHECK') {");
    const end = bridgeSrc.indexOf('return true;\n    }', start) + 'return true;\n    }'.length;
    expect(start).toBeGreaterThan(-1);
    const san = bridgeSrc.slice(bridgeSrc.indexOf('const AI_RESULT_CODE_RE'), bridgeSrc.indexOf('function safeChromeCall('));
    const posted = [];
    let onResult;
    let pendingTimer;
    const ctx = {
      crypto: { randomUUID: () => 'uuid' },
      clearTimeout() {},
      setTimeout: (fn) => { pendingTimer = fn; return 1; },
      window: {
        removeEventListener() {},
        addEventListener: (_t, fn) => { onResult = fn; },
        postMessage: (m) => posted.push(m),
      },
    };
    ctx.window.self = ctx.window;
    vm.runInNewContext(`${san}; this.listener = (message, _s, sendResponse) => { ${bridgeSrc.slice(start, end)}\n return false; };`, ctx);
    let response;
    ctx.listener({ type: 'XVM_GROK_CHECK' }, {}, (r) => { response = r; });
    if (timeout) pendingTimer();
    else onResult({ source: ctx.window, data: { type: 'XVM_GROK_CHECK_RESULT', requestId: 'grok-check-uuid', result: pageResult } });
    return response;
  }

  it('keeps valid code and params, drops invalid ones', () => {
    const s = loadSanitizer();
    expect(s('aiErrHttpServer', { PROVIDER: 'P', STATUS: 503 })).toEqual({ code: 'aiErrHttpServer', params: { PROVIDER: 'P', STATUS: 503 } });
    expect(s('aiTestOk')).toEqual({ code: 'aiTestOk' });
    expect(s('aiTestFailed')).toEqual({ code: 'aiTestFailed' });
    for (const bad of ['<script>', 'aiErr', 'ai Err', 'x'.repeat(80), 7, null, undefined, {}, 'aiErr' + 'a'.repeat(60)]) {
      expect(s(bad, { A: 'b' })).toEqual({});
    }
    expect(s('aiErrX', { lower: 'x', OK: 'y', BAD: {}, ARR: [1], NAN: NaN, LONG: 'z'.repeat(301), NUM: 3 })).toEqual({ code: 'aiErrX', params: { OK: 'y', NUM: 3 } });
    expect(s('aiErrX', [1, 2])).toEqual({ code: 'aiErrX' });
    expect(s('aiErrX', 'str')).toEqual({ code: 'aiErrX' });
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`K${i}`, 'v']));
    expect(Object.keys(s('aiErrX', many).params).length).toBe(8);
  });

  it('success: legacy message kept, code aiOkGrokReady added, page fields not forwarded', () => {
    expect(runCheck({ ok: true, message: 'spoof', code: 'aiErrEvil', secret: 'tx-id' }))
      .toEqual({ ok: true, message: '已检测到 X 会话标记并生成签名（未验证生成接口）', code: 'aiOkGrokReady' });
  });

  it('failure: error string and validated code/params are forwarded', () => {
    expect(runCheck({ ok: false, error: 'Grok 签名初始化失败：x', code: 'aiErrGrokSignInit', params: { REASON: 'x' } }))
      .toEqual({ ok: false, error: 'Grok 签名初始化失败：x', code: 'aiErrGrokSignInit', params: { REASON: 'x' } });
  });

  it('failure: a spoofed code or params never reach the popup, the legacy string still does', () => {
    expect(runCheck({ ok: false, error: 'e', code: '<img onerror=1>', params: { PROVIDER: {} }, extra: 1 }))
      .toEqual({ ok: false, error: 'e' });
  });

  it('old-format failure keeps the exact old shape; empty failure gets the generic code', () => {
    expect(runCheck({ ok: false, error: '旧格式错误' })).toEqual({ ok: false, error: '旧格式错误' });
    expect(runCheck({ ok: false })).toEqual({ ok: false, error: 'Grok 就绪检查失败', code: 'aiErrGrokCheckFailed' });
    expect(runCheck(undefined)).toEqual({ ok: false, error: 'Grok 就绪检查失败', code: 'aiErrGrokCheckFailed' });
  });

  it('timeout: legacy text + aiErrGrokCheckTimeout', () => {
    expect(runCheck(null, { timeout: true }))
      .toEqual({ ok: false, error: 'Grok 就绪检查超时，请刷新 X 后重试。', code: 'aiErrGrokCheckTimeout' });
  });
});

describe('R2 grok-reply checkReady: message preserved, code added to errors only', () => {
  function load(opts = {}) {
    const listeners = [];
    const posted = [];
    const win = {
      __xvmNet: opts.fetch ? { originalFetch: opts.fetch, getBearer: () => 'Bearer t', onRequest() {} } : null,
      __xvmXct: opts.xct === undefined ? null : opts.xct,
      addEventListener(type, fn) { listeners.push([type, fn]); },
      postMessage: (m) => posted.push(m),
    };
    const ctx = {
      window: win, document: { cookie: opts.cookie || '' }, navigator: { language: 'zh-CN' },
      crypto: { randomUUID: () => 'u' }, TextDecoder, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
      atob: (s) => Buffer.from(s, 'base64').toString('binary'), console,
    };
    vm.createContext(ctx);
    vm.runInContext(grokSrc, ctx);
    const check = async () => {
      for (const [type, fn] of listeners) {
        if (type === 'message') fn({ source: win, data: { type: 'XVM_GROK_CHECK_REQUEST', requestId: 'r1' } });
      }
      await new Promise((r) => setTimeout(r, 0));
      return posted.find((m) => m.type === 'XVM_GROK_CHECK_RESULT')?.result;
    };
    return { grok: win.__xvmGrok, check };
  }

  it('no session: exact legacy error + aiErrGrokNoSession (also on the Error object)', async () => {
    const { grok, check } = load();
    await expect(grok.checkReady()).rejects.toMatchObject({ message: '未检测到 X 会话标记，请先登录 X 并刷新页面。', code: 'aiErrGrokNoSession' });
    expect(await check()).toEqual({ ok: false, error: '未检测到 X 会话标记，请先登录 X 并刷新页面。', code: 'aiErrGrokNoSession' });
  });

  it('missing signature module: exact legacy error + aiErrGrokXctMissing', async () => {
    const { check } = load({ cookie: 'ct0=c', xct: null });
    expect(await check()).toEqual({ ok: false, error: '插件未正确加载（lib/x-client-transaction.js 缺失），请重载扩展', code: 'aiErrGrokXctMissing' });
  });

  it('signature init failure keeps the dynamic reason in the message and in params', async () => {
    const { check } = load({ cookie: 'ct0=c', xct: { generateTxId: async () => { throw new Error('native module missing'); } } });
    expect(await check()).toEqual({
      ok: false,
      error: 'Grok 签名初始化失败：native module missing。请刷新 X 后重试；持续失败请更新插件。',
      code: 'aiErrGrokSignInit',
      params: { REASON: 'native module missing' },
    });
  });

  it('signature init failure with no reason uses the same fallback reason in both places', async () => {
    const { check } = load({ cookie: 'ct0=c', xct: { generateTxId: async () => { throw new Error(''); } } });
    const res = await check();
    expect(res.error).toContain('X 页面结构已变化');
    expect(res.params).toEqual({ REASON: 'X 页面结构已变化' });
  });

  it('success shape is exactly the old { ok, message } (the bridge adds aiOkGrokReady)', async () => {
    const { grok, check } = load({ cookie: 'ct0=c', xct: { generateTxId: async () => 'sig' } });
    await expect(grok.checkReady()).resolves.toEqual({ ok: true, message: '已检测到 X 会话标记并生成签名（未验证生成接口）' });
    expect(await check()).toEqual({ ok: true, message: '已检测到 X 会话标记并生成签名（未验证生成接口）' });
  });

  it('an error without code or message falls back to aiErrGrokCheckFailed', () => {
    expect(grokSrc).toContain("result.code = 'aiErrGrokCheckFailed'");
  });

  it('in-page generation (R3) errors keep their plain messages', async () => {
    const { grok } = load({ cookie: 'ct0=c', xct: null, fetch: async () => { throw new Error('must not send'); } });
    await expect(grok.generate({ tweetText: 't' })).rejects.toThrow('插件未正确加载（lib/x-client-transaction.js 缺失），请重载扩展');
    expect(grokSrc).toContain("throw new Error('Grok 返回中没有解析到评论代码块');");
    expect(grokSrc).toContain("throw new Error(`Grok 请求失败：${res.status} ${res.statusText || ''}`.trim());");
  });
});
