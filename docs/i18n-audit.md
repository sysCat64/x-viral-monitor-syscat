# i18n 監査レポート（Phase 1）

> 本書は監査と修正方針の提案のみを扱う。コードの変更は含まない。
> 行番号は下記コミット時点のもの。

## 1. 監査目的と対象範囲

### 目的

`sysCat64/x-viral-monitor-syscat` は `Icy-Cat/x-viral-monitor` のフォークで、個人利用向けの Chrome 拡張機能である。本家の更新を取り込みながら日本語対応の不備を直すため、Phase 2 に入る前に次の 3 点を整理する。

- 実行時 UI の i18n 対応状況
- 翻訳キーの整合性
- 修正時の回帰リスク

### 対象（実行時 UI を優先）

| 区分 | ファイル |
|---|---|
| ポップアップ | `popup.html`, `popup.js`, `popup-dashboard.js` |
| コンテンツスクリプト | `content.js`, `bridge.js`, `bookmark-menu.js`, `starchart.js` |
| バックグラウンド | `background.js` |
| `lib/` | `bookmark-timeline-inject.js`, `bookmark-timeline-storage.js`, `grok-reply.js`, `image-viewer.js`, `long-image-viewer.js`, `timeline-ad-prune.js`, `x-client-transaction.js`, `x-net-hook.js` |
| `src/` | `build-channel.js`, `premium/license/*`（5 ファイル）, `premium/rate-filter/*`（2 ファイル）, `premium/content-filter/{filter,popup-content-filter,rules}.js` |
| ロケール・設定 | `_locales/{en,ja,zh_CN}/messages.json`, `manifest.json` |

- 監査対象は実行時ファイル 31 件。
- `tests/` の 29 ファイルは、既存のテスト網羅状況の確認だけに使った。

### 対象外

- `site/`, `docs/` 内の Web サイト、`userscript/`、`scripts/`（開発専用ツール）は主対象から外した。
- `site/` と `docs/` は実行時 UI との関連を確認していない。

## 2. 監査対象コミットと実施時点

| 項目 | 値 |
|---|---|
| ブランチ | 初回監査時は `main`。再検証時（2026-11-05）に `main` から `ja-fix` を作成して切り替えた（`main` は無変更） |
| HEAD | `b1b896de5079d672afc9d829beef01c51a0b970c`（Release v1.18.17） |
| ワーキングツリー | 監査開始時はクリーン |
| `origin` | `https://github.com/sysCat64/x-viral-monitor-syscat.git` |
| `upstream` | `https://github.com/Icy-Cat/x-viral-monitor.git` |
| 実施日 | 2026-11-05 |

- 再検証で `git fetch upstream` を実行した。`upstream/main` は `b1b896d` で、現在の HEAD と**同一コミット**（`git rev-list --left-right --count HEAD...upstream/main` は `0 0`、差分なし）。
  - したがって本書の指摘は、本家の最新状態に対しても有効である。
- ビルドとテスト構成は `package.json` の `vitest run`（`npm test`）。
- 修正前のテスト結果（`npm ci` 後、`ja-fix`、実装変更なし）: **29 ファイル中 28 合格・1 失敗、424 テスト中 421 合格・3 失敗**。
  - 失敗はすべて `tests/build-dist-sync.test.js` の 3 件。
    - `dist/ exists`
    - `every ITEMS entry has matching byte content under dist/`
    - `dist build-channel marker declares an explicit supported channel`
  - 原因は `dist/` が存在しないこと（`.gitignore` 済みのビルド成果物。`npm run build:dist` 未実行）。i18n とは無関係。
  - i18n 関連のテストはすべて合格している。
  - Phase 2 の合否比較では、この 3 件を「既知の既存失敗」として扱うか、`dist/` を生成してから比較する。

## 3. 現在の i18n アーキテクチャ

### 3.1 全体像

| 層 | 実行環境 | 翻訳の取得方法 |
|---|---|---|
| ポップアップ（`popup.html`/`popup.js`/`popup-dashboard.js`、`src/premium/*/popup-*.js`） | 拡張ページ | `chrome.i18n.getMessage()`。言語を明示した場合は `popup.js:69-74` が `chrome.i18n.getMessage` を差し替え、`_locales/<id>/messages.json` を同期 XHR（`popup.js:55`）で読んだ値を返す。未解決時は native 実装に戻る |
| `bridge.js` | コンテンツスクリプト（ISOLATED world） | `getLocalizedMessages()`（`bridge.js:418-432`）が `CONTENT_MESSAGE_KEYS`（107 キー）を解決する。言語が `auto` 以外なら `fetch` で bundle を読み、`auto` なら `chrome.i18n.getMessage`。結果を `XVM_SETTINGS_UPDATE` の `messages` として `window.postMessage` する |
| `content.js` ほか | コンテンツスクリプト（MAIN world。`manifest.json` の `"world": "MAIN"`） | `chrome.*` を呼べない。`localizedStrings`（`content.js:10`）に `messages` を保持し、`i18n(key)`（キー不在なら**キー文字列そのもの**を返す）と `i18nOr(key, fallback)` で参照する |
| `background.js` | Service Worker | i18n 機構なし。メッセージはすべて直書き |
| `lib/grok-reply.js`、`src/premium/content-filter/filter.js` | MAIN world | i18n 機構なし。直書き |

### 3.2 言語設定の保存と適用

- 言語 ID は `auto | zh_CN | en | ja`（`popup.js:2`、`bridge.js:15`）。
- 保存先は 2 か所ある。
  - `localStorage['language']`: ポップアップが同期で読むために使う（`popup.js:62`）。
  - `chrome.storage.sync.language`: `bridge.js` が読む。
- `auto` の解決は `getBrowserLocaleId()`（`popup.js:19-27`、`bridge.js:19-27`）。次の順で判定する。
  - `zh*` → `zh_CN`
  - `ja*` → `ja`
  - それ以外 → `en`
- ポップアップで言語を変えると `chrome.storage.sync.set` のあと `location.reload()` する（`popup.js:443-451`）。
  - 未変更の Grok 既定テンプレートは、言語に合わせたものへ差し替わる（`buildLanguageStoragePatch`、`popup.js:430-440`）。
- 同じ `normalizeLanguage` / `getBrowserLocaleId` / `formatLocaleMessage` が `popup.js` と `bridge.js` に重複して存在する。
- `popup.html:2` は `<html lang="zh-CN">` 固定。

