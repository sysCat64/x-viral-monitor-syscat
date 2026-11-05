// Content filter popup — "All rules" list shows localized, human-readable
// labels while internal values (type / field / severity / id / regex) stay
// untouched.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(repo, 'src/premium/content-filter/popup-content-filter.js'), 'utf8');
const rulesJson = JSON.parse(readFileSync(resolve(repo, 'src/premium/content-filter/rules.json'), 'utf8'));
const bundles = Object.fromEntries(['en', 'ja', 'zh_CN'].map((l) => [
  l, JSON.parse(readFileSync(resolve(repo, `_locales/${l}/messages.json`), 'utf8')),
]));

function load(lang, { builtin = rulesJson, stored = null } = {}) {
  const win = {};
  const context = {
    window: win,
    document: { addEventListener() {} },
    chrome: {
      i18n: {
        getMessage: (key, subs) => {
          let m = bundles[lang][key]?.message;
          if (m == null) return '';
          const ph = bundles[lang][key].placeholders || {};
          for (const [name, def] of Object.entries(ph)) {
            const idx = Number(String(def.content).replace('$', '')) - 1;
            m = m.replaceAll(`$${name}$`, subs?.[idx] ?? '');
          }
          return m;
        },
      },
      storage: { local: { get: (key, cb) => cb(stored ? { [key]: stored } : {}) } },
    },
    console,
  };
  context.globalThis = context;
  context.__xvmContentFilterBuiltinRules = builtin;
  vm.runInNewContext(src, context);
  return { api: win.__xvmContentFilterPopup, context };
}

const emptySettings = { customRules: [] };
const html = (api, settings = emptySettings, opts) => api.renderAllRulesHtml(settings, opts);

