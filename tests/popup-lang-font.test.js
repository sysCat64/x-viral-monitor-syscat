// Popup <html lang> and Japanese font stack.
//
// Without <html lang="ja"> and a Japanese-first font stack, Han characters in
// the Japanese UI (e.g. "AI 返信") render with Chinese glyph forms. The actual
// glyph shapes cannot be asserted here (Chrome check), but the wiring can.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');
const popupSrc = read('popup.js');
const html = read('popup.html');

// Real language helpers + updateLanguageToggle from popup.js, with stubs.
function load({ uiLanguage = 'en-US', toggle = true } = {}) {
  const a = popupSrc.indexOf("const LANGUAGE_KEY = 'language';");
  const b = popupSrc.indexOf('function normalizeSubstitutions(');
  const c = popupSrc.indexOf('function updateLanguageToggle(');
  const d = popupSrc.indexOf('function buildLanguageStoragePatch(');
  expect(a).toBeGreaterThan(-1);
  expect(c).toBeGreaterThan(b);
  const store = {};
  const toggleEl = { dataset: {}, title: '', setAttribute() {}, querySelector: () => ({ textContent: '' }) };
  const ctx = {
    document: { documentElement: { lang: 'zh-CN' } },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    chrome: { i18n: { getUILanguage: () => uiLanguage } },
    navigator: { language: uiLanguage },
    languageToggle: toggle ? toggleEl : null,
    getLanguageDisplayName: (l) => l,
    tr: (k) => k,
  };
  vm.runInNewContext(`${popupSrc.slice(a, b)}\n${popupSrc.slice(c, d)}\nthis.update = updateLanguageToggle;`, ctx);
  return { ctx, lang: () => ctx.document.documentElement.lang, update: ctx.update, store };
}