### 3.3 フォールバック経路（重要）

1. **ポップアップ**
   - 言語を明示している場合、選んだ言語の bundle に無いキーは `nativeGetMessage` に落ちる（`popup.js:70-73`）。
   - native は **ブラウザ UI 言語 → `default_locale: en`** の順に解決する。
   - つまり明示言語 `ja` でキーが無いと、UI 言語が zh の人には中国語が出る。
2. **bridge**
   - bundle にキーが無ければ `chrome.i18n.getMessage(key) || key` を使う（`bridge.js:428-429`）。
   - 結果が空でも `out[key] = key` となり、**必ず truthy な値**が `messages` に入る。
3. **content.js**
   - 上記により、`messages` を受け取った後は `i18nOr(key, fallback)` の `fallback` は**到達しない**（キー不在時は生のキー名が表示される）。
   - `fallback`（多くは中国語）が出るのは、最初の `XVM_SETTINGS_UPDATE` 受信前（`localizedStrings = {}`）だけである。

### 3.4 新しい翻訳キーを追加するときに変更が必要な箇所

| 用途 | 変更箇所 |
|---|---|
| ポップアップ静的 HTML | 3 ロケールの `messages.json` に追加し、`popup.html` に `data-i18n` / `data-i18n-placeholder` を付ける |
| ポップアップ動的 DOM（`src/premium/*/popup-*.js` 等） | 3 ロケールに追加し、`t(key)`（`chrome.i18n.getMessage`）を呼ぶ。`popup.js` より前に読み込まれる script は、DOMContentLoaded 時の `mount()` で呼ぶ限り差し替え後の関数を使える（`popup.html:984-991`） |
| MAIN world の `content.js` / `starchart.js` / `bookmark-menu.js` | 3 ロケールに追加し、`bridge.js` の `CONTENT_MESSAGE_KEYS` に追加し、`i18n()` / `i18nOr()` で呼ぶ |
| MAIN world の `lib/*`、`filter.js` | 機構が無い。`content.js` の `localizedStrings` を参照する新しい経路が必要（要設計） |
| `background.js` | 機構が無い。`chrome.storage.sync.language` を読む小さなヘルパが必要（要設計） |
| 言語切替時の再描画 | `content.js` は `applyLocalizedUi()` でリーダーボードのみ更新する。構築済みのダイアログやトーストは再生成されない |

## 4. 発見した問題の一覧

優先度の基準は次のとおり。

- **P0**: 日本語 UI で頻繁に目に入る未翻訳、または明確なキー不整合。
- **P1**: 日本語 UI で見えるが頻度が低い、または設計判断が要る。
- **P2**: 潜在リスクや軽微なもの。

| ID | 優先 | 概要 | 主な場所 | 対応するキー |
|---|---|---|---|---|
| I18N-001 | P1 | 「書签穿插」ダイアログ、ボタン、バッジなどが中国語直書き | `content.js:1420-1421, 1838-1839, 1897-1951, 1962-1978, 2010` | 新規必要 |
| I18N-002 | P0 | AI 返信生成 UI（ボタン、候補パネル、テンプレートメニュー、トースト）が中国語直書き | `content.js:433, 3931, 3935, 4216, 4259, 4271-4272, 4281, 4285, 4428, 4438, 4468, 4483, 4497, 4516, 4554` | 一部再利用可、他は新規 |
| I18N-003 | P0 | AI / Grok のエラーメッセージ、接続テスト結果が中国語直書き | `background.js`, `bridge.js:1006-1009`, `lib/grok-reply.js` | 一部再利用可、他は新規 |
| I18N-004 | P0 | コンテンツ屏蔽の「フィルタ済み」バー（診断コピー含む）が中国語直書き | `src/premium/content-filter/filter.js:652, 659-660, 668-671` | 新規必要 |
| I18N-005 | P1 | ブックマーク更新失敗トースト、「ツイートを特定できない」トーストが中国語直書き | `content.js:217, 3274` | 新規必要 |
| I18N-006 | P2 | `aria-label="Close"` が英語直書き（3 箇所） | `content.js:2194, 3868, 4261` | 再利用可（`contentStarChartClose` など） |
| I18N-007 | P0 | `cf*` の 5 キーが `ja` にだけ無い（`en` と `zh_CN` には存在する） | `_locales/*/messages.json`, `popup-content-filter.js:153, 196, 283, 299` | `ja` に追加が必要 |
| I18N-008 | P2 | `i18n()` / `i18nOr()` のフォールバック挙動が意図と違う。キー不在時は生のキー名を表示し、`fallback` は初回受信前の短時間だけ出る | `content.js:10-12, 229`, `bridge.js:428-429` | — |
| I18N-009 | P1 | 既定テンプレート名と連番名の中国語フォールバック | `bridge.js:387, 398`, `content.js:309-314, 375, 495` | 再利用可（`grokDefaultTemplateName`, `grokCustomTemplateName`） |
| I18N-010 | P1（保留） | AI リクエストの末尾に、言語を問わず中国語の追加指示が付く | `background.js:160`（`158` も参照） | 保留（挙動を変更しない） |
| I18N-011 | P1 | `<html lang="zh-CN">` 固定。日本語表示でも中国語字形になる可能性がある。タブ名の HTML 既定文言が中国語 | `popup.html:2, 761` | — |
| I18N-012 | P2 | 参照されていない翻訳キーが 41 件ある | 付録 A | — |
| I18N-013 | P2 | 明示言語のキー欠落時、native 経由で UI 言語にフォールバックする（`en` ではない） | `popup.js:69-74`, `bridge.js:428` | — |
| I18N-014 | P2（情報） | 既定の Grok テンプレートが 3 か所に重複定義されている | `popup.js:77-102`, `bridge.js:72-97`, `content.js:307-314` | — |

## 5. 各問題の根拠・表示箇所・発生条件・修正方法

### I18N-001 書签穿插（ブックマーク挿入）関連

- **根拠**
  - `content.js:1420-1421`: バッジ `'书签'` / `'插入的书签推文'`。
  - `1838-1839`: ボタンの title と aria-label `'书签穿插设置'`。
  - `1897-1932`: 状態文言 `未选择文件夹` / `已选 N 个文件夹` / `缓存中…` / `已缓存 N 条` / `刷新失败` / `待缓存` / `未命名文件夹` など。
  - `1946-1951`: 相対時間 `刚刚` / `N 分钟前` / `N 小时前` / `N 天前`。
  - `1962-1978`: ダイアログ本文（`书签穿插`、`启用`、`插入频率`、`书签文件夹`、`刷新`、`关闭`）。
  - `2010`: トースト `正在刷新书签内容` / `请先勾选书签文件夹`。
