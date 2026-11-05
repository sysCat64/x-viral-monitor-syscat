// I18N-003 / R1 — external-provider (Ollama / OpenAI-compatible) generation errors.
//
// Chain under test (real source for every hop):
//   background.js XVM_AI_GENERATE  ->  bridge.js XVM_AI_GENERATE_RESULT
//   ->  content.js Error rebuild   ->  showGrokErrorToast()
// Contract: the legacy Chinese `error` text is unchanged; `code` / `params` are
// ADDED and only the final display is translated. Anything unexpected falls back
// to the legacy text. R2 (connection test) and R3 (in-page Grok) are unchanged.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');
const bgSrc = read('background.js');
const bridgeSrc = read('bridge.js');
const contentSrc = read('content.js');
const grokSrc = read('lib/grok-reply.js');
const LOCALES = ['en', 'ja', 'zh_CN'];
const locale = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));

const bridgeKeys = new Set(
  (bridgeSrc.match(/CONTENT_MESSAGE_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '')
    .match(/['"]([A-Za-z0-9_]+)['"]/g)?.map((s) => s.slice(1, -1)) || [],
);
// What bridge.js would push as `messages` for a locale (registered keys only).
const messagesFor = (l) => Object.fromEntries([...bridgeKeys].map((k) => [k, locale[l][k]?.message || k]));

// code -> params emitted for it by the generation path
const R1_CODES = {
  aiErrBaseUrlUnsupported: [], aiErrOllamaLocalOnly: [],
  aiErrHttpAuth: ['PROVIDER'], aiErrHttpNotFound: ['PROVIDER'], aiErrHttpRateLimit: ['PROVIDER'],
  aiErrHttpServer: ['PROVIDER', 'STATUS'], aiErrHttpOther: ['DETAIL', 'PROVIDER', 'STATUS'],
  aiErrTimeout: ['PROVIDER'], aiErrConnect: ['PROVIDER'], aiErrApiKeyRequired: [],
  aiErrNoComments: [], aiErrModelRequired: [], aiErrGrokRoute: [],
  aiErrGenerateFailed: [], aiErrGenerateTimeout: [],
};
const R1_NEW = ['aiErrNoComments', 'aiErrModelRequired', 'aiErrGrokRoute', 'aiErrGenerateFailed', 'aiErrGenerateTimeout'];

// ─── hop 1: background.js ───────────────────────────────────────────────────
function loadBackground({ sync = {}, local = {}, fetch, syncError } = {}) {
  let handler;
  vm.runInNewContext(bgSrc, {
    chrome: {
      runtime: { onMessage: { addListener: (fn) => { handler = fn; } } },
      storage: {
        sync: { get: async () => { if (syncError) throw syncError; return sync; } },
        local: { get: async () => local },
      },
      tabs: { query: async () => [], sendMessage: async () => undefined },
    },
    fetch, console, URL, AbortController, TextDecoder, setTimeout, clearTimeout, TypeError,
  });
  return () => new Promise((resolveFn) => handler({ type: 'XVM_AI_GENERATE', requestId: 'r', payload: { tweetText: 't' } }, { tab: { id: 1 } }, resolveFn));
}
const resp = (status, body = '') => async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const streamResp = (chunks) => async () => ({
  ok: true, status: 200,
  body: { getReader() { let i = 0; return { read: async () => (i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true }) }; } },
});
const ollamaGen = (fetch, extra = {}) => loadBackground({ sync: { aiProvider: 'ollama', aiModel: 'llama3.1', aiBaseUrl: 'http://localhost:11434', ...extra }, fetch });
const openaiGen = (fetch, { apiKey = 'k', baseUrl = 'https://api.openai.com/v1', model = 'm' } = {}) => loadBackground({
  sync: { aiProvider: 'openai-compatible', aiOpenAIPlatform: 'openai', aiBaseUrl: baseUrl, aiModel: model },
  local: { xvmAiApiKey: apiKey }, fetch,
});

// ─── hop 2: bridge.js ───────────────────────────────────────────────────────
function runBridge(res, { lastError } = {}) {
  const start = bridgeSrc.indexOf("if (type === 'XVM_AI_GENERATE' && typeof event.data.requestId === 'string') {");
  expect(start).toBeGreaterThan(-1);
  const end = bridgeSrc.indexOf('return;\n  }', start) + 'return;\n  }'.length;
  const san = bridgeSrc.slice(bridgeSrc.indexOf('const AI_RESULT_CODE_RE'), bridgeSrc.indexOf('function safeChromeCall('));
  const posted = [];
  const chrome = { runtime: { sendMessage: (_m, cb) => { chrome.runtime.lastError = lastError; cb(res); }, lastError: undefined } };
  const ctx = { chrome, window: { postMessage: (m) => posted.push(m) }, safeChromeCall: (fn) => fn() };
  vm.runInNewContext(`${san}; this.run = (event) => { const type = event.data.type; ${bridgeSrc.slice(start, end)} };`, ctx);
  ctx.run({ data: { type: 'XVM_AI_GENERATE', requestId: 'r1', payload: {} } });
  return posted[0];
}

// ─── hop 3: content.js Error rebuild ────────────────────────────────────────
function rebuildError(resultMessage) {
  const start = contentSrc.indexOf("window.addEventListener('message', (event) => {\n  if (event.source !== window) return;\n  if (event.origin !== window.location.origin) return;\n  if (event.data?.type === 'XVM_AI_GENERATE_PROGRESS')");
  const end = contentSrc.indexOf('// === Star Chart: GraphQL endpoint template capture', start);
  expect(start).toBeGreaterThan(-1);
  let handler;
  let rejected;
  const win = { location: { origin: 'https://x.com' }, addEventListener: (_t, fn) => { handler = fn; } };
  const pending = new Map([['r1', { resolve() {}, reject: (e) => { rejected = e; }, timer: 0 }]]);
  vm.runInNewContext(contentSrc.slice(start, end), { window: win, aiPendingRequests: pending, clearTimeout() {} });
  handler({ source: win, origin: 'https://x.com', data: resultMessage });
  return rejected;
}

// ─── hop 4: toast ───────────────────────────────────────────────────────────
function toastDetail(l, msg, coded, strings = messagesFor(l)) {
  const nodes = [];
  const makeEl = () => ({ style: {}, children: [], textContent: '', classList: { add() {} }, append(...c) { this.children.push(...c); } });
  const ctx = {
    document: { createElement: makeEl, body: { appendChild: (n) => nodes.push(n) } },
    requestAnimationFrame: (fn) => fn(), setTimeout() {}, dismissToast() {},
    localizedStrings: strings,
  };
  ctx.i18nOr = (k, f) => strings[k] || f;
  const start = contentSrc.indexOf('function showGrokErrorToast(');
  const end = contentSrc.indexOf('function getSelectedGrokPromptTemplate()', start);
  vm.runInNewContext(contentSrc.slice(start, end), ctx);
  ctx.showGrokErrorToast(msg, coded);
  return { title: nodes[0].children[0].textContent, detail: nodes[0].children[1].textContent };
}

// Full chain: background response -> bridge RESULT -> content Error -> toast.
function chain(bgResponse, l) {
  const result = runBridge(bgResponse);
  const err = rebuildError(result);
  return { result, err, toast: toastDetail(l, err.message, err) };
}

const scenarios = [
  ['ollama 401', () => ollamaGen(resp(401)), 'Ollama API Key 无效或没有权限', 'aiErrHttpAuth', { PROVIDER: 'Ollama' }],
  ['ollama 403', () => ollamaGen(resp(403)), 'Ollama API Key 无效或没有权限', 'aiErrHttpAuth', { PROVIDER: 'Ollama' }],
  ['ollama 404', () => ollamaGen(resp(404)), 'Ollama 模型或接口不存在，请检查 Base URL 和 Model', 'aiErrHttpNotFound', { PROVIDER: 'Ollama' }],
  ['ollama 429', () => ollamaGen(resp(429)), 'Ollama 触发限流，请稍后再试', 'aiErrHttpRateLimit', { PROVIDER: 'Ollama' }],
  ['ollama 503', () => ollamaGen(resp(503)), 'Ollama 服务端错误：503', 'aiErrHttpServer', { PROVIDER: 'Ollama', STATUS: 503 }],
  ['ollama 418 + detail', () => ollamaGen(resp(418, 'teapot')), 'Ollama 请求失败：418 teapot', 'aiErrHttpOther', { PROVIDER: 'Ollama', STATUS: 418, DETAIL: 'teapot' }],
  ['ollama 418 no detail', () => ollamaGen(resp(418)), 'Ollama 请求失败：418', 'aiErrHttpOther', { PROVIDER: 'Ollama', STATUS: 418, DETAIL: '' }],
  ['ollama unreachable', () => ollamaGen(async () => { throw new TypeError('x'); }), 'Ollama 无法连接，请检查服务是否启动或网络是否可用', 'aiErrConnect', { PROVIDER: 'Ollama' }],
  ['ollama timeout', () => ollamaGen(async () => { throw Object.assign(new Error('a'), { name: 'AbortError' }); }), 'Ollama 请求超时', 'aiErrTimeout', { PROVIDER: 'Ollama' }],
  ['ollama non-local url', () => ollamaGen(resp(200), { aiBaseUrl: 'http://example.com' }), 'Ollama Base URL 仅支持本机地址 localhost / 127.0.0.1。', 'aiErrOllamaLocalOnly', undefined],
  ['ollama no comments', () => ollamaGen(resp(200)), '模型返回中没有解析到评论候选', 'aiErrNoComments', undefined],
  ['openai no key', () => openaiGen(resp(200), { apiKey: '' }), '请先填写 API Key', 'aiErrApiKeyRequired', undefined],
  ['openai no model', () => openaiGen(resp(200), { model: ' ' }), '请先填写模型名称', 'aiErrModelRequired', undefined],
  ['openai bad base url', () => openaiGen(resp(200), { baseUrl: 'https://evil.example/v1' }), '暂不支持这个 Base URL。请使用内置平台预设，或本地 OpenAI-compatible 地址（localhost/127.0.0.1）。', 'aiErrBaseUrlUnsupported', undefined],
  ['openai no comments', () => openaiGen(resp(200)), '模型返回中没有解析到评论候选', 'aiErrNoComments', undefined],
  ['openai 429', () => openaiGen(resp(429)), 'OpenAI 触发限流，请稍后再试', 'aiErrHttpRateLimit', { PROVIDER: 'OpenAI' }],
  ['grok provider misrouted', () => loadBackground({ sync: { aiProvider: 'x-grok' } }), '当前 Provider 使用 X Grok，请走页面内 Grok 生成路径', 'aiErrGrokRoute', undefined],
  ['unexpected failure without message', () => loadBackground({ syncError: new Error('') }), 'AI 生成失败', 'aiErrGenerateFailed', undefined],
];

describe('R1 locale keys', () => {
  it('every R1 code is a locale key in en, ja and zh_CN and is registered in CONTENT_MESSAGE_KEYS', () => {
    for (const l of LOCALES) for (const k of Object.keys(R1_CODES)) expect(locale[l][k]?.message, `${l}:${k}`).toBeTruthy();
    expect(Object.keys(R1_CODES).filter((k) => !bridgeKeys.has(k))).toEqual([]);
  });

  it('each message uses exactly the {{NAME}} params its code emits, with no $-style placeholders', () => {
    for (const l of LOCALES) {
      for (const [code, params] of Object.entries(R1_CODES)) {
        const found = [...new Set((locale[l][code].message.match(/\{\{([A-Z0-9_]+)\}\}/g) || []).map((m) => m.slice(2, -2)))].sort();
        expect(found, `${l}:${code}`).toEqual([...params].sort());
        expect(locale[l][code].message).not.toMatch(/\$[A-Za-z0-9]/);
      }
    }
  });

  it('adds only the R1-specific keys (R2 keys are reused)', () => {
    for (const k of R1_NEW) expect(contentSrc.includes(`'${k}'`) || bgSrc.includes(`'${k}'`), k).toBe(true);
  });

  it('registers exactly the R3 (in-page Grok generation) codes it needs; R2-only codes stay unregistered', () => {
    // Generation-path codes (R3). aiErrGrokXctMissing / aiErrGrokSignInit are defined by R2 and reused.
    for (const k of ['aiErrGrokNoCapturedTx', 'aiErrGrokXctMissing', 'aiErrGrokSignInit', 'aiErrGrokNotSent',
      'aiErrGrok404Stale', 'aiErrGrok404Rejected', 'aiErrGrokRequestFailed', 'aiErrGrokNoComments', 'aiErrGrokModuleMissing']) {
      expect(bridgeKeys.has(k), `${k} should be registered`).toBe(true);
    }
    // Used only by the popup connection test (R2): not needed in the content script.
    for (const k of ['aiErrGrokNoSession', 'aiErrGrokCheckFailed', 'aiErrGrokCheckTimeout', 'aiOkGrokReady',
      'aiErrNoActiveTab', 'aiErrNotOnX', 'aiErrNoCheckResult', 'aiOkOllamaConnected', 'aiOkOllamaModelMissing']) {
      expect(bridgeKeys.has(k), `${k} should stay unregistered`).toBe(false);
    }
  });
});

describe('R1 background: exact legacy error text + code/params', () => {
  for (const [name, make, legacy, code, params] of scenarios) {
    it(`${name}`, async () => {
      const res = await make()();
      expect(res.ok).toBe(false);
      expect(res.error).toBe(legacy);
      expect(res.code).toBe(code);
      if (params) expect(res.params).toEqual(params);
      else expect(res.params).toBeUndefined();
      expect(Object.keys(res).every((k) => ['ok', 'error', 'code', 'params'].includes(k))).toBe(true);
    });
  }

  it('success responses are exactly the old { ok, comments } (no code)', async () => {
    const body = '{"message":{"content":"```\\nfirst reply\\n```\\n```\\nsecond reply\\n```"}}\n';
    const res = await ollamaGen(streamResp([body]))();
    expect(res.ok).toBe(true);
    expect(res.comments).toEqual(['first reply', 'second reply']);
    expect(Object.keys(res).sort()).toEqual(['comments', 'ok']);
  });
});

describe('R1 bridge: forwards validated code/params, never mixes with runtime errors', () => {
  it('forwards a valid code and params next to the unchanged error text', () => {
    const r = runBridge({ ok: false, error: 'Ollama 服务端错误：503', code: 'aiErrHttpServer', params: { PROVIDER: 'Ollama', STATUS: 503 } });
    expect(r).toEqual({ type: 'XVM_AI_GENERATE_RESULT', requestId: 'r1', ok: false, comments: [], error: 'Ollama 服务端错误：503', code: 'aiErrHttpServer', params: { PROVIDER: 'Ollama', STATUS: 503 } });
  });

  it('keeps the old shape for an uncoded failure', () => {
    expect(runBridge({ ok: false, error: '旧格式' })).toEqual({ type: 'XVM_AI_GENERATE_RESULT', requestId: 'r1', ok: false, comments: [], error: '旧格式' });
  });

  it('drops spoofed / malformed codes and params', () => {
    const r = runBridge({ ok: false, error: 'e', code: '<img onerror=1>', params: { PROVIDER: {} } });
    expect(r.code).toBeUndefined();
    expect(r.params).toBeUndefined();
    const r2 = runBridge({ ok: false, error: 'e', code: 'aiErrHttpServer', params: { lower: 'x', STATUS: NaN, OK: 'y' } });
    expect(r2.params).toEqual({ OK: 'y' });
  });

  it('a chrome.runtime.lastError wins: its message is used and no code is applied', () => {
    const r = runBridge({ ok: false, error: 'from response', code: 'aiErrHttpAuth', params: { PROVIDER: 'X' } }, { lastError: { message: 'Could not establish connection' } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Could not establish connection');
    expect(r.code).toBeUndefined();
    expect(r.params).toBeUndefined();
  });

  it('a successful response carries no code even if one is present', () => {
    const r = runBridge({ ok: true, comments: ['a'], code: 'aiErrHttpAuth' });
    expect(r).toEqual({ type: 'XVM_AI_GENERATE_RESULT', requestId: 'r1', ok: true, comments: ['a'], error: '' });
  });
});

describe('R1 content.js: Error rebuild keeps message, code and params', () => {
  it('rebuilds a coded Error', () => {
    const err = rebuildError({ type: 'XVM_AI_GENERATE_RESULT', requestId: 'r1', ok: false, error: 'Ollama 请求超时', code: 'aiErrTimeout', params: { PROVIDER: 'Ollama' } });
    expect(err.name).toBe('Error'); // (cross-realm, so no instanceof)
    expect(err.message).toBe('Ollama 请求超时');
    expect(err.code).toBe('aiErrTimeout');
    expect(err.params).toEqual({ PROVIDER: 'Ollama' });
  });

  it('old-format result: message only, no code', () => {
    const err = rebuildError({ type: 'XVM_AI_GENERATE_RESULT', requestId: 'r1', ok: false, error: '旧格式' });
    expect(err.message).toBe('旧格式');
    expect(err.code).toBeUndefined();
  });

  it('empty error: legacy fallback text plus aiErrGenerateFailed', () => {
    const err = rebuildError({ type: 'XVM_AI_GENERATE_RESULT', requestId: 'r1', ok: false, error: '' });
    expect(err.message).toBe('AI 生成失败');
    expect(err.code).toBe('aiErrGenerateFailed');
  });

  it('a runtime error message (no code) stays uncoded', () => {
    const err = rebuildError({ type: 'XVM_AI_GENERATE_RESULT', requestId: 'r1', ok: false, error: 'Could not establish connection' });
    expect(err.code).toBeUndefined();
  });

  it('the client-side generation timeout keeps its message and gains a code', () => {
    expect(contentSrc).toContain("reject(Object.assign(new Error('AI 生成超时，请检查服务连接'), { code: 'aiErrGenerateTimeout' }))");
  });

  it('the generation catch still passes the original message first', () => {
    expect(contentSrc).toContain("showGrokErrorToast(err?.message || 'AI 生成失败', err?.message ? err : { code: 'aiErrGenerateFailed' });");
  });
});

describe('R1 toast display', () => {
  const coded = { code: 'aiErrHttpServer', params: { PROVIDER: 'OpenAI', STATUS: 503 } };

  it('translates per locale and keeps the dynamic values', () => {
    expect(toastDetail('ja', 'legacy', coded).detail).toBe('OpenAI: サーバーエラー（503）');
    expect(toastDetail('en', 'legacy', coded).detail).toBe('OpenAI: server error (503)');
    expect(toastDetail('zh_CN', 'legacy', coded).detail).toBe('OpenAI 服务端错误：503');
  });

  it('does not change the already localized title (I18N-002)', () => {
    expect(toastDetail('ja', 'x', coded).title).toBe('⚠ AI 生成に失敗しました');
    expect(toastDetail('en', 'x', coded).title).toBe('⚠ AI generation failed');
  });

  it('existing one-argument calls are unchanged', () => {
    expect(toastDetail('ja', 'HTTP 429').detail).toBe('HTTP 429');
    expect(toastDetail('ja', '').detail).toBe('もう一度お試しください');
  });

  it('falls back to the legacy message for unknown, unregistered, invalid and old-format errors', () => {
    expect(toastDetail('ja', 'legacy', { code: 'aiErrDoesNotExist' }).detail).toBe('legacy');
    expect(toastDetail('ja', 'legacy', { code: 'aiErrGrokNoSession' }).detail).toBe('legacy'); // R2-only code: not registered in the content script
    expect(toastDetail('ja', 'legacy', { code: '<script>' }).detail).toBe('legacy');
    expect(toastDetail('ja', 'legacy', { message: 'plain' }).detail).toBe('legacy');
    expect(toastDetail('ja', 'legacy', null).detail).toBe('legacy');
    // a raw key (unresolved by bridge) is treated as unresolved
    expect(toastDetail('ja', 'legacy', coded, { aiErrHttpServer: 'aiErrHttpServer' }).detail).toBe('legacy');
    // before settings arrive (no strings at all)
    expect(toastDetail('ja', 'legacy', coded, {}).detail).toBe('legacy');
  });

  it('falls back (never shows a raw {{NAME}}) for missing or invalid params', () => {
    for (const params of [undefined, {}, { PROVIDER: 'OpenAI' }, { PROVIDER: 'OpenAI', STATUS: {} }, { PROVIDER: 'OpenAI', STATUS: NaN },
      { PROVIDER: 'OpenAI', STATUS: 'x'.repeat(301) }, [], 'str', Object.create({ PROVIDER: 'p', STATUS: 1 })]) {
      expect(toastDetail('ja', 'legacy', { code: 'aiErrHttpServer', params }).detail, JSON.stringify(params)).toBe('legacy');
    }
  });

  it('substitutes in one pass: $-patterns and {{NAME}} inside values stay verbatim', () => {
    const out = toastDetail('en', 'legacy', { code: 'aiErrHttpOther', params: { PROVIDER: 'P$&', STATUS: 418, DETAIL: '$1 $$ {{PROVIDER}} {{STATUS}}' } }).detail;
    expect(out).toBe('P$&: request failed (418) $1 $$ {{PROVIDER}} {{STATUS}}');
  });

  it('a missing key placeholder is detected on the template, not on substituted values', () => {
    // A value that merely looks like a placeholder must not be mistaken for a missing one.
    const ok = toastDetail('en', 'legacy', { code: 'aiErrHttpRateLimit', params: { PROVIDER: '{{STATUS}}' } }).detail;
    expect(ok).toBe('{{STATUS}}: rate limited. Please try again later.');
  });
});

describe('R1 end to end: background -> bridge -> content -> toast', () => {
  for (const [name, make, legacy, code] of scenarios) {
    it(`${name}: zh_CN display equals the legacy text exactly`, async () => {
      const bg = await make()();
      const { err, toast } = chain(bg, 'zh_CN');
      expect(err.code).toBe(code);
      expect(toast.detail).toBe(bg.error);
      expect(toast.detail).toBe(legacy);
    });

    it(`${name}: ja and en are translated, with no placeholder left`, async () => {
      const bg = await make()();
      for (const l of ['ja', 'en']) {
        const { toast } = chain(bg, l);
        expect(toast.detail).not.toBe(bg.error);
        expect(toast.detail).not.toContain('{{');
        expect(toast.detail.trim().length).toBeGreaterThan(0);
      }
    });
  }

  it('dynamic details survive the whole chain (status and server detail)', async () => {
    const bg = await ollamaGen(resp(418, 'I am a teapot'))();
    expect(chain(bg, 'ja').toast.detail).toBe('Ollama: リクエストに失敗しました（418） I am a teapot');
    expect(chain(await ollamaGen(resp(502))(), 'en').toast.detail).toBe('Ollama: server error (502)');
  });

  it('a runtime lastError is shown as-is (never replaced by a response code)', () => {
    const result = runBridge({ ok: false, error: 'x', code: 'aiErrHttpAuth', params: { PROVIDER: 'X' } }, { lastError: { message: 'Extension context invalidated.' } });
    const err = rebuildError(result);
    expect(toastDetail('ja', err.message, err).detail).toBe('Extension context invalidated.');
  });
});

describe('R2 and R3 are unchanged by R1', () => {
  it('R2: the connection-test handler and its helper keep their R2 shape', async () => {
    const test = (cfg) => new Promise((resolveFn) => {
      let handler;
      vm.runInNewContext(bgSrc, {
        chrome: { runtime: { onMessage: { addListener: (fn) => { handler = fn; } } }, storage: { sync: { get: async () => cfg.sync }, local: { get: async () => ({}) } }, tabs: { query: async () => [], sendMessage: async () => undefined } },
        fetch: cfg.fetch, console, URL, AbortController, TextDecoder, setTimeout, clearTimeout, TypeError,
      });
      handler({ type: 'XVM_AI_TEST_CONNECTION' }, {}, resolveFn);
    });
    expect(await test({ sync: { aiProvider: 'ollama', aiBaseUrl: 'http://localhost:11434', aiModel: 'llama3.1' }, fetch: resp(503) }))
      .toEqual({ ok: false, error: 'Ollama 服务端错误：503', code: 'aiErrHttpServer', params: { PROVIDER: 'Ollama', STATUS: 503 } });
    expect(bgSrc).toContain("response.code = 'aiTestFailed';");
  });

  it('R3: the in-page Grok error messages are unchanged (codes are covered by grok-generation-errors-i18n.test.js)', () => {
    expect(contentSrc).toContain("new Error('插件未正确加载（lib/grok-reply.js 缺失），请重载扩展')");
    expect(grokSrc).toContain("new Error('Grok 返回中没有解析到评论代码块')");
    expect(grokSrc).toContain("new Error(`Grok 请求失败：${res.status} ${res.statusText || ''}`.trim())");
    expect(grokSrc).toContain("new Error('Grok 请求未能发送，请刷新 X 后重试。')");
  });

  it('the prompt builder and licensing are untouched', () => {
    expect(bgSrc).toContain('请只输出可直接发布的评论候选，优先使用代码块分隔。最多返回 ${replyCount} 条。');
  });
});
