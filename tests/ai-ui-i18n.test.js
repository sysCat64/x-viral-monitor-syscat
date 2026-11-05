// I18N-002 — AI reply generation UI in content.js must resolve through the
// existing i18n path (locale bundle -> bridge CONTENT_MESSAGE_KEYS ->
// localizedStrings -> i18nOr), not hard-coded Chinese.
//
// Boundary with I18N-003: Error messages thrown/relayed on the
// background/bridge/grok-reply contract ({ ok, error, message }) are NOT part
// of this change and are intentionally still literal strings.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');
const contentSrc = read('content.js');
const bridgeSrc = read('bridge.js');
const LOCALES = ['en', 'ja', 'zh_CN'];
const locale = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));

const AI_KEYS = [
  'contentAiButtonLabel', 'contentAiButtonGenerating', 'contentAiButtonTitle',
  'contentAiTemplateMenuTitle', 'contentAiOptionsTitle', 'contentAiOptionsGenerating',
  'contentAiOptionsCount', 'contentAiOptionFillTitle', 'contentAiOptionFilledToast',
  'contentAiErrorTitle', 'contentAiErrorRetry', 'contentAiNoTweetFound',
];

const bridgeKeys = new Set(
  (bridgeSrc.match(/CONTENT_MESSAGE_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '')
    .match(/['"]([A-Za-z0-9_]+)['"]/g)?.map((s) => s.slice(1, -1)) || [],
);

// localizedStrings as bridge.js would push them for a given locale.
const messagesFor = (l) => Object.fromEntries(
  [...bridgeKeys].map((k) => [k, locale[l][k]?.message || k]),
);

function slice(startMarker, endMarker) {
  const start = contentSrc.indexOf(startMarker);
  const end = contentSrc.indexOf(endMarker, start);
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1);
  expect(end, `${endMarker} not found`).toBeGreaterThan(start);
  return contentSrc.slice(start, end);
}

describe('I18N-002 AI UI keys', () => {
  it('every contentAi* key exists in en, ja and zh_CN', () => {
    for (const l of LOCALES) {
      for (const k of AI_KEYS) expect(locale[l][k]?.message, `${l}:${k}`).toBeTruthy();
    }
  });

  it('every contentAi* key is registered in bridge.js CONTENT_MESSAGE_KEYS', () => {
    expect(AI_KEYS.filter((k) => !bridgeKeys.has(k))).toEqual([]);
  });

  it('content.js uses every contentAi* key (no orphan keys)', () => {
    expect(AI_KEYS.filter((k) => !contentSrc.includes(`'${k}'`))).toEqual([]);
  });

  it('every i18nOr() key in content.js is registered in CONTENT_MESSAGE_KEYS', () => {
    // The pre-existing lock-step test only scans i18n('…'); i18nOr('…') would
    // render the raw key if its registration were forgotten.
    const used = [...new Set([...contentSrc.matchAll(/\bi18nOr\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((m) => m[1]))];
    expect(used.filter((k) => !bridgeKeys.has(k))).toEqual([]);
  });

  it('count messages use {{COUNT}} in every locale', () => {
    for (const l of LOCALES) {
      for (const k of ['contentAiOptionsGenerating', 'contentAiOptionsCount']) {
        expect(locale[l][k].message.match(/\{\{COUNT\}\}/g)?.length, `${l}:${k}`).toBe(1);
      }
    }
  });
});

describe('I18N-002 no hard-coded Chinese left in the AI UI functions', () => {
  const regions = {
    showGrokErrorToast: slice('function showGrokErrorToast(', 'function getSelectedGrokPromptTemplate()'),
    showGrokTemplateMenu: slice('function showGrokTemplateMenu(', 'function showGrokOptions('),
    showGrokOptions: slice('function showGrokOptions(', 'function setGrokButtonLabel('),
    setGrokButtonLabel: slice('function setGrokButtonLabel(', 'function requestExternalAiGeneration('),
    // handleGrokGenerate + injectGrokReplyButtons (AI button title)
    handleGrokGenerate: slice('async function handleGrokGenerate(', 'function closeOpenMenus('),
  };
  // Allowed leftovers (kept on purpose):
  //  - 【原推文】/【对该推文的回复】: part of the Grok *input prompt* (never translate)
  //  - new Error('…') and `err?.message || '…'`: error-message contract, I18N-003
  const ALLOWED = /【原推文】|new Error\(|err\?\.message \|\|/;

  for (const [name, src] of Object.entries(regions)) {
    it(`${name} has no un-keyed CJK literal`, () => {
      const stripped = src
        .replace(/i18nOr\(\s*'[^']*'\s*,\s*'[^']*'\s*\)/g, 'i18nOr()')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .filter((line) => /[぀-ヿ一-鿿]/.test(line))
        .filter((line) => !ALLOWED.test(line));
      expect(stripped).toEqual([]);
    });
  }
});

describe('I18N-002 runtime resolution (ja / en / zh_CN)', () => {
  const makeEl = () => ({
    style: {}, children: [], textContent: '', innerHTML: undefined,
    classList: { add() {}, toggle(_c, on) { this.on = on; } },
    append(...c) { this.children.push(...c); },
  });

  function toastFor(l, msg) {
    const nodes = [];
    const ctx = {
      document: { createElement: makeEl, body: { appendChild: (n) => nodes.push(n) } },
      requestAnimationFrame: (fn) => fn(), setTimeout() {}, dismissToast() {},
    };
    const localizedStrings = messagesFor(l);
    ctx.i18nOr = (k, f) => localizedStrings[k] || f;
    vm.runInNewContext(slice('function showGrokErrorToast(', 'function getSelectedGrokPromptTemplate()'), ctx);
    ctx.showGrokErrorToast(msg);
    return nodes[0].children.map((c) => c.textContent);
  }

  it('error toast title and default detail follow the locale', () => {
    expect(toastFor('ja', '')).toEqual(['⚠ AI 生成に失敗しました', 'もう一度お試しください']);
    expect(toastFor('en', '')).toEqual(['⚠ AI generation failed', 'Please try again']);
    expect(toastFor('zh_CN', '')).toEqual(['⚠ AI 生成失败', '请重试']);
  });

  it('error toast still shows the real error message verbatim (I18N-003 contract untouched)', () => {
    expect(toastFor('ja', 'HTTP 429')[1]).toBe('HTTP 429');
  });

  it('before settings arrive, fallbacks equal the previous Chinese strings', () => {
    const nodes = [];
    const ctx = {
      document: { createElement: makeEl, body: { appendChild: (n) => nodes.push(n) } },
      requestAnimationFrame: (fn) => fn(), setTimeout() {}, dismissToast() {},
      i18nOr: (_k, f) => f,
    };
    vm.runInNewContext(slice('function showGrokErrorToast(', 'function getSelectedGrokPromptTemplate()'), ctx);
    ctx.showGrokErrorToast('');
    expect(nodes[0].children.map((c) => c.textContent)).toEqual(['⚠ AI 生成失败', '请重试']);
  });

  it('AI button label resolves per locale and is not hidden behind the busy label', () => {
    for (const [l, label, busy] of [['ja', 'AI 生成', '生成中'], ['en', 'AI Generate', 'Generating'], ['zh_CN', 'AI 生成', '生成中']]) {
      const localizedStrings = messagesFor(l);
      const ctx = { i18nOr: (k, f) => localizedStrings[k] || f };
      vm.runInNewContext(slice('function setGrokButtonLabel(', 'function requestExternalAiGeneration('), ctx);
      const idle = makeEl(); const loading = makeEl();
      ctx.setGrokButtonLabel(idle);
      ctx.setGrokButtonLabel(loading, localizedStrings.contentAiButtonGenerating, true);
      expect(idle.innerHTML).toContain(`<span>${label}</span>`);
      expect(loading.innerHTML).toContain(`<span>${busy}</span>`);
      expect(loading.classList.on).toBe(true);
    }
  });

  it('count placeholders are substituted for every locale', () => {
    for (const l of LOCALES) {
      const m = messagesFor(l);
      const gen = m.contentAiOptionsGenerating.replace('{{COUNT}}', String(3));
      const total = m.contentAiOptionsCount.replace('{{COUNT}}', String(10));
      expect(gen).toContain('3');
      expect(total).toContain('10');
      expect(gen + total).not.toContain('{{');
    }
    // and content.js performs exactly that substitution
    expect(contentSrc).toContain("i18nOr('contentAiOptionsGenerating', '生成中 {{COUNT}}…').replace('{{COUNT}}', String(comments.length))");
    expect(contentSrc).toContain("i18nOr('contentAiOptionsCount', '共 {{COUNT}} 条').replace('{{COUNT}}', String(comments.length))");
  });

  it('the AI generation request path is untouched (provider/payload still posted as before)', () => {
    const fn = slice('function requestExternalAiGeneration(', 'async function handleGrokGenerate(');
    expect(fn).toContain("type: 'XVM_AI_GENERATE'");
    expect(fn).toContain('replyCount: aiReplyCount');
    expect(fn).toContain("reject(Object.assign(new Error('AI 生成超时，请检查服务连接'), { code: 'aiErrGenerateTimeout' }))"); // message unchanged; code added by I18N-003 R1
  });
});