- **表示箇所・条件**
  - 設定ダイアログとバッジは、機能の有効化時に出る。
  - `featureBookmarkTimelineInject` の既定値は `false`（`bridge.js:232`）。
  - 設定ボタンの表示条件は未確認（§13）。
- **再利用**
  - 相対時間は、`ja` に `cfRulesMinutesAgo`、`cfRulesHoursAgo`、`cfRulesDaysAgo` が既にある。ただしプレースホルダー名 `$N$` を使う。
  - `contentBookmarkMenu*` は用途が異なるので再利用しない。
- **推奨**
  - 新規キー（例: `contentBti*`）を 3 ロケールに追加し、`CONTENT_MESSAGE_KEYS` に登録する。
  - 呼び出しは `i18n()` に置き換える。
  - 文字列そのものは翻訳するだけで、挙動は変えない。

### I18N-002 AI 返信生成 UI（P0）

- **根拠**（`content.js`）
  - `3931` `'⚠ AI 生成失败'`、`3935` `'请重试'`。
  - `4216` `评论模板`、`4259` `Grok 评论候选`。
  - `4271-4272` `生成中 N…` / `共 N 条`、`4281` `填充到回复框`、`4285` `已填充评论`。
  - `4428` ボタン既定ラベル `'AI 生成'`、`4483` `'生成中'`、`4554` `使用提示词模板生成评论`。
  - `4438` `AI 生成超时…`、`4468` `未找到推文内容`、`4497` `插件未正确加载…`、`4516` / `433` のフォールバック `AI 生成失败`。
- **表示箇所・条件**
  - 返信ボックスに表示される AI ボタン、候補パネル、テンプレートメニュー。
  - AI 返信機能を使うたびに表示される。主要機能のため P0。
- **再利用**
  - `aiTestFailed` などは文脈が異なる。
  - `grokShortTemplateLabel`（「プロンプトテンプレート」）は、`4216` のメニュー見出しに流用できる可能性がある。
  - 他は新規キーが必要。
- **推奨**
  - 新規キー（例: `contentAi*`）を追加する。
  - エラーの `fallback` 文字列は、英語など言語中立なものにそろえるか、キー経由に統一する。

### I18N-003 エラー・接続テスト結果（P0）

- **根拠**
  - `background.js`: `134, 140`（Base URL 検証）、`215-219, 230-231, 264-265`（HTTP とネットワークエラー）、`332, 339-340, 389, 406`（検証エラー）、`399-401, 410`（接続テストの成功メッセージ）、`461-462, 471-485`（Grok ルート、タブ未検出）。
  - `bridge.js:1006-1009`: `已检测到 X 会话标记…` / `Grok 就绪检查失败` / `…超时，请刷新 X 后重试。`
  - `lib/grok-reply.js:123, 128, 134, 375, 391-395, 401, 406-408, 416`。
- **表示箇所・条件**
  - ポップアップの AI 設定タブ「接続テスト」の結果。`popup.js:943-950` が `res.message` / `res.error` を**そのまま**表示する。
  - 生成失敗時のトースト（`showGrokErrorToast`）。
  - 一部は成功時の文言（`bridge.js:1006` など）。
- **再利用**
  - `aiTestOk`（接続テスト成功）、`aiTestFailed` は、フォールバック文言との置換に使える。
- **採用方針（決定済み）: エラーコード方式。既存のメッセージ契約との互換性を維持する**
  - 現行契約は `{ ok, message }` / `{ ok:false, error }`（文字列）。ポップアップは `res.message` / `res.error` をそのまま表示する（`popup.js:950, 952`）。
  - 既存の `message` / `error` 文字列フィールドは**削除も型変更もしない**。現行の中国語文字列を互換フォールバックとして残す。
  - 追加フィールドとして `code`（例: `'GROK_TIMEOUT'`）と、必要なら `params` を付ける。
  - 翻訳は表示側で行う。
    - ポップアップ: `chrome.i18n.getMessage` の差し替え済み経路（`tr(key)`）。
    - コンテンツ側: `CONTENT_MESSAGE_KEYS` 経由の `i18n()`。
  - 表示側は「`code` に対応するキーがあれば翻訳文、無ければ従来の `message` / `error`」の順で解決する。`code` を知らない旧コードと混在しても動く。
  - `background.js` に言語解決ヘルパは追加しない。
  - 変更対象は `background.js`、`bridge.js`、`lib/grok-reply.js`（`code` の付与）と、表示側（`popup.js`、`content.js`）。
  - 本家との差分を最小にするため、各 throw / 戻り値には `code` を足す程度に留める。メッセージ文面の書き換えはしない。
  - `lib/grok-reply.js` から `bridge.js` を経由する経路（`XVM_GROK_CHECK_RESULT`）では、`bridge.js:1007` が `String(result?.error || …)` に整形している。ここで `code` を落とさず転送する必要がある。
  - `content.js:433`（`new Error(event.data.error …)`）と `showGrokErrorToast` は `Error.message` しか持たない。`code` をどう保持するかは Phase 2 で設計する（例: `Error.code`）。

### I18N-004 コンテンツ屏蔽のバー

- **根拠**
  - `filter.js:652` `已过滤 N 条回复 - XVM`、`title="复制命中的推文和规则"`、`复制`。
  - `659-660` `复制` / `已复制` / `复制失败`。
  - `668-671` 診断テキスト `XVM 已过滤回复诊断`、`规则源:`、`数量:`、`时间:`。
- **表示箇所・条件**
  - 返信がフィルタされたときに画面上部に出るバー。
  - 診断テキストはクリップボードにコピーされる。サポート用途なので、翻訳対象にするかは判断が要る。
  - **Free 機能であることを確認済み**: `src/premium/license/gate.js:30` が `'content-filter': 'free'`、`filter.js:62-64` の `gateOpen()` は `isFeatureEnabled('content-filter')` を参照し、`tests/premium-content-filter.test.js:184` が Free を固定している。全ユーザーに表示されるため、優先度を **P0 に引き上げる**（§7 参照）。
