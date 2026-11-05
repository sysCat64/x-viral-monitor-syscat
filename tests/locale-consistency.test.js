// Locale consistency across _locales/{en,ja,zh_CN}/messages.json.
// Complements the existing per-feature "required key" tests by pinning the
// whole-file invariants: identical key sets, matching placeholders, and no
// duplicate keys (which JSON.parse silently collapses).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const LOCALES = ['en', 'ja', 'zh_CN'];

const raw = Object.fromEntries(LOCALES.map((l) => [
  l, readFileSync(resolve(repo, `_locales/${l}/messages.json`), 'utf8'),
]));
const parsed = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(raw[l])]));

// Minimal JSON scanner that reports duplicate keys within any single object.
function findDuplicateKeys(text) {
  const dups = [];
  const stack = []; // per open object: { keys:Set, path }
  let i = 0;
  const readString = () => {
    let out = '';
    i += 1; // opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') { out += text[i] + text[i + 1]; i += 2; } else { out += text[i]; i += 1; }
    }
    i += 1; // closing quote
    // Decode escapes (e.g. "\u0061" === "a") so equivalent spellings collide.
    try { return JSON.parse(`"${out}"`); } catch (_) { return out; }
  };
  // expectKey[n] is true when the next string at depth n is an object key.
  const expectKey = [];
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      stack.push({ keys: new Set() });
      expectKey.push(true);
      i += 1;
    } else if (ch === '[') {
      stack.push(null);
      expectKey.push(false);
      i += 1;
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      expectKey.pop();
      i += 1;
    } else if (ch === ',') {
      if (stack[stack.length - 1]) expectKey[expectKey.length - 1] = true;
      i += 1;
    } else if (ch === ':') {
      expectKey[expectKey.length - 1] = false;
      i += 1;
    } else if (ch === '"') {
      const s = readString();
      const top = stack[stack.length - 1];
      if (top && expectKey[expectKey.length - 1]) {
        if (top.keys.has(s)) dups.push(s);
        top.keys.add(s);
      }
    } else {
      i += 1;
    }
  }
  return dups;
}

// Placeholder signature: $NAME$ / $1 / {{NAME}} tokens (with counts) plus the
// declared `placeholders` names. Must be identical across locales.
function placeholderSignature(entry) {
  const msg = String(entry?.message ?? '');
  const tokens = [
    ...(msg.match(/\$[A-Za-z0-9_]+\$/g) || []).map((t) => t.toUpperCase()),
    ...(msg.match(/\$\d+/g) || []),
    ...(msg.match(/\{\{[A-Za-z0-9_]+\}\}/g) || []),
  ].sort();
  const placeholders = entry?.placeholders || {};
  const declared = Object.keys(placeholders).map((n) => n.toUpperCase()).sort();
  // `content` maps a named placeholder to its substitution ($1, $2, ...).
  const contents = Object.entries(placeholders)
    .map(([n, meta]) => `${n.toUpperCase()}=${meta?.content ?? ''}`)
    .sort();
  return JSON.stringify({ tokens, declared, contents });
}

describe('locale consistency (en / ja / zh_CN)', () => {
  it('has no duplicate keys in any messages.json', () => {
    for (const l of LOCALES) {
      expect(findDuplicateKeys(raw[l]), `duplicate keys in _locales/${l}/messages.json`).toEqual([]);
    }
  });

  it('the duplicate-key scanner itself detects duplicates', () => {
    expect(findDuplicateKeys('{"a":{"message":"x"},"a":{"message":"y"}}')).toEqual(['a']);
    expect(findDuplicateKeys('{"a":{"message":"x"},"b":{"message":"x"}}')).toEqual([]);
  });

  it('the scanner detects duplicates spelled with Unicode escapes', () => {
    expect(findDuplicateKeys('{"a":{"message":"x"},"\\u0061":{"message":"y"}}')).toEqual(['a']);
    expect(findDuplicateKeys('{"caf\\u00e9":{"message":"x"},"café":{"message":"y"}}')).toEqual(['café']);
    expect(findDuplicateKeys('{"a":{"message":"x"},"\\u0062":{"message":"y"}}')).toEqual([]);
  });

  it('the placeholder signature covers content definitions', () => {
    const a = { message: 'x $N$', placeholders: { N: { content: '$1' } } };
    const b = { message: 'x $N$', placeholders: { N: { content: '$2' } } };
    expect(placeholderSignature(a)).not.toBe(placeholderSignature(b));
    expect(placeholderSignature(a)).toBe(placeholderSignature({ ...a }));
  });

  it('en, ja and zh_CN declare exactly the same key set', () => {
    const base = new Set(Object.keys(parsed.en));
    for (const l of LOCALES.filter((x) => x !== 'en')) {
      const keys = new Set(Object.keys(parsed[l]));
      const missing = [...base].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !base.has(k));
      expect(missing, `_locales/${l} is missing keys present in en`).toEqual([]);
      expect(extra, `_locales/${l} has keys not present in en`).toEqual([]);
    }
  });

  it('placeholder names and occurrence counts match en for every key', () => {
    const mismatched = [];
    for (const l of LOCALES.filter((x) => x !== 'en')) {
      for (const [key, entry] of Object.entries(parsed[l])) {
        if (!parsed.en[key]) continue; // reported by the key-set test
        if (placeholderSignature(entry) !== placeholderSignature(parsed.en[key])) {
          mismatched.push(`${l}:${key}`);
        }
      }
    }
    expect(mismatched, 'placeholder mismatch vs en').toEqual([]);
  });

  it('every message has non-empty text', () => {
    const empty = [];
    for (const l of LOCALES) {
      for (const [key, entry] of Object.entries(parsed[l])) {
        if (!String(entry?.message ?? '').trim()) empty.push(`${l}:${key}`);
      }
    }
    expect(empty).toEqual([]);
  });

  it('I18N-007: content-filter keys exist in all three locales', () => {
    const keys = ['cfScopeHint', 'cfAllRulesTitle', 'cfBuiltinRule', 'cfCustomRule', 'cfNoRules'];
    for (const l of LOCALES) {
      for (const k of keys) {
        expect(parsed[l][k]?.message, `${l} must declare ${k}`).toBeTruthy();
      }
    }
  });
});