describe('popup <html lang> follows the displayed language', () => {
  it('ja -> ja, en -> en, zh_CN -> zh-CN', () => {
    const t = load();
    t.update('ja'); expect(t.lang()).toBe('ja');
    t.update('en'); expect(t.lang()).toBe('en');
    t.update('zh_CN'); expect(t.lang()).toBe('zh-CN');
  });

  it('switching back and forth always ends on the last language', () => {
    const t = load();
    for (const [pref, expected] of [['ja', 'ja'], ['zh_CN', 'zh-CN'], ['en', 'en'], ['ja', 'ja'], ['en', 'en']]) {
      t.update(pref);
      expect(t.lang()).toBe(expected);
    }
  });

  it('auto follows the browser UI language (same resolution as the displayed texts)', () => {
    for (const [ui, expected] of [['ja', 'ja'], ['ja-JP', 'ja'], ['zh-CN', 'zh-CN'], ['zh-TW', 'zh-CN'], ['en-US', 'en'], ['fr-FR', 'en'], ['', 'en']]) {
      const t = load({ uiLanguage: ui });
      t.update('auto');
      expect(t.lang(), `UI ${ui}`).toBe(expected);
    }
  });

  it('an unknown or missing preference is treated as auto', () => {
    const t = load({ uiLanguage: 'ja' });
    t.update('klingon'); expect(t.lang()).toBe('ja');
    t.update(undefined); expect(t.lang()).toBe('ja');
  });

  it('is applied even when the toggle button does not exist', () => {
    const t = load({ toggle: false });
    t.update('ja');
    expect(t.lang()).toBe('ja');
  });

  it('still updates the toggle button as before', () => {
    const t = load();
    t.update('ja');
    expect(t.ctx.languageToggle.dataset.languagePref).toBe('ja');
  });

  it('the saved language is reflected on every path that calls updateLanguageToggle', () => {
    // init (saved localStorage preference), language change, and the storage restore
    expect(popupSrc).toContain('updateLanguageToggle(initialLanguagePref);');
    const change = popupSrc.slice(popupSrc.indexOf('function applyLanguageChange('), popupSrc.indexOf('updateLanguageToggle(initialLanguagePref);'));
    expect(change).toContain('updateLanguageToggle(normalized);');
    expect(change).toContain('chrome.storage.sync.set(buildLanguageStoragePatch(normalized), () => {');
    expect(change).toContain('location.reload();');
    expect(popupSrc).toContain('updateLanguageToggle(storedLanguage);');
  });

  it('the initial call runs before the saved preference is used elsewhere (restore happens on load)', () => {
    const t = load({ uiLanguage: 'en-US' });
    t.store.language = 'ja';
    // what popup.js does at start-up: read the saved preference, then update
    t.ctx.localStorage.getItem('language');
    t.update(t.ctx.localStorage.getItem('language'));
    expect(t.lang()).toBe('ja');
  });

  it('reuses the existing language helpers and adds no new language state', () => {
    expect(popupSrc).toContain('getEffectiveLanguageId(normalizeLanguage(language))');
    expect((popupSrc.match(/documentElement\.lang/g) || []).length).toBe(2); // compare + assign inside updateLanguageToggle
    expect((popupSrc.match(/function updateLanguageToggle\(/g) || []).length).toBe(1);
  });
});

describe('popup font stacks', () => {
  const baseBody = html.match(/\n    body \{[\s\S]*?\n    \}/)[0];
  const jaRule = html.match(/html:lang\(ja\) body \{([\s\S]*?)\}/)?.[1] || '';
  const fonts = (decl) => (decl.match(/font-family:\s*([^;]+);/)?.[1] || '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));

  it('the default (Chinese / English) font stack is unchanged', () => {
    expect(baseBody).toContain('font-family: "Inter", "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;');
  });

  it('Japanese gets its own stack with Japanese fonts and the same Latin fonts first', () => {
    const list = fonts(jaRule);
    expect(list.slice(0, 2)).toEqual(['Inter', 'Avenir Next']);
    for (const f of ['Hiragino Sans', 'Yu Gothic', 'Noto Sans CJK JP']) expect(list, f).toContain(f);
    expect(list[list.length - 1]).toBe('sans-serif');
  });

  it('Hiragino Sans (macOS) comes before the other Japanese fallbacks', () => {
    const list = fonts(jaRule);
    expect(list.indexOf('Hiragino Sans')).toBeLessThan(list.indexOf('Yu Gothic'));
    expect(list.indexOf('Yu Gothic')).toBeLessThan(list.indexOf('Noto Sans CJK JP'));
  });

  it('Japanese does not include the Chinese fonts, so they cannot take priority', () => {
    const list = fonts(jaRule);
    expect(list).not.toContain('PingFang SC');
    expect(list).not.toContain('Microsoft YaHei');
  });

  it('the Japanese rule only matches lang=ja and outranks the base body rule', () => {
    expect(html).toMatch(/html:lang\(ja\) body \{/);
    expect(html).not.toMatch(/:lang\((?:en|zh)/);
    // controls inherit the body font, so the stack applies to them as well
    expect(html).toContain('font: inherit;');
  });

  it('the static default stays zh-CN (used until popup.js runs)', () => {
    expect(html).toMatch(/<html lang="zh-CN">/);
  });

  it('layout properties of body are untouched', () => {
    expect(baseBody).toContain('width: 360px;');
    expect(baseBody).toContain('min-width: 360px;');
    expect(baseBody).toContain('max-width: 360px;');
    expect(baseBody).toContain('font-size: 13px;');
    expect(jaRule).not.toMatch(/font-size|line-height|width|letter-spacing/);
  });
});

describe('no text or translation changes', () => {
  it('tabAi and the tab labels keep their translations', () => {
    const msg = (l) => JSON.parse(read(`_locales/${l}/messages.json`));
    expect(msg('ja').tabAi.message).toBe('AI 返信');
    expect(msg('en').tabAi.message).toBe('AI replies');
    expect(msg('zh_CN').tabAi.message).toBe('AI 评论');
    expect(html).toContain('<span data-i18n="tabAi">AI 评论</span>');
  });

  it('the language switch still saves the preference and reloads the popup', () => {
    expect(popupSrc).toContain("try { localStorage.setItem(LANGUAGE_KEY, normalized); } catch (_) {}");
    expect(popupSrc).toContain('updateLanguageToggle(normalized);');
  });
});