- **注意**
  - ゲート判定やルールの挙動は変更しない。文字列だけを置き換える。
  - `filter.js` は MAIN world にあり、i18n 機構を持たない。

### I18N-005 トースト 2 件

- `content.js:217` `书签内容刷新失败：${error || '未知错误'}`。
- `content.js:3274` `无法定位该推文：页面已回收该条目`。
- 新規キーで置換する。

### I18N-006 `aria-label="Close"`

- `content.js:2194, 3868, 4261`。
- `ja` / `en` / `zh_CN` のいずれでも英語になる。
- 既存の `contentStarChartClose`（`ja`: 閉じる）を再利用できる。
- 一部は `i18n()` を使えるが、`3868`（更新ノートのモーダル）は `contentUpdateDismiss` と近い。

### I18N-007 `cf*` の 5 キー欠落

- **根拠**
  - `en` と `zh_CN` には `cfScopeHint`, `cfAllRulesTitle`, `cfBuiltinRule`, `cfCustomRule`, `cfNoRules` が存在する（再検証で `grep` により各ロケール 1 件ずつ確認）。
  - **`ja` にだけ存在しない**。
  - **訂正**: 初版は「`ja` と `zh_CN` の両方に無い」と誤記していた。初回の機械比較では `en` → `zh_CN` の不足は 0 件、`zh_CN` → `ja` の不足が 5 件と出ており、読み違えだった。
- **使用箇所**
  - `popup-content-filter.js:153`（`data-k="cfScopeHint"`）。
  - 同 `196`（`cfAllRulesTitle`）、`283`（`cfNoRules`）、`299`（`cfBuiltinRule` / `cfCustomRule`）。
- **発生条件**
  - ポップアップのコンテンツ屏蔽パネルが表示されるとき（`ja` のみ）。
  - この 5 つだけ英語になる（`zh_CN` は影響なし）。
- **推奨**
  - `ja/messages.json` に 5 キーを追加するだけでよい。`zh_CN` と `en` は変更不要。
  - `zh_CN` の中国語文言を参考に、`en` との意味の対応を確認して訳す。

### I18N-008 フォールバック挙動

- §3.3 のとおり、`messages` を受け取った後は `i18nOr` の `fallback` に到達しない。
- 影響は次の 2 つ。
  - キーを `CONTENT_MESSAGE_KEYS` に登録し忘れると、フォールバック文言ではなく生のキー名が出る。既存テストは `i18n()` 呼び出しだけを検査している。
  - `messages` の受信前は、`i18nOr` のフォールバック（多くが中国語）が一瞬出る。例: `content.js:121-125` の更新ノート（この経路は受信後に呼ばれるため、実害は小さいと見ている。未検証）。
- **推奨**
  - コード変更ではなく、テストで `i18nOr` のキーも検査する（§11）。

### I18N-009 既定テンプレート名

- `bridge.js:387` / `398` と `content.js:309-314, 375, 495` が `默认评论`、`模板 N` などを使う。
- 設定の受信前や、テンプレート名が空の場合にフォールバックとして使われる。
- 既存の `grokDefaultTemplateName` と `grokCustomTemplateName`（`ja`: テンプレート $N$）を再利用できる。
- ただし MAIN world の `content.js` では `messages` 経由に限られる。
- テンプレート**本文**（中国語プロンプト）は原文維持（§10）。

### I18N-010 AI プロンプトに付く中国語の追加指示

- `background.js:160`: `請只输出可直接发布的评论候选…最多返回 N 条。` が常に末尾に付く。
- `158` の空テンプレート時の指示は英語。
- 日本語・英語で生成する場合も、プロンプトの末尾に中国語の指示が付く。
- UI 文字列ではないが、出力言語に影響する可能性がある。
- **保留（決定済み）**: 今回は対応しない。AI プロンプトと出力言語の挙動は変更しない。Phase 2 の対象外とする。
- `aiLanguage` は `background.js:113` で読まれるだけで、参照箇所は確認できなかった（§13）。

### I18N-011 `<html lang>` と HTML 既定文言

- `popup.html:2` が `lang="zh-CN"` 固定。
  - 日本語表示でも CJK フォントが中国語字形を選ぶ可能性がある（要実機確認）。
  - `popup.js` の言語確定後に `document.documentElement.lang` を設定する案を提案する。
- `popup.html:761`: `data-i18n="tabAi"` の既定テキストが `AI 评论`。
  - キーが解決されれば置き換わるので、通常は表示されない。
  - ただし他の既定テキストは英語で、一貫していない。
- `popup.html:925`: `popupGrokPromptHint` の既定テキストに `[推文内容]` が含まれる。これはプロンプトのトークンなので維持する。

### I18N-012 未参照キー

- 41 件（付録 A）。
- ただし `proBanner*` など一部は既存テストが存在を要求する（`tests/premium-popup-ui.test.js:125-146`、`premium-rate-filter-popup.test.js:187-203`）。
- 削除は推奨しない。

### I18N-013 明示言語でのフォールバック

- §3.3 の 1 と 2 のとおり。
- `ja` を明示してもキーが無いと、UI 言語の翻訳になる可能性がある。
- 影響が出るのは現状 I18N-007 のみ。

### I18N-014 既定テンプレートの 3 重定義

- `popup.js:77-102`、`bridge.js:72-97`、`content.js:307-314` は内容が異なる（`content.js` は中国語のみ）。
- 機構上の問題だが、不具合とは確認していない。
- 本家の更新で衝突しやすい（§12）。

## 6. 既存キーの再利用可否

| 用途 | 再利用候補 | 判定 |
|---|---|---|
| 閉じる（aria） | `contentStarChartClose` | 可 |
| 接続テスト成功 / 失敗 | `aiTestOk`, `aiTestFailed` | 可（文言が汎用） |
| テンプレート名 | `grokDefaultTemplateName`, `grokCustomTemplateName` | 可 |
| 相対時間 | `cfRulesMinutesAgo`, `cfRulesHoursAgo`, `cfRulesDaysAgo` | 可（`$N$`） |
| AI の見出し・ステータス | — | 新規 |
| 書签穿插ダイアログ | — | 新規 |

## 7. 優先順位の集計

| 優先 | 件数 | ID |
|---|---|---|
| P0 | 4 | I18N-002, I18N-003, I18N-004, I18N-007 |
| P1 | 4 | I18N-001, I18N-005, I18N-009, I18N-011 |
| P1（保留） | 1 | I18N-010（今回は対応しない） |
| P2 | 5 | I18N-006, I18N-008, I18N-012, I18N-013, I18N-014 |

