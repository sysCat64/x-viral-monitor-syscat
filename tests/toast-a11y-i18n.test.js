// I18N-005 (toasts) and I18N-006 (aria-label="Close") in content.js.
//
// Boundary: the dynamic `event.data.error` detail comes from bridge/background
// (I18N-003 territory) and must be shown verbatim; only the surrounding
// sentence is localized.

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

const NEW_KEYS = ['contentBookmarkTimelineRefreshFailed', 'contentUnknownError', 'contentLbLocateFailed'];
const CLOSE_KEY = 'contentStarChartClose'; // reused for aria-label (meaning: plain "Close")

const bridgeKeys = new Set(
  (bridgeSrc.match(/CONTENT_MESSAGE_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '')
    .match(/['"]([A-Za-z0-9_]+)['"]/g)?.map((s) => s.slice(1, -1)) || [],
);
const messagesFor = (l) => Object.fromEntries([...bridgeKeys].map((k) => [k, locale[l][k]?.message || k]));

// Run a single `showToast(...)` statement from content.js against a locale.
function runToastStatement(pattern, l, event = {}) {
  const stmt = contentSrc.match(pattern)?.[1];
  expect(stmt, `statement not found: ${pattern}`).toBeTruthy();
  const strings = l ? messagesFor(l) : {};
  const shown = [];
  vm.runInNewContext(stmt, {
    event: { data: event },
    i18nOr: (k, f) => strings[k] || f,
    showToast: (m) => shown.push(m),
    String,
  });
  return shown[0];
}

const REFRESH = /if \(!event\.data\.background\) (showToast\(i18nOr\('contentBookmarkTimelineRefreshFailed'.*\));\n/;
const LOCATE = /(showToast\(i18nOr\('contentLbLocateFailed'[^\n]*\));/;

describe('I18N-005 keys', () => {
  it('exist in en, ja and zh_CN, are registered in CONTENT_MESSAGE_KEYS and are used', () => {
    for (const l of LOCALES) for (const k of NEW_KEYS) expect(locale[l][k]?.message, `${l}:${k}`).toBeTruthy();
    expect(NEW_KEYS.filter((k) => !bridgeKeys.has(k))).toEqual([]);
    expect(NEW_KEYS.filter((k) => !contentSrc.includes(`'${k}'`))).toEqual([]);
  });

  it('the refresh-failed message carries exactly one {{ERROR}} placeholder per locale', () => {
    for (const l of LOCALES) {
      expect(locale[l].contentBookmarkTimelineRefreshFailed.message.match(/\{\{ERROR\}\}/g)?.length, l).toBe(1);
    }
  });
});

describe('I18N-005 toast rendering', () => {
  it('bookmark refresh failure follows the locale and keeps the dynamic error detail', () => {
    expect(runToastStatement(REFRESH, 'ja', { error: 'HTTP 429' })).toBe('ブックマークの更新に失敗しました: HTTP 429');
    expect(runToastStatement(REFRESH, 'en', { error: 'HTTP 429' })).toBe('Bookmark refresh failed: HTTP 429');
    expect(runToastStatement(REFRESH, 'zh_CN', { error: 'HTTP 429' })).toBe('书签内容刷新失败：HTTP 429');
  });

  it('error detail is inserted verbatim, even with $ replacement patterns', () => {
    expect(runToastStatement(REFRESH, 'en', { error: "cost $& $1 $$ {{ERROR}}" }))
      .toBe('Bookmark refresh failed: cost $& $1 $$ {{ERROR}}');
  });

  it('a missing error falls back to a localized "unknown error"', () => {
    expect(runToastStatement(REFRESH, 'ja', {})).toBe('ブックマークの更新に失敗しました: 不明なエラー');
    expect(runToastStatement(REFRESH, 'en', {})).toBe('Bookmark refresh failed: Unknown error');
  });

  it('before settings arrive the previous Chinese text is shown unchanged', () => {
    expect(runToastStatement(REFRESH, null, { error: 'x' })).toBe('书签内容刷新失败：x');
    expect(runToastStatement(REFRESH, null, {})).toBe('书签内容刷新失败：未知错误');
    expect(runToastStatement(LOCATE, null)).toBe('无法定位该推文：页面已回收该条目');
  });

  it('the locate-failed toast follows the locale', () => {
    expect(runToastStatement(LOCATE, 'ja')).toBe('この投稿に移動できません。ページの表示が更新されたため、対象が見つからなくなりました。');
    expect(runToastStatement(LOCATE, 'en')).toBe("Can't locate this tweet: the page has already removed it");
    expect(runToastStatement(LOCATE, 'zh_CN')).toBe('无法定位该推文：页面已回收该条目');
  });

  it('the refresh handler still updates folder status and re-renders before toasting', () => {
    const block = contentSrc.slice(contentSrc.indexOf("'XVM_BOOKMARK_TIMELINE_CACHE_ERROR'"));
    const head = block.slice(0, block.indexOf("'XVM_BOOKMARK_TIMELINE_CACHE_RESET'"));
    expect(head).toContain("bookmarkTimelineFolderStatus.set(folderId, 'error')");
    expect(head).toContain('renderBookmarkTimelineSettings();');
    expect(head).toContain('if (!event.data.background)');
  });
});

describe('I18N-006 close buttons', () => {
  it('no literal aria-label "Close" remains in content.js', () => {
    expect(contentSrc).not.toMatch(/aria-label="Close"/);
    expect(contentSrc).not.toMatch(/setAttribute\('aria-label',\s*'Close'\)/);
  });

  it('all three close buttons resolve aria-label through contentStarChartClose', () => {
    const uses = contentSrc.match(/setAttribute\('aria-label', i18nOr\('contentStarChartClose', 'Close'\)\)/g) || [];
    expect(uses.length).toBe(3);
    expect(bridgeKeys.has(CLOSE_KEY)).toBe(true);
  });

  it('the reused key means a plain "Close" in every locale', () => {
    expect(locale.en[CLOSE_KEY].message).toBe('Close');
    expect(locale.ja[CLOSE_KEY].message).toBe('閉じる');
    expect(locale.zh_CN[CLOSE_KEY].message).toBe('关闭');
  });

  it('close behavior is unchanged', () => {
    expect(contentSrc).toContain("upgradeClose.addEventListener('click', () => bubble.remove());");
    expect(contentSrc).toContain("panel.querySelector('.xvm-grok-close')?.addEventListener('click', closeGrokOptions);");
    expect(contentSrc).toContain("close.addEventListener('click', dismiss);");
  });

  it('the grok panel close button gets its label on every render (language changes apply)', () => {
    const fn = contentSrc.slice(contentSrc.indexOf('function showGrokOptions('), contentSrc.indexOf('function setGrokButtonLabel('));
    const setIdx = fn.indexOf("setAttribute('aria-label', i18nOr('contentStarChartClose'");
    const createdIdx = fn.indexOf('document.body.appendChild(panel);');
    expect(setIdx).toBeGreaterThan(createdIdx); // outside the isNew branch
  });
});
