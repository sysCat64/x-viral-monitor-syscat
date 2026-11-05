// Release-notes dialog: lang attribute + Japanese font stack.
//
// Without a lang attribute and a Japanese-first stack, Han characters in the
// Japanese dialog render with Chinese glyph forms. Actual glyph shapes need a
// Chrome check; the wiring is tested here. The host page's <html lang> must
// never be touched.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');
const contentSrc = read('content.js');
const bridgeSrc = read('bridge.js');
const css = read('styles.css');
const locale = (l) => JSON.parse(read(`_locales/${l}/messages.json`));

// ── real source pieces ──
const declStart = contentSrc.indexOf('const RELEASE_NOTES_HTML_LANG');
const declEnd = contentSrc.indexOf("let releaseNotesLang = 'zh-CN';") + "let releaseNotesLang = 'zh-CN';".length;
const modalStart = contentSrc.indexOf('function showReleaseNotesModal(');
const modalEnd = contentSrc.indexOf('\nfunction ', modalStart + 10);
const settingsStmt = contentSrc.match(/  if \(Object\.prototype\.hasOwnProperty\.call\(RELEASE_NOTES_HTML_LANG[\s\S]*?\n  \}\n/)?.[0];

function makeEl(tag) {
  const attrs = {};
  return {
    tag, attrs, children: [], className: '', textContent: '', style: {}, dataset: {},
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute: (k) => attrs[k],
    append(...c) { this.children.push(...c); },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, focus() {},
  };
}

// Run the real showReleaseNotesModal against a locale; returns helpers.
function load(strings = {}) {
  expect(declStart).toBeGreaterThan(-1);
  expect(settingsStmt).toBeTruthy();
  const created = [];
  const host = { lang: 'ja-host-page' }; // stands for X's <html lang>
  const doc = {
    documentElement: host,
    body: { appendChild: (n) => created.push(n) },
    createElement: (t) => makeEl(t),
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const ctx = {
    document: doc, window: { postMessage() {} },
    i18nOr: (k, f) => strings[k] || f,
    _resolvedTheme: () => 'light', _themePref: 'system',
    RELEASE_NOTE_ITEMS: [['t1', 'b1', 'fallback title', 'fallback body']],
    closeReleaseNotesModal() {},
  };
  vm.runInNewContext(`${contentSrc.slice(declStart, declEnd)}\n${contentSrc.slice(modalStart, modalEnd)}
    this.show = showReleaseNotesModal;
    this.receive = (event) => { ${settingsStmt} };
    this.currentLang = () => releaseNotesLang;`, ctx);
  return { ctx, created, host, show: () => ctx.show('1.2.3'), receive: (effectiveLanguage) => ctx.receive({ data: { effectiveLanguage } }) };
}
const stringsFor = (l) => Object.fromEntries(Object.entries(locale(l)).map(([k, v]) => [k, v.message]));

describe('release-notes dialog lang attribute', () => {
  it('ja -> ja, en -> en, zh_CN -> zh-CN', () => {
    for (const [eff, expected] of [['ja', 'ja'], ['en', 'en'], ['zh_CN', 'zh-CN']]) {
      const t = load(stringsFor(eff));
      t.receive(eff);
      t.show();
      expect(t.created[0].attrs.lang, eff).toBe(expected);
      expect(t.created[0].className).toBe('xvm-update-backdrop');
    }
  });

  it("'auto' uses the resolved effective language that bridge.js sends", () => {
    // bridge.js resolves 'auto' to one of zh_CN / en / ja in effectiveLanguage; content.js just maps it.
    expect(bridgeSrc).toContain('effectiveLanguage: getEffectiveLanguageId(raw?.language),');
    const t = load();
    t.receive('ja'); // what bridge sends for language=auto in a Japanese browser
    t.show();
    expect(t.created[0].attrs.lang).toBe('ja');
  });

  it('invalid language values are ignored and keep the safe default / previous value', () => {
    const t = load();
    for (const bad of [undefined, null, '', 'fr', 'JA', 'ja-JP', 'constructor', '__proto__', 'hasOwnProperty', 42, {}, []]) {
      t.receive(bad);
      expect(t.ctx.currentLang(), String(bad)).toBe('zh-CN');
    }
    t.receive('ja');
    t.receive('constructor');
    expect(t.ctx.currentLang()).toBe('ja');
  });

  it('before any settings arrive, the dialog uses zh-CN to match its Chinese fallback texts', () => {
    const t = load({}); // no localized strings yet -> i18nOr returns the Chinese fallbacks
    t.show();
    expect(t.created[0].attrs.lang).toBe('zh-CN');
    expect(texts(t.created[0])).toContain('知道了');
  });

  it('settings arriving later only affect dialogs created afterwards', () => {
    const t = load(stringsFor('ja'));
    t.show();                   // opened before the language was known
    expect(t.created[0].attrs.lang).toBe('zh-CN');
    t.receive('ja');            // language arrives / changes while it is open
    expect(t.created[0].attrs.lang).toBe('zh-CN'); // texts are not re-rendered, so lang stays consistent with them
    t.show();
    expect(t.created[1].attrs.lang).toBe('ja');
  });

  it('switching languages back and forth always uses the latest for new dialogs', () => {
    const t = load();
    for (const [eff, expected] of [['ja', 'ja'], ['zh_CN', 'zh-CN'], ['en', 'en'], ['ja', 'ja']]) {
      t.receive(eff);
      t.show();
      expect(t.created.at(-1).attrs.lang).toBe(expected);
    }
  });

  it("never changes the host page's <html lang>", () => {
    const t = load();
    t.receive('ja');
    t.show();
    expect(t.host.lang).toBe('ja-host-page');
    expect(contentSrc).not.toMatch(/documentElement\.lang\s*=/);
    expect(contentSrc).not.toMatch(/documentElement\.setAttribute\(\s*['"]lang['"]/);
    expect((contentSrc.match(/setAttribute\('lang'/g) || []).length).toBe(1); // the backdrop only
  });

  it('theme, structure and handlers of the dialog are unchanged', () => {
    const t = load(stringsFor('ja'));
    t.receive('ja');
    t.show();
    const backdrop = t.created[0];
    expect(backdrop.attrs['data-theme']).toBe('light');
    const dialog = backdrop.children[0];
    expect(dialog.className).toBe('xvm-update-dialog');
    expect(dialog.attrs.role).toBe('dialog');
    expect(dialog.attrs['aria-modal']).toBe('true');
    const body = modalSrc();
    for (const s of ['close.addEventListener(\'click\', dismiss);', 'ok.addEventListener(\'click\', dismiss);', "if (event.key !== 'Escape') return;", 'ok.focus({ preventScroll: true });']) {
      expect(body).toContain(s);
    }
  });

  it('texts are unchanged: the dialog still renders the translated subtitle', () => {
    const t = load(stringsFor('ja'));
    t.receive('ja');
    t.show();
    expect(texts(t.created[0])).toContain(locale('ja').contentUpdateSubtitle.message);
    expect(locale('zh_CN').contentUpdateSubtitle.message).toBe('这次更新里有几个容易错过的小功能：');
  });

  it('release-notes display conditions and read tracking are untouched', () => {
    expect(contentSrc).toContain('function scheduleReleaseNotesModal() {');
    expect(contentSrc).toContain("type: 'XVM_RELEASE_NOTES_DISMISS', version");
    expect(contentSrc).toContain('if (document.querySelector(\'.xvm-update-backdrop\')) return;');
  });
});

function modalSrc() { return contentSrc.slice(modalStart, modalEnd); }
function texts(node) { return [node.textContent, ...(node.children || []).flatMap(texts)].filter(Boolean); }

describe('release-notes dialog fonts (styles.css)', () => {
  const rule = (selector) => {
    const i = css.indexOf(`${selector} {`);
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  };
  const fonts = (decl) => (decl.match(/font-family:\s*([^;]+);/)?.[1] || '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));

  it('the default (Chinese / English) stack is unchanged', () => {
    expect(rule('.xvm-update-backdrop')).toContain('font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;');
  });

  it('Japanese gets a Japanese-first stack that keeps the same Latin fonts first', () => {
    const list = fonts(rule('.xvm-update-backdrop:lang(ja)'));
    expect(list.slice(0, 4)).toEqual(['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto']);
    expect(list.indexOf('Hiragino Sans')).toBeGreaterThan(3);
    expect(list.indexOf('Hiragino Sans')).toBeLessThan(list.indexOf('Yu Gothic'));
    expect(list.indexOf('Yu Gothic')).toBeLessThan(list.indexOf('Meiryo'));
    expect(list).toContain('Noto Sans CJK JP');
    expect(list[list.length - 1]).toBe('sans-serif');
  });

  it('no Chinese font appears in the Japanese stack', () => {
    const list = fonts(rule('.xvm-update-backdrop:lang(ja)'));
    expect(list).not.toContain('PingFang SC');
    expect(list).not.toContain('Microsoft YaHei');
  });

  it('every added selector is scoped to the dialog (nothing page-wide)', () => {
    const added = [...css.matchAll(/^([^\n{}]*:lang\([^\n{]*)\{/gm)].map((m) => m[1].trim());
    expect(added.length).toBeGreaterThan(0);
    for (const sel of added) expect(sel.startsWith('.xvm-update-backdrop'), sel).toBe(true);
    expect(css).not.toMatch(/^(?:html|body|:root|\*)[^{\n]*:lang\(/m);
  });

  it('only font-family changes: layout, size, spacing and dark theme are untouched', () => {
    const ja = rule('.xvm-update-backdrop:lang(ja)') + rule('.xvm-update-backdrop:lang(ja) .xvm-update-primary');
    expect(ja).not.toMatch(/width|height|padding|margin|line-height|font-size|color|background|letter-spacing/);
    expect(css).toContain('width: min(420px, calc(100vw - 32px));');
    expect(css).toContain('max-height: min(680px, calc(100vh - 48px));');
    expect((css.match(/^\.xvm-update-backdrop\[data-theme="dark"\]/gm) || []).length).toBe(7); // same as before this change
  });

  it('the primary button gets the dialog font only for Japanese', () => {
    expect(css).toContain('.xvm-update-backdrop:lang(ja) .xvm-update-primary { font-family: inherit; }');
    expect(css).not.toMatch(/^\.xvm-update-primary\s*\{[^}]*font-family/m); // the base button rule is untouched
  });
});