合計 14 件（I18N-004 を P1 から P0 に変更したため、P0 が 4 件、P1 が 4 件、保留が 1 件になった）。

## 8. 推奨する実装順序（Phase 2 向け）

1. **I18N-007**: `ja` に 5 キーを追加（Phase 2-1 で完了。付録 B 参照）。
2. **I18N-002**: AI 返信生成 UI（`content.js`）。
3. **I18N-005 と I18N-006**: トーストとアクセシビリティ（`content.js`）。
4. **I18N-004**: コンテンツフィルターの i18n 経路を**先に設計してから**実装する。
   - 対象ファイルは `content.js` ではなく `src/premium/content-filter/filter.js`（`manifest.json` の MAIN world で `content.js` より前に読み込まれる別スクリプト）。
   - `filter.js` は i18n 機構を持たない（§3.1）。`CONTENT_MESSAGE_KEYS` への登録、`localizedStrings` の参照方法、読み込み順の影響を設計で確定する。
   - 初版の §8 は I18N-004 を `content.js` の作業に含めていたが、これは誤りだった。
5. **I18N-003**: 独立した工程。エラーコード方式（`code` を追加し、既存の `message` / `error` は互換のため維持）。
6. **I18N-001**: 書签穿插のキー化。量が多いので、分けて進める。
7. **I18N-009、I18N-011**: 小さな修正をまとめる。
8. **I18N-010**: 引き続き保留。Phase 2 では扱わない。

## 9. 推奨する修正方針（共通）

- 既存機構を再利用する。つまり `messages.json` → `CONTENT_MESSAGE_KEYS` → `i18n()` の経路だけを使い、新しい翻訳基盤は作らない。
- 機能の挙動、ライセンス判定、Pro 機能のロジックは変更しない。
- 変更は翻訳目的に限定し、リファクタリングは行わない。
- 翻訳の一括自動置換はしない。1 キーずつ文脈を確認する。
- 新規キーは `en` / `ja` / `zh_CN` の 3 つに同時に追加する。

## 10. 誤検出・対象外と判断した項目

| 場所 | 内容 | 判断 |
|---|---|---|
| `popup.js:79-84, 98-102`、`bridge.js:74-97, 729-734`、`content.js:307-314, 325-326` | 中国語・英語・日本語のプロンプト本文、テンプレート名 | 原文維持（プロンプトは AI への入力） |
| `[推文内容]`（複数ファイル） | プロンプトのプレースホルダートークン | 原文維持（変更するとパースが壊れる） |
| `content.js:323` | `GROK_CODE_BLOCK_RE` の `代码块\|代碼區塊\|コードブロック` | 検出用の正規表現 |
| `content.js:1693-1694` | `为你推荐`、`正在关注`、`おすすめ` など | X の UI 判定用文字列 |
| `content.js:4639, 4660` | `链接预览`、`复制链接`、`リンクをコピー` など | X の UI 判定用文字列 |
| `lib/long-image-viewer.js:288` | `上一张\|下一张` | X の UI 判定用文字列 |
| `starchart.js:639` | CJK 判定の正規表現 | ロジック |
| `popup-content-filter.js:72` | 区切り文字 `，` | ロジック |
| `src/premium/content-filter/rules.js`、`filter.js:341-342`、`rules.json` | 屏蔽ルールの中国語キーワード・正規表現 | 検索キーワード、翻訳不要 |
| `popup.js:3-13` の `LANGUAGE_LABELS`、`LANGUAGE_TOGGLE_TEXT` | 言語名（`中文`、`日本語`）、`Auto / 跟随系统` | 言語名は自言語表記が正しい。`auto` のフォールバックは、キー解決後は使われない |
| `_locales/ja` で `en` と同一の文字列 | `via X Viral Monitor`、`Powered by`、`Base URL`、`Ollama`、`English`、`Community DEV Build`、`creem-XXXXX...`、`X Grok` | ブランド名・固有名詞・技術用語として妥当 |
| `_locales/en` の `languageZh`/`languageJa` | `中文`、`日本語` | 言語名 |
| `starchart.js:882-885` | `No queryId for…`（`Error` の内部メッセージ） | 開発者向けの例外。UI 表示経路は未確認 |
| `site/`、`docs/` の Web サイト、`userscript/` | — | 対象外 |

- プレースホルダーの相違、重複キー、`en` に CJK が混ざる箇所（`languageZh`/`languageJa`/`popupGrokPromptHint` の `[推文内容]` を除く）は、確認した範囲では検出なし。
- `CONTENT_MESSAGE_KEYS` に載っているキーのうち、ロケールに存在しないものは、確認した範囲では検出なし。
- `content.js`・`popup*.js`・`src/premium` が参照するキーのうち、ロケールに存在しないものは、確認した範囲では検出なし。
- `popup-dashboard.js`、`bookmark-menu.js`、`lib/` のうち `grok-reply.js` と `long-image-viewer.js` 以外には、確認した範囲で CJK 直書きの検出なし。

## 11. 回帰テストの提案

### 既存テストが検出できること

- `content.js` の `i18n('…')` が `CONTENT_MESSAGE_KEYS` に載っていること（`tests/popup-dashboard.test.js:726`）。
- `CONTENT_MESSAGE_KEYS` の各キーが `en` と `zh_CN` に存在すること（同 `746` 付近）。
- `popup.html` の `data-i18n` キーが 3 ロケールに存在すること（同 `757`）。
- 個別機能の必須キーの存在確認（`premium-popup-ui` は `en` と `zh_CN` のみ、`premium-rate-filter-popup` は 3 ロケール）。

### 検出できていないこと

| 見落とし | 該当 ID |
|---|---|
| `i18nOr()` と `LB_COLUMN_LABEL_KEYS` などオブジェクト経由のキーが、`CONTENT_MESSAGE_KEYS` に載っているか | I18N-008 |
| `CONTENT_MESSAGE_KEYS` のキーが `ja` に存在するか（`en` と `zh_CN` だけ検査） | — |
| ロケール間のキー集合の一致（`cf*` の欠落） | I18N-007 |
| ロケール間のプレースホルダーの一致 | — |
| `data-k` と `t('…')` で参照されるキーの存在（`src/premium/*`） | I18N-007 |
| 実行時 UI への新しい CJK / 英語直書きの混入 | I18N-001〜005 |

