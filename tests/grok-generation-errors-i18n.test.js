// I18N-003 / R3 — in-page Grok generation errors.
//
// Chain: lib/grok-reply.js generate() throws an Error carrying `code` (a locale
// key) and optional `params`; the SAME Error object reaches content.js's
// handleGrokGenerate() catch (same MAIN world) and showGrokErrorToast() translates
// it through R1's aiErrorText(). `Error.message` (the legacy Chinese text) is
// unchanged. R1 and R2 contracts are unchanged.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');
const grokSrc = read('lib/grok-reply.js');
const contentSrc = read('content.js');
const bridgeSrc = read('bridge.js');
const LOCALES = ['en', 'ja', 'zh_CN'];
const locale = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));
const bridgeKeys = new Set(
  (bridgeSrc.match(/CONTENT_MESSAGE_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '')
    .match(/['"]([A-Za-z0-9_]+)['"]/g)?.map((s) => s.slice(1, -1)) || [],
);
const messagesFor = (l) => Object.fromEntries([...bridgeKeys].map((k) => [k, locale[l][k]?.message || k]));

// code -> params emitted for it on the generation path
const R3_CODES = {
  aiErrGrokNoCapturedTx: [], aiErrGrokXctMissing: [], aiErrGrokSignInit: ['REASON'], aiErrGrokNotSent: [],
  aiErrGrok404Stale: [], aiErrGrok404Rejected: [], aiErrGrokRequestFailed: ['STATUS', 'STATUSTEXT'],
  aiErrGrokNoComments: [], aiErrGrokModuleMissing: [],
};
const R3_NEW = ['aiErrGrokNoCapturedTx', 'aiErrGrokNotSent', 'aiErrGrok404Stale', 'aiErrGrok404Rejected',
  'aiErrGrokRequestFailed', 'aiErrGrokNoComments', 'aiErrGrokModuleMissing'];

// ─── grok-reply.js harness ──────────────────────────────────────────────────
const ndjson = (message) => JSON.stringify({ result: { sender: 'ASSISTANT', messageTag: 'final', message } });
function loadGrok({ capturedTxId, fetchQueue, xct, cookie = 'ct0=c' } = {}) {
  const queue = [...(fetchQueue || [])];
  const win = {
    __xvmNet: fetchQueue ? {
      originalFetch: async () => {
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return {
          ok: next.status >= 200 && next.status < 300, status: next.status, statusText: next.statusText ?? '',
          body: { cancel() {} }, text: async () => next.text ?? '',
        };
      },
      getBearer: () => 'Bearer t', onRequest() {},
    } : null,
    __xvmXct: xct === undefined ? { generateTxId: async () => 'sig', reset() {} } : xct,
    __xvmGrok: capturedTxId ? { __capturedTxId: capturedTxId } : undefined,
    addEventListener() {}, postMessage() {},
  };
  const ctx = {
    window: win, document: { cookie }, navigator: { language: 'zh-CN' }, crypto: { randomUUID: () => 'u' },
    TextDecoder, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), console: { ...console, error() {}, debug() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(grokSrc, ctx);
  return win.__xvmGrok;
}
async function failure(opts) {
  try { await loadGrok(opts).generate({ tweetText: 'tweet' }); } catch (e) { return e; }
  throw new Error('generate() was expected to fail');
}

// ─── content.js toast (R1 display path, reused) ─────────────────────────────
function toast(l, msg, coded, strings = messagesFor(l)) {
  const nodes = [];
  const el = () => ({ style: {}, children: [], textContent: '', classList: { add() {} }, append(...c) { this.children.push(...c); } });
  const ctx = { document: { createElement: el, body: { appendChild: (n) => nodes.push(n) } }, requestAnimationFrame: (fn) => fn(), setTimeout() {}, dismissToast() {}, localizedStrings: strings };
  ctx.i18nOr = (k, f) => strings[k] || f;
  const start = contentSrc.indexOf('function showGrokErrorToast(');
  vm.runInNewContext(contentSrc.slice(start, contentSrc.indexOf('function getSelectedGrokPromptTemplate()', start)), ctx);
  ctx.showGrokErrorToast(msg, coded);
  return nodes[0].children[1].textContent;
}

const scenarios = [
  ['signature module missing', () => ({ cookie: 'ct0=c', xct: null }),
    '插件未正确加载（lib/x-client-transaction.js 缺失），请重载扩展', 'aiErrGrokXctMissing', undefined],
  ['signature init failed', () => ({ xct: { generateTxId: async () => { throw new Error('native module missing'); } } }),
    'Grok 签名初始化失败：native module missing。请刷新 X 后重试；持续失败请更新插件。', 'aiErrGrokSignInit', { REASON: 'native module missing' }],
  ['signature init failed, no reason', () => ({ xct: { generateTxId: async () => { throw new Error(''); } } }),
    'Grok 签名初始化失败：X 页面结构已变化。请刷新 X 后重试；持续失败请更新插件。', 'aiErrGrokSignInit', { REASON: 'X 页面结构已变化' }],
  ['404 rejected signature', () => ({ fetchQueue: [{ status: 404 }, { status: 404 }] }),
    'Grok 请求 404（X 未接受当前签名或接口已变化）。请刷新 X 后重试；持续失败请更新插件。', 'aiErrGrok404Rejected', undefined],
  ['404 stale cached signature', () => ({ capturedTxId: 'cap-tx', fetchQueue: [new Error('net'), { status: 404 }, { status: 404 }, { status: 404 }] }),
    'Grok 请求 404（缓存签名已失效）。请刷新 X 后重试；持续失败请更新插件。', 'aiErrGrok404Stale', undefined],
  ['HTTP 500 with status text', () => ({ fetchQueue: [{ status: 500, statusText: 'Internal Server Error' }] }),
    'Grok 请求失败：500 Internal Server Error', 'aiErrGrokRequestFailed', { STATUS: 500, STATUSTEXT: 'Internal Server Error' }],
  ['HTTP 403 without status text', () => ({ fetchQueue: [{ status: 403 }] }),
    'Grok 请求失败：403', 'aiErrGrokRequestFailed', { STATUS: 403, STATUSTEXT: '' }],
  ['no parsable reply', () => ({ fetchQueue: [{ status: 200, text: ndjson('only one') }] }),
    'Grok 返回中没有解析到评论代码块', 'aiErrGrokNoComments', undefined],
];

describe('R3 locale keys and registration', () => {
  it('every R3 code is a locale key in en, ja and zh_CN', () => {
    for (const l of LOCALES) for (const k of Object.keys(R3_CODES)) expect(locale[l][k]?.message, `${l}:${k}`).toBeTruthy();
  });

  it('each message uses exactly the {{NAME}} params its code emits, no $-style placeholders', () => {
    for (const l of LOCALES) {
      for (const [code, params] of Object.entries(R3_CODES)) {
        const found = [...new Set((locale[l][code].message.match(/\{\{([A-Z0-9_]+)\}\}/g) || []).map((m) => m.slice(2, -2)))].sort();
        expect(found, `${l}:${code}`).toEqual([...params].sort());
        expect(locale[l][code].message).not.toMatch(/\$[A-Za-z0-9]/);
      }
    }
  });

  it('every R3 code is registered in CONTENT_MESSAGE_KEYS exactly once', () => {
    const list = bridgeSrc.match(/CONTENT_MESSAGE_KEYS\s*=\s*\[([\s\S]*?)\]/)[1].match(/['"]([A-Za-z0-9_]+)['"]/g).map((s) => s.slice(1, -1));
    for (const k of Object.keys(R3_CODES)) expect(list.filter((x) => x === k).length, k).toBe(1);
  });

  it('reuses the R2-defined keys instead of redefining them', () => {
    for (const k of ['aiErrGrokXctMissing', 'aiErrGrokSignInit']) {
      expect(R3_NEW.includes(k)).toBe(false);
      expect(grokSrc).toContain(`code: '${k}'`);
    }
    // R2-only codes are not registered for the content script
    for (const k of ['aiErrGrokNoSession', 'aiErrGrokCheckFailed', 'aiErrGrokCheckTimeout']) expect(bridgeKeys.has(k)).toBe(false);
  });
});

describe('R3 grok-reply generate(): legacy message + code + params on the Error', () => {
  for (const [name, make, legacy, code, params] of scenarios) {
    it(`${name}: message unchanged, code ${code}`, async () => {
      const err = await failure(make());
      expect(err.message).toBe(legacy);
      expect(err.code).toBe(code);
      if (params) expect(err.params).toEqual(params);
      else expect(err.params).toBeUndefined();
    });
  }

  it('the 404 variants are distinguished', async () => {
    const stale = (await failure(scenarios.find((s) => s[0].startsWith('404 stale'))[1]())).code;
    const rejected = (await failure(scenarios.find((s) => s[0].startsWith('404 rejected'))[1]())).code;
    expect([stale, rejected]).toEqual(['aiErrGrok404Stale', 'aiErrGrok404Rejected']);
  });

  it('a network failure keeps the browser message and carries no code', async () => {
    const err = await failure({ fetchQueue: [new Error('Failed to fetch'), new Error('Failed to fetch')] });
    expect(err.message).toBe('Failed to fetch');
    expect(err.code).toBeUndefined();
  });

  it('the remaining throw sites (never reachable from the test harness) keep their messages and carry codes', () => {
    expect(grokSrc).toContain("Object.assign(new Error('请打开 X 内置 Grok（x.com/i/grok）随便发一条消息，让插件抓到一个有效签名后再试。'), { code: 'aiErrGrokNoCapturedTx' })");
    expect(grokSrc).toContain("Object.assign(new Error('Grok 请求未能发送，请刷新 X 后重试。'), { code: 'aiErrGrokNotSent' })");
    expect(contentSrc).toContain("Object.assign(new Error('插件未正确加载（lib/grok-reply.js 缺失），请重载扩展'), { code: 'aiErrGrokModuleMissing' })");
  });

  it('the same Error object reaches the handleGrokGenerate catch (no re-wrapping on the Grok path)', () => {
    const fn = contentSrc.slice(contentSrc.indexOf('async function handleGrokGenerate('), contentSrc.indexOf('function closeOpenMenus('));
    expect(fn).toContain('return window.__xvmGrok.generate({');
    expect(fn).toContain("showGrokErrorToast(err?.message || 'AI 生成失败', err?.message ? err : { code: 'aiErrGenerateFailed' });");
    expect(fn).not.toMatch(/new Error\(err/);
  });
});

describe('R3 toast display (R1 aiErrorText reused)', () => {
  for (const [name, make, legacy, code] of scenarios) {
    it(`${name}: zh_CN equals the legacy text; ja and en are translated`, async () => {
      const err = await failure(make());
      expect(toast('zh_CN', err.message, err)).toBe(legacy);
      for (const l of ['ja', 'en']) {
        const out = toast(l, err.message, err);
        expect(out, `${l}:${code}`).not.toBe(legacy);
        expect(out).not.toContain('{{');
        expect(out.trim().length).toBeGreaterThan(0);
      }
    });
  }

  it('keeps dynamic values (HTTP status, status text, signature failure reason)', async () => {
    const http = await failure({ fetchQueue: [{ status: 502, statusText: 'Bad Gateway' }] });
    expect(toast('ja', http.message, http)).toBe('Grok のリクエストに失敗しました: 502 Bad Gateway');
    expect(toast('en', http.message, http)).toBe('Grok request failed: 502 Bad Gateway');
    const sig = await failure({ xct: { generateTxId: async () => { throw new Error('native module missing'); } } });
    expect(toast('ja', sig.message, sig)).toContain('native module missing');
  });

  it('an empty status text is valid and leaves no trailing space', async () => {
    const err = await failure({ fetchQueue: [{ status: 403 }] });
    expect(toast('en', err.message, err)).toBe('Grok request failed: 403');
    expect(toast('ja', err.message, err)).toBe('Grok のリクエストに失敗しました: 403');
  });

  it('falls back to the legacy message for unknown, unregistered and invalid input', () => {
    expect(toast('ja', 'legacy', { code: 'aiErrGrokDoesNotExist' })).toBe('legacy');
    expect(toast('ja', 'legacy', { code: 'aiErrGrokNoSession' })).toBe('legacy'); // R2-only, unregistered
    expect(toast('ja', 'legacy', { code: '<img>' })).toBe('legacy');
    expect(toast('ja', 'legacy', { message: 'old format error without a code' })).toBe('legacy');
    expect(toast('ja', 'legacy', { code: 'aiErrGrok404Stale' }, { aiErrGrok404Stale: 'aiErrGrok404Stale' })).toBe('legacy'); // raw key
  });

  it('falls back for missing or invalid params (never shows a raw {{NAME}})', () => {
    for (const params of [undefined, {}, { STATUS: 500 }, { STATUS: {}, STATUSTEXT: 'x' }, { STATUS: NaN, STATUSTEXT: 'x' },
      { STATUS: 500, STATUSTEXT: 'x'.repeat(301) }, [], 'str', Object.create({ STATUS: 1, STATUSTEXT: 'x' })]) {
      expect(toast('ja', 'legacy', { code: 'aiErrGrokRequestFailed', params }), JSON.stringify(params)).toBe('legacy');
    }
    expect(toast('ja', 'legacy', { code: 'aiErrGrokSignInit', params: {} })).toBe('legacy');
  });

  it('substitutes once and verbatim: $-patterns and {{NAME}} inside values are not reinterpreted', () => {
    const out = toast('en', 'legacy', { code: 'aiErrGrokSignInit', params: { REASON: '$& $1 $$ {{REASON}}' } });
    expect(out).toBe('Grok signature initialization failed: $& $1 $$ {{REASON}}. Refresh X and try again; if it keeps failing, update the extension.');
  });

  it('before translations arrive, the legacy Chinese text is shown', async () => {
    const err = await failure({ fetchQueue: [{ status: 500, statusText: 'x' }] });
    expect(toast('ja', err.message, err, {})).toBe('Grok 请求失败：500 x');
  });
});

describe('R1, R2 and the success path are unchanged by R3', () => {
  it('R1: an external-provider error still translates through the same toast', () => {
    const coded = { code: 'aiErrHttpServer', params: { PROVIDER: 'OpenAI', STATUS: 503 } };
    expect(toast('ja', 'legacy', coded)).toBe('OpenAI: サーバーエラー（503）');
    expect(toast('ja', 'HTTP 429')).toBe('HTTP 429');
  });

  it('R2: checkReady keeps its exact success shape and the connection-test codes', async () => {
    const grok = loadGrok({ cookie: 'ct0=c' });
    await expect(grok.checkReady()).resolves.toEqual({ ok: true, message: '已检测到 X 会话标记并生成签名（未验证生成接口）' });
    await expect(loadGrok({ cookie: '' }).checkReady()).rejects.toMatchObject({ code: 'aiErrGrokNoSession' });
    expect(grokSrc).toContain("result.code = 'aiErrGrokCheckFailed'");
  });

  it('a successful generation still resolves to the comment list (no code, no wrapping)', async () => {
    const grok = loadGrok({ fetchQueue: [{ status: 200, text: ndjson('```\n第一条\n```\n```\n第二条\n```') }] });
    await expect(grok.generate({ tweetText: 't' })).resolves.toEqual(['第一条', '第二条']);
  });

  it('request building, signing and stream reading are untouched', () => {
    expect(grokSrc).toContain("return sendFetch(ENDPOINT, { method: 'POST', headers, body, credentials: 'include' });");
    expect(grokSrc).toContain('const finalText = await readStream(res, onProgress);');
    expect(grokSrc).toContain('txId = await window.__xvmXct.generateTxId');
  });
});
