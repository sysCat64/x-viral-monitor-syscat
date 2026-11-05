// I18N-001 — bookmark insertion (书签穿插) UI in content.js must resolve through
// messages.json -> bridge CONTENT_MESSAGE_KEYS -> localizedStrings -> i18nOr.
// Behaviour (cache, insertion, frequency, folder selection, messaging) is untouched.

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

const bridgeKeys = new Set(
  (bridgeSrc.match(/CONTENT_MESSAGE_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '')
    .match(/['"]([A-Za-z0-9_]+)['"]/g)?.map((s) => s.slice(1, -1)) || [],
);
const BTI_KEYS = Object.keys(locale.ja).filter((k) => k.startsWith('contentBti'));
const COUNT_KEYS = ['contentBtiFoldersSelected', 'contentBtiCached', 'contentBtiMinutesAgo',
  'contentBtiHoursAgo', 'contentBtiDaysAgo', 'contentBtiFolderCount', 'contentBtiFolderCountCapped'];

const messagesFor = (l) => Object.fromEntries(BTI_KEYS.map((k) => [k, locale[l][k].message]));

function slice(startMarker, endMarker) {
  const start = contentSrc.indexOf(startMarker);
  const end = contentSrc.indexOf(endMarker, start);
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1);
  expect(end, `${endMarker} not found`).toBeGreaterThan(start);
  return contentSrc.slice(start, end);
}

describe('I18N-001 keys', () => {
  it('has keys and all exist in en, ja and zh_CN', () => {
    expect(BTI_KEYS.length).toBeGreaterThan(20);
    for (const l of LOCALES) {
      expect(Object.keys(locale[l]).filter((k) => k.startsWith('contentBti')).sort()).toEqual([...BTI_KEYS].sort());
      for (const k of BTI_KEYS) expect(locale[l][k].message, `${l}:${k}`).toBeTruthy();
    }
  });

  it('all keys are registered in CONTENT_MESSAGE_KEYS and used by content.js', () => {
    expect(BTI_KEYS.filter((k) => !bridgeKeys.has(k))).toEqual([]);
    expect(BTI_KEYS.filter((k) => !contentSrc.includes(`'${k}'`))).toEqual([]);
  });

  it('every i18nOr key used in content.js is registered', () => {
    const used = [...new Set([...contentSrc.matchAll(/\bi18nOr\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((m) => m[1]))];
    const viaBti = [...contentSrc.matchAll(/\bbtiText\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((m) => m[1]);
    expect([...used, ...viaBti].filter((k) => !bridgeKeys.has(k))).toEqual([]);
  });

  it('count messages carry exactly one {{COUNT}} in every locale; ago message one {{AGO}}', () => {
    for (const l of LOCALES) {
      for (const k of COUNT_KEYS) expect(locale[l][k].message.match(/\{\{COUNT\}\}/g)?.length, `${l}:${k}`).toBe(1);
      expect(locale[l].contentBtiUpdatedAgo.message.match(/\{\{AGO\}\}/g)?.length).toBe(1);
    }
  });

  it('ja has no Chinese-only wording left (simplified glyph spot check)', () => {
    for (const k of BTI_KEYS) expect(locale.ja[k].message, k).not.toMatch(/[书缓刷启选频间钟时刚载]/);
  });
});

describe('I18N-001 no hard-coded Chinese in the bookmark insertion UI', () => {
  const regions = {
    badges: slice('function renderBookmarkTimelineBadges()', '// Inject a bookmark count next to'),
    cog: slice("btn.className = 'xvm-bti-cog'", 'function saveBookmarkTimelineSettings()'),
    settings: slice('function renderBookmarkTimelineSettings()', 'function armBodyTablistWatch()'),
  };
  for (const [name, src] of Object.entries(regions)) {
    it(`${name} has no un-keyed CJK literal`, () => {
      const lines = src
        .replace(/btiText\(\s*'[^']*'\s*,\s*'[^']*'/g, 'btiText(')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .filter((l) => /[぀-ヿ一-鿿]/.test(l));
      expect(lines).toEqual([]);
    });
  }
});

describe('I18N-001 runtime', () => {
  const helpers = slice('function btiText(', 'function applyBookmarkTimelineLocalizedUi()')
    + slice('function escapeHtml(', 'function btiText(').replace(/^[\s\S]*$/, (m) => m);
  const agoSrc = slice('function formatBookmarkTimelineAgo(', 'function showBookmarkTimelineSettings()');
  const renderSrc = slice('function renderBookmarkTimelineSettings()', 'function formatBookmarkTimelineAgo(');

  function makeCtx(strings, over = {}) {
    const ctx = {
      Date, Math, Number, String, Set, Map, Array, Object,
      localizedStrings: strings,
      BOOKMARK_TIMELINE_FETCH_CAP: 100,
      bookmarkTimelineDialog: null,
      bookmarkTimelineInjectEnabled: true,
      bookmarkTimelineInjectEvery: 20,
      bookmarkTimelineInjectFolderIds: [],
      bookmarkTimelineFolders: [],
      bookmarkTimelineEntryCache: new Map(),
      bookmarkTimelineFolderStatus: new Map(),
      bookmarkTimelineFolderRefreshedAt: new Map(),
      ...over,
    };
    const escSrc = slice('function escapeHtml(', 'function renderBookmarkTimelineSettings()');
    vm.runInNewContext(
      "function i18nOr(key, fallback) { return localizedStrings[key] || fallback; }\n"
      + escSrc.replace(/\/\/ Bookmark-insertion[\s\S]*$/, '')
      + slice('// Bookmark-insertion (', 'function applyBookmarkTimelineLocalizedUi()')
      + agoSrc,
      ctx,
    );
    return ctx;
  }

  it('relative time follows the locale and substitutes numbers', () => {
    const now = Date.now();
    const cases = {
      ja: ['たった今', '5 分前', '3 時間前', '2 日前'],
      en: ['just now', '5 min ago', '3 hr ago', '2 days ago'],
      zh_CN: ['刚刚', '5 分钟前', '3 小时前', '2 天前'],
    };
    for (const l of LOCALES) {
      const c = makeCtx(messagesFor(l));
      const got = [now - 1000, now - 5 * 60000, now - 3 * 3600000, now - 2 * 86400000].map((t) => c.formatBookmarkTimelineAgo(t));
      expect(got, l).toEqual(cases[l]);
    }
  });

  it('before settings arrive, fallbacks equal the previous Chinese strings', () => {
    const c = makeCtx({});
    expect(c.formatBookmarkTimelineAgo(Date.now() - 5 * 60000)).toBe('5 分钟前');
    expect(c.btiText('contentBtiBadge', '书签')).toBe('书签');
    expect(c.btiText('contentBtiFoldersSelected', '已选 {{COUNT}} 个文件夹', { COUNT: 2 })).toBe('已选 2 个文件夹');
  });

  it('dynamic values cannot inject through $-patterns or repeated tokens', () => {
    const c = makeCtx({ contentBtiUpdatedAgo: 'Updated {{AGO}} / {{AGO}}' });
    expect(c.btiText('contentBtiUpdatedAgo', '', { AGO: "$& $1 <b>" })).toBe('Updated $& $1 <b> / $& $1 <b>');
  });

  function renderWith(l, over) {
    const els = {};
    const names = { '.xvm-bti-enabled': 'enabled', '.xvm-bti-every': 'every', '.xvm-bti-folders': 'list', '.xvm-bti-count': 'count' };
    const dialog = {
      querySelector: (sel) => (names[sel]
        ? (els[names[sel]] ||= { textContent: '', innerHTML: '', checked: false, value: '' })
        : null),
    };
    const c = makeCtx(messagesFor(l), { bookmarkTimelineDialog: dialog, ...over });
    vm.runInNewContext(renderSrc, c);
    c.renderBookmarkTimelineSettings();
    return els;
  }

  it('empty selection and empty folder list render per locale', () => {
    const exp = {
      ja: ['フォルダー未選択', 'フォルダー一覧がありません。'],
      en: ['No folder selected', 'No folder list yet.'],
      zh_CN: ['未选择文件夹', '还没有文件夹列表'],
    };
    for (const l of LOCALES) {
      const els = renderWith(l, {});
      expect(els.count.textContent).toBe(exp[l][0]);
      expect(els.list.innerHTML).toContain(exp[l][1]);
    }
  });

  it('count line and folder badges substitute counts; names and badges are HTML-escaped', () => {
    const now = Date.now();
    const over = {
      bookmarkTimelineInjectFolderIds: ['1', '2', '3', '4'],
      bookmarkTimelineFolders: [
        { id: '1', name: '<img src=x onerror=alert(1)>' },
        { id: '2', name: '"quoted"' },
        { id: '3', name: '' },
        { id: '4', name: 'cap' },
      ],
      bookmarkTimelineEntryCache: new Map([['1', [1, 2, 3]], ['4', new Array(100).fill(0)]]),
      bookmarkTimelineFolderStatus: new Map([['2', 'error']]),
      bookmarkTimelineFolderRefreshedAt: new Map([['1', now - 2 * 3600000]]),
    };
    const ja = renderWith('ja', over);
    expect(ja.count.textContent).toBe(
      '4 個のフォルダーを選択中 · 103 件キャッシュ済み · 更新：2 時間前',
    );
    expect(ja.list.innerHTML).toContain('>3 件<');
    expect(ja.list.innerHTML).toContain('>100 件以上<');
    expect(ja.list.innerHTML).toContain('>更新に失敗<');
    expect(ja.list.innerHTML).toContain('>未キャッシュ<');
    expect(ja.list.innerHTML).toContain('<span class="xvm-bti-folder-name">3</span>');
    expect(ja.list.innerHTML).not.toContain('<img');
    expect(ja.list.innerHTML).toContain('&lt;img');
    expect(ja.list.innerHTML).toContain('&quot;quoted&quot;');
    const jaNow = renderWith('ja', { ...over, bookmarkTimelineFolderRefreshedAt: new Map([['1', now - 1000]]) });
    expect(jaNow.count.textContent).toMatch(/ · 更新：たった今$/);
    const en = renderWith('en', over);
    expect(en.count.textContent).toBe('4 folder(s) selected · 103 cached · Updated 2 hr ago');
    expect(en.list.innerHTML).toContain('>100+<');
  });

  it('a malicious translation is escaped when rendered into HTML', () => {
    const els = {};
    const mk = (n) => (els[n] = { textContent: '', innerHTML: '' });
    const dialog = { querySelector: (s) => (s === '.xvm-bti-folders' ? mk('list') : s === '.xvm-bti-count' ? mk('count') : mk('x')) };
    const c = makeCtx({ contentBtiNoFolders: '<script>x</script>' }, { bookmarkTimelineDialog: dialog });
    vm.runInNewContext(renderSrc, c);
    c.renderBookmarkTimelineSettings();
    expect(els.list.innerHTML).not.toContain('<script>');
    expect(els.list.innerHTML).toContain('&lt;script&gt;');
  });
});

describe('I18N-001 dialog template and language refresh', () => {
  const tpl = slice('backdrop.innerHTML = `', "bookmarkTimelineDialog = backdrop;");
  it('dialog template has no inline text or aria strings (filled via textContent)', () => {
    expect(tpl).not.toMatch(/[぀-ヿ一-鿿]/);
    expect(tpl).not.toMatch(/aria-label=/);
    expect(tpl).not.toContain('${');
  });
  it('settings updates re-localize existing UI', () => {
    expect(contentSrc).toMatch(/applyLocalizedUi\(\);\s*applyBookmarkTimelineLocalizedUi\(\);/);
  });
  it('behaviour hooks are unchanged', () => {
    for (const s of ["'XVM_REQUEST_FOLDER_REFRESH'", "'XVM_BOOKMARK_TIMELINE_REFRESH'", "'XVM_BOOKMARK_TIMELINE_INJECT_SAVE'",
      'Math.max(5, Math.min(100,', 'xvm-bti-enabled', 'xvm-bti-every', 'xvm-bti-folders']) {
      expect(contentSrc).toContain(s);
    }
  });
});