### 追加テストの案

1. **ロケール整合テスト**
   - 3 ロケールのキー集合が一致すること。
   - 各キーのプレースホルダー名・数が一致すること。
   - 重複キーが無いこと。
   - 現時点では `cf*` の 5 キーで失敗するため、I18N-007 の修正と同時に入れる。
2. **参照キー存在テスト**
   - `i18n(` / `i18nOr(` / `t(` / `data-i18n` / `data-k` で参照される文字列リテラルが、全ロケールに存在すること。
3. **ハードコード検出テスト**
   - 対象の実行時ファイルで、コメントを除いた CJK を含む行を検出する。
   - 許可リストは、§10 の「原文維持」に対応する形で、ファイルと行内容のパターンで持つ。
   - 許可リストは、行番号ではなく内容（例: `GROK_*` 定数）で管理する。
   - 初期状態では I18N-001〜005 を既知の違反として記録し、修正に合わせて縮小する。
4. **`CONTENT_MESSAGE_KEYS` の孤立キー検出（任意）**
   - 例: `contentStarChartPeopleSectionTitle` はどこからも参照されていない。

## 12. 本家アップデート追従時の注意事項

- 本家は `Icy-Cat` が主な開発者で、`_locales/ja` も本家由来である（`git log` で確認）。
- 再検証時点で `upstream/main` = `b1b896d` = 現在の `main` / `ja-fix`。差分ゼロ。
- **衝突しやすい箇所**
  - `content.js`: 巨大（5701 行）で更新が多い。I18N-001〜002 の編集箇所が本家の機能追加と重なりやすい。
  - `bridge.js` の `CONTENT_MESSAGE_KEYS`: 本家が追加すると、同じ配列の末尾で衝突する。
  - `_locales/*/messages.json`: 末尾への追加は衝突しやすい。
- **緩和策**
  - 新規キーは、既存キーと混ざらない接頭辞（例: `contentBti*`、`contentAi*`）でまとめる。
  - `messages.json` の編集は、本家の追加位置を避けて**途中ではなくブロックで追加**する。
  - 1 つの修正を小さなコミットに分け、`upstream` の取り込み前後で `git rebase` しやすくする。
  - `upstream` の最新を取り込んだあとに、ロケール整合テストを必ず再実行する（`upstream/main` は現 HEAD と同一なので、現時点で `cf*` の `ja` 版は本家にも無い。取り込み後に本家が追加していれば I18N-007 の修正は重複するため、先に確認する）。
- `popup.js` と `bridge.js` の重複ヘルパは、本家が片方だけ修正する場合がある。変更時は両方を確認する。

## 13. 未確認事項

- 実機での表示確認。今回はコード読解と機械的な比較のみで、拡張機能の読み込みは行っていない。
- `<html lang="zh-CN">` による日本語の字形への実際の影響（I18N-011）。
- 書签穿插の設定ボタンの表示条件（I18N-001）。`content.js:1825-1838` はタイムライン上のタブの隣にボタンを作る処理で、`featureBookmarkTimelineInject`（既定 `false`）との関係は未追跡。
- `background.js:113` の `language`（`aiLanguage` 由来）は、`background.js` 内で参照箇所を確認できなかった。`content.js:4451` はこの値を `language` として送っており、受け側での使われ方は未追跡（I18N-010 は保留）。
- `content.js` の `showGrokErrorToast`、`aiPendingRequests` 経由のエラー文言が、どの経路でユーザーに届くか（I18N-003 の一部）。
- `starchart.js:882-885` の例外メッセージが、UI に表示されるか。
- `scripts/build-dist.mjs` が `_locales` を含めてコピーすること以外の、ビルド時の i18n 関連処理。

## 付録 A: 参照されていない翻訳キー（41 件）

リテラルまたは `data-i18n` / `data-k` / `__MSG_*__` での参照を、実行時ファイルで確認できなかったキー。動的に組み立てる箇所は見つからなかった。

```
hoverHint, featureLeaderboardDesc, popupGrokPromptTitle, flashGrokPromptSaved,
proBannerFree, proBannerPro, proBannerTrial, proBannerTrialOne,
proNudgeTrialEnd, proNudgeTrialEndOne, proActivatePlaceholder, proManageBtn,
proDeactivateBtn, proDeactivating, proDeactivatedOk, proDeactivateErr,
rfEnabled, rfShortLegend, rfLongLegend, rfSave, rfSavedOk,
accRateFilter, accRateFilterSub, accLeaderboard, accPro, accOther,
cardFreeFeaturesTitle, cardProFeaturesTitle, cardProFeaturesSub,
featureBadgeLabel, featureLeaderboardLabel, featureCopyMdLabel,
featureRateFilterLabel, chipEnabled, btnConfigure, btnBack, footerPoweredBy,
toastM2Hint, activateTitle, grokShortTemplateLabel, cfLockedHint
```

加えて、`contentStarChartPeopleSectionTitle` は `CONTENT_MESSAGE_KEYS` に載っているが、`content.js` / `starchart.js` / `bookmark-menu.js` から参照されていない。

## 付録 B: 実装・検証結果（Phase 2-1: I18N-007）

実施日: 2026-11-05。ブランチ `ja-fix`。未コミット。

### 修正内容

- `_locales/ja/messages.json` に 5 キーを追加した（`cfAutoSaved` の直後にブロックで追加。`en` と `zh_CN` は無変更）。

| キー | 追加した日本語 |
|---|---|
| `cfScopeHint` | 投稿詳細ページの返信欄にのみ適用されます。ホーム、検索、プロフィール、メインの投稿自体は対象外です。 |
| `cfAllRulesTitle` | すべてのルール |
| `cfBuiltinRule` | 内蔵 |
| `cfCustomRule` | カスタム |
| `cfNoRules` | ルールはありません。 |

- 用語は既存の `ja` に合わせた。「内蔵」は `cfRuleCounts`、「カスタム」は `cfCustomTitle`、「投稿」は `contentFallbackTweetLabel` を踏襲している。
- `zh_CN` の文意との対応は、`zh_CN` の原文と照合して確認した。

### 追加した回帰テスト

`tests/locale-consistency.test.js`（8 件。レビュー対応で Unicode エスケープ重複と `content` 定義の検証を追加）。