describe('content filter rule list display', () => {
  it('localizes group, field, severity and type labels in all three languages', () => {
    const expected = {
      ja: ['本文', '高', '正規表現'],
      en: ['Post text', 'High', 'Regex'],
      zh_CN: ['正文', '高', '正则'],
    };
    for (const [lang, [field, sev, type]] of Object.entries(expected)) {
      const { api } = load(lang);
      const out = html(api);
      expect(out, lang).toContain(field);
      expect(out, lang).toContain(sev);
      expect(out, lang).toContain(type);
      // raw identifiers must not leak into visible meta text
      expect(out.replace(/<code[\s\S]*?<\/code>/g, '').replace(/="[^"]*"/g, ''), lang)
        .not.toMatch(/\b(content|regex|block)\b\s*\/|\/\s*(high|block)\b/);
    }
  });

  it('shows a human description for known built-in rules, per language', () => {
    for (const lang of ['ja', 'en', 'zh_CN']) {
      const { api } = load(lang);
      const out = html(api);
      for (const rule of rulesJson.rules) {
        const key = `cfRule_${rule.id.replace(/-/g, '_')}`;
        const msg = bundles[lang][key]?.message;
        expect(msg, `${lang}:${key}`).toBeTruthy();
        expect(out, `${lang}:${key}`).toContain(msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
      }
    }
  });

  it('keeps the original regex and internal ids in the markup, collapsed by default', () => {
    const { api } = load('ja');
    const out = html(api);
    const rule = rulesJson.rules.find((r) => r.id === 'spam-gambling-high');
    expect(out).toContain(`data-rule-id="${rule.id}"`);
    expect(out).toContain(`<code>${rule.value}</code>`);
    expect(out).toMatch(/<details class="cf-rule-raw" data-rule-key="builtin:spam-gambling-high">/);
  });

  it('does not mutate rule values or settings', () => {
    const before = JSON.stringify(rulesJson);
    const settings = { customRules: [{ id: 'c1', type: 'regex', field: 'bio', severity: 'block', value: 'a|b', source: 'custom' }] };
    const snap = JSON.stringify(settings);
    const { api } = load('en');
    html(api, settings);
    expect(JSON.stringify(rulesJson)).toBe(before);
    expect(JSON.stringify(settings)).toBe(snap);
  });

  it('renders unknown rule ids and remote-added rules with a generic description', () => {
    const builtin = {
      version: 2,
      levels: { light: [], standard: ['brand-new-remote-rule'], strict: ['brand-new-remote-rule'] },
      rules: [{ id: 'brand-new-remote-rule', type: 'regex', field: 'bio', severity: 'high', value: 'foo|bar' }],
    };
    const { api } = load('ja', { builtin });
    const out = html(api);
    expect(out).toContain('data-rule-id="brand-new-remote-rule"');
    expect(out).toContain('<code>foo|bar</code>');
    expect(out).toContain('プロフィール'); // generic: field label
  });

  it('re-renders with the new rule set after a remote update is loaded', async () => {
    const remote = {
      version: 2,
      levels: { light: [], standard: ['remote-only-rule'], strict: [] },
      rules: [{ id: 'remote-only-rule', type: 'regex', field: 'content', severity: 'high', value: 'zzz' }],
    };
    const { api } = load('en', { stored: { fetchedAt: 1, payload: remote } });
    expect(html(api)).not.toContain('remote-only-rule');
    await api.loadRemoteRulesCache();
    const out = html(api);
    expect(out).toContain('data-rule-id="remote-only-rule"');
    expect(out).not.toContain('spam-gambling-high');
  });

  it('marks rules not assigned to any strength so they are not read as active', () => {
    const expectText = { ja: '未割当', en: 'Not assigned', zh_CN: '未分配' };
    for (const [lang, text] of Object.entries(expectText)) {
      const { api } = load(lang);
      const out = html(api);
      const row = out.split('<div class="cf-rule-row"').find((r) => r.includes('data-rule-id="adult-soft-low"'));
      expect(row, lang).toContain(text);
      const active = out.split('<div class="cf-rule-row"').find((r) => r.includes('data-rule-id="spam-gambling-high"'));
      expect(active, lang).not.toContain(text);
    }
  });

  it('escapes hostile values, ids and fields', () => {
    const evil = '<img src=x onerror=alert(1)>"\'`';
    const builtin = {
      version: 2,
      levels: { light: [], standard: [], strict: [] },
      rules: [{ id: `x"><script>alert(1)</script>`, type: evil, field: evil, severity: evil, value: evil }],
    };
    const settings = { customRules: [{ id: evil, type: 'keyword', field: 'content', severity: 'low', value: evil, source: 'custom' }] };
    const { api } = load('en', { builtin });
    const out = html(api, settings);
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/"><script/);
  });

  it('keeps the delete button (data-del-rule index) for custom rules only', () => {
    const settings = { customRules: [
      { id: 'c1', type: 'keyword', field: 'content', severity: 'medium', value: 'one', source: 'custom' },
      { id: 'c2', type: 'domain', field: 'url', severity: 'block', value: 'two.example', source: 'custom' },
    ] };
    const { api } = load('en');
    const out = html(api, settings);
    expect(out).toContain('data-del-rule="0"');
    expect(out).toContain('data-del-rule="1"');
    expect((out.match(/data-del-rule=/g) || []).length).toBe(2);
  });

  it('preserves expanded rows and collapsed groups across re-render', () => {
    const { api } = load('en');
    const out = html(api, emptySettings, {
      openRules: new Set(['builtin:spam-gambling-high']),
      closedGroups: new Set(['bio']),
    });
    expect(out).toMatch(/data-rule-key="builtin:spam-gambling-high" open>/);
    expect(out).toMatch(/<details class="cf-rule-group" data-group="bio">/);
    expect(out).toMatch(/<details class="cf-rule-group" data-group="content" open>/);
  });

  it('exposes localized labels for the custom rule pickers while option values stay internal', () => {
    const { api } = load('ja');
    const opts = api.pickerOptionsHtml();
    expect(opts.type).toContain('<option value="regex">正規表現</option>');
    expect(opts.field).toContain('<option value="content">本文</option>');
    expect(opts.severity).toContain('<option value="block">');
    for (const v of ['keyword', 'regex', 'domain']) expect(opts.type).toContain(`value="${v}"`);
    for (const v of ['name', 'screen_name', 'bio', 'location', 'content', 'url']) expect(opts.field).toContain(`value="${v}"`);
    for (const v of ['low', 'medium', 'high', 'block']) expect(opts.severity).toContain(`value="${v}"`);
  });

  it('defines every new label key in all three locales', () => {
    const keys = [
      ...['name', 'screen_name', 'bio', 'location', 'content', 'url'].map((f) => `cfField_${f}`),
      ...['keyword', 'regex', 'domain', 'short_symbol'].map((x) => `cfType_${x}`),
      ...['low', 'medium', 'high', 'block'].map((s) => `cfSev_${s}`),
      'cfRuleUnassigned', 'cfRuleRawToggle', 'cfRuleGenericDesc',
    ];
    for (const lang of Object.keys(bundles)) {
      for (const k of keys) expect(bundles[lang][k]?.message, `${lang}:${k}`).toBeTruthy();
    }
  });
});