- 3 ロケールで `messages.json` に重複キーが無いこと（`JSON.parse` は重複を黙って潰すため、専用の走査で検出する。Unicode エスケープ表記の同一キー（例: `"\u0061"` と `"a"`）も検出する。走査自体の自己テスト付き）
- 3 ロケールのキー集合が完全一致すること
- 各キーの `$NAME$` / `$n` / `{{NAME}}` の名前・出現数と、宣言された `placeholders` 名および各 `content` 定義（`$1` など）が `en` と一致すること
- 空文字のメッセージが無いこと
- I18N-007 の 5 キーが 3 ロケールすべてに存在すること

既存テストとの重複は確認済み。既存は、機能ごとの必須キーの存在確認と `popup.html` の `data-i18n` 参照の確認だけで、ロケール全体の集合一致・プレースホルダー・重複は検査していなかった。そのため新規ファイルとして追加した。

### 検証結果

- 修正前の基準: `npm run build:community` 後の `npm test` は 29 ファイル・424 テストすべて合格（`dist/` 生成で、前回の 3 件の失敗は解消）。
- 新テストの有効性: `ja` を一時的に HEAD 版に戻すと、キー集合一致と I18N-007 の 2 件が失敗することを確認した（その後、修正版に復元）。
- 修正後: 再ビルド後の `npm test` は 30 ファイル・430 テストすべて合格（424 + 新規 6）。レビュー対応後の最終結果は §付録 B 末尾を参照。
- `dist/` との一致: `tests/build-dist-sync.test.js` が合格。`dist/_locales/ja/messages.json` はソースと同一。
- ソース変更は `_locales/ja/messages.json` のみ（`git diff --stat`: 5 行追加）。`sync-rules` による `rules.js` の再生成で差分は出ていない。

### レビュー対応後の最終結果

- 回帰テストを 6 件から 8 件に拡張した（Unicode エスケープ重複の検出、`content` 定義の検証）。既存の翻訳データの変更は不要だった。
- `npm run build:community` 後の `npm test`: **30 ファイル・432 テストすべて合格**（既存 424 + 新規 8）。
- ソース変更は `_locales/ja/messages.json` のみ。ほかに新規ファイルが `tests/locale-consistency.test.js` と `docs/i18n-audit.md`。

## 付録 C: I18N-002 実装結果（Phase 2-2）

### 対象と境界

| 区分 | 場所 | 扱い |
|---|---|---|
| UI 文字列（今回修正） | `content.js` の `showGrokErrorToast`（タイトルと既定の詳細）、`showGrokTemplateMenu`（見出し）、`showGrokOptions`（パネル見出し、件数ステータス、候補の title、挿入トースト）、`setGrokButtonLabel`（既定ラベル）、`handleGrokGenerate`（生成中ラベル、「推文なし」トースト）、`injectGrokReplyButtons`（AI ボタンの title） | キー化 |
| エラーメッセージ契約（I18N-003、**今回は変更しない**） | `content.js:433` の `new Error(event.data.error \|\| 'AI 生成失败')`、`4438` 付近の `new Error('AI 生成超时…')`、`4497` 付近の `new Error('插件未正确加载…')`、`4516` 付近の `showGrokErrorToast(err?.message \|\| 'AI 生成失败')` | 文字列のまま。`Error.message` と `{ ok, error, message }` の契約を維持 |
| Grok の入力プロンプト | `content.js` の `【原推文】` / `【对该推文的回复】`、テンプレート本文 | 翻訳しない |
| 別 ID | `aria-label="Close"`（I18N-006）、`'书签'` 系（I18N-001） | 今回は触れない |

`showGrokErrorToast` の「詳細」は、メッセージが渡されたときはそのまま表示する（契約維持）。空のときだけ `contentAiErrorRetry` を使う。

### 追加した翻訳キー（12 件、3 ロケール同時、`bridge.js` の `CONTENT_MESSAGE_KEYS` に登録済み）

レビュー対応で `contentAiOptionsTitle` と `contentAiButtonLabel`（en）の文言を調整済み。

| キー | en | ja | zh_CN |
|---|---|---|---|
| `contentAiButtonLabel` | AI Generate | AI 生成 | AI 生成 |
| `contentAiButtonGenerating` | Generating | 生成中 | 生成中 |
| `contentAiButtonTitle` | Generate replies with a prompt template | プロンプトテンプレートで返信を生成 | 使用提示词模板生成评论 |
| `contentAiTemplateMenuTitle` | Reply templates | 返信テンプレート | 评论模板 |
| `contentAiOptionsTitle` | AI reply suggestions | AI の返信候補 | AI 回复候选 |
| `contentAiOptionsGenerating` | Generating {{COUNT}}… | 生成中 {{COUNT}} 件… | 生成中 {{COUNT}}… |
| `contentAiOptionsCount` | {{COUNT}} replies | 全 {{COUNT}} 件 | 共 {{COUNT}} 条 |
| `contentAiOptionFillTitle` | Insert into reply box | 返信欄に挿入 | 填充到回复框 |
| `contentAiOptionFilledToast` | Reply inserted | 返信を挿入しました | 已填充评论 |
| `contentAiErrorTitle` | AI generation failed | AI 生成に失敗しました | AI 生成失败 |
| `contentAiErrorRetry` | Please try again | もう一度お試しください | 请重试 |
| `contentAiNoTweetFound` | Tweet content not found | 投稿の内容が見つかりません | 未找到推文内容 |

- 既存キーは再利用しなかった。`contentCopyMdNoTweetFound` は文言が異なり（「投稿が見つかりません」）、`grokShortTemplateLabel` は「プロンプトテンプレート」で意味が違うため。
- `contentAiOptionsTitle` は、候補パネルが X Grok 以外のプロバイダー（OpenAI 互換、Ollama）でも使われるため、プロバイダー名を含まない表現にした。`content.js` の初期化前フォールバックも `AI 回复候选` に合わせた（従来は `Grok 评论候选`）。
- 件数は `starchart.js` と同じ `{{COUNT}}` + `.replace()` 方式にそろえた。
- `⚠ ` は翻訳文に含めず、コード側で付けている。

### 初期化前・言語変更時・失敗時の挙動

- **初期化前**（`localizedStrings` が空）: `i18nOr` のフォールバック（中国語）が表示される。**ただし候補パネルの見出しだけは例外**で、プロバイダー非依存の表現に変えたため、フォールバックも従来の `Grok 评论候选` から `AI 回复候选` に変わっている（それ以外の 11 件は従来と同一の文字列）。
- **初期化後**: bridge が登録済みキーを解決して渡す。登録漏れなら生のキー名が出る（I18N-008）ため、登録を自動テストで固定した。
- **言語変更時**: 候補パネルの見出しは `showGrokOptions` のたびに更新する。テンプレートメニューは開くたびに生成する。AI ボタンのラベルは、生成後の `setGrokButtonLabel` で更新される。**ボタンの title は生成時の言語のまま**で、ページ再読み込みまで更新されない（既存の「構築済み DOM は再生成しない」仕様と同じ）。
- **生成失敗時**: エラー本文は従来どおり契約のメッセージ。タイトルと既定の詳細のみ翻訳される。

### 追加・変更したテスト

- 新規 `tests/ai-ui-i18n.test.js`（16 件）
  - 12 キーが 3 ロケールにあること、`bridge.js` に登録済みであること、`content.js` が全キーを使うこと。
  - `content.js` の全 `i18nOr()` キーが `CONTENT_MESSAGE_KEYS` にあること（既存テストは `i18n()` しか見ていなかった）。
  - AI UI 関数群に、キー化されていない CJK が残っていないこと（許可: プロンプト `【原推文】`、`new Error(…)`、`err?.message ||`）。
  - ja / en / zh_CN での実行時解決、初期化前フォールバック（見出しを除く）、`{{COUNT}}` の置換、エラー本文が変わらないこと、`XVM_AI_GENERATE` の送信経路が変わらないこと。
- 変更 `tests/grok-readiness.test.js`: `showGrokErrorToast` を単体実行する環境に `i18nOr` のスタブ（フォールバックを返す）を追加しただけ。期待値は変更なし。
- 有効性の確認: `content.js` を HEAD 版に戻すと 9 件が失敗する。

### 未確認事項

- 実ブラウザでの表示（AI ボタン、候補パネル、テンプレートメニュー）。
- `{{COUNT}}` の英語表現（`{{COUNT}} replies`）は件数 1 のときも複数形になる。

## 付録 D: I18N-005 / I18N-006 実装結果（Phase 2-3）

### I18N-005 トースト

| 場所 | 変更前 | 変更後 |
|---|---|---|
| `content.js:217` | `` `书签内容刷新失败：${event.data.error \|\| '未知错误'}` `` | `i18nOr('contentBookmarkTimelineRefreshFailed', …).replace('{{ERROR}}', () => String(event.data.error \|\| i18nOr('contentUnknownError', …)))` |
| `content.js:3274` | `'无法定位该推文：页面已回收该条目'` | `i18nOr('contentLbLocateFailed', …)` |

- 動的なエラー詳細（`event.data.error`）は、そのまま表示する。置換には関数を使うため、`$&` や `$1` を含む文字列も加工されない。
- 詳細が空のときの `未知错误` も、`contentUnknownError` で翻訳する。
- `event.data.error` 自体の言語は、bridge / background 側が決める（I18N-003 の範囲。今回は変更しない）。
- 初期化前は、従来と同一の中国語がフォールバックとして表示される。

追加キー（3 ロケール同時、`CONTENT_MESSAGE_KEYS` 登録済み）:

| キー | en | ja | zh_CN |
|---|---|---|---|
| `contentBookmarkTimelineRefreshFailed` | Bookmark refresh failed: {{ERROR}} | ブックマークの更新に失敗しました: {{ERROR}} | 书签内容刷新失败：{{ERROR}} |
| `contentUnknownError` | Unknown error | 不明なエラー | 未知错误 |
| `contentLbLocateFailed` | Can't locate this tweet: the page has already removed it | この投稿に移動できません。ページの表示が更新されたため、対象が見つからなくなりました。 | 无法定位该推文：页面已回收该条目 |

### I18N-006 `aria-label="Close"`

| 場所 | 要素 | 変更 |
|---|---|---|
| `content.js:2194` | リーダーボードの Pro 案内バブルの閉じるボタン | テンプレートから固定の `aria-label` を外し、生成後に `setAttribute` |
| `content.js:3868` | 更新ノートのモーダルの閉じるボタン | `setAttribute('aria-label', i18nOr(…))` |
| `content.js:4262` | AI 候補パネルの閉じるボタン | テンプレートから固定の `aria-label` を外し、`showGrokOptions` の呼び出しごとに設定（言語変更が反映される） |

- 3 箇所とも既存キー `contentStarChartClose`（en: Close / ja: 閉じる / zh_CN: 关闭）を再利用した。
- 再利用の根拠: いずれも「このパネルを閉じる」だけの汎用ボタンで、文意が一致する。`contentLeaderboardClose`（「注目投稿リストを閉じる」）は、バブルや更新モーダルには意味が合わないため使わなかった。`contentUpdateDismiss`（「了解」）は別の OK ボタン用なので使わなかった。
- 留意点: キー名が StarChart 由来のため、本家が `contentStarChartClose` の文言を StarChart 専用に変更すると、この 3 箇所にも影響する。変更が入った場合は、専用キーを分ける。
- クリック時の処理（`bubble.remove()`、`closeGrokOptions`、`dismiss`）は変更していない。
- フォールバックは従来と同じ英語の `Close`。

### テスト

- 新規 `tests/toast-a11y-i18n.test.js`（13 件）
  - 新規キーが 3 ロケールにあり、`CONTENT_MESSAGE_KEYS` に登録され、使用されていること。
  - `{{ERROR}}` が各ロケールに 1 つずつあること。
  - 3 言語での表示、動的なエラー詳細の保持（`$` パターンを含む）、詳細が空のときの翻訳、初期化前の中国語フォールバック。
  - 固定の `aria-label="Close"` が残っていないこと、3 箇所が `contentStarChartClose` を使うこと、閉じる動作が変わっていないこと、候補パネルのラベルが毎回設定されること。
- ロケール間のキー集合とプレースホルダーの一致は、既存の `tests/locale-consistency.test.js` が検証している。
- 有効性: `content.js` を HEAD 版に戻すと 10 件が失敗する。

### 作業メモ

- 作業開始時、`npm test` が 1 件失敗していた（`build-dist-sync`: `_locales/.DS_Store` の内容が `dist/` の複製と不一致）。`.gitignore` 済みの macOS 生成ファイルが原因で、ソースとは無関係。`npm run build:community` で `dist/` を再生成して解消した（`.DS_Store` は削除していない）。
