# X Viral Monitor（X バイラルモニター）

[简体中文](README.md) | [English](README.en.md) | 日本語

X（旧 Twitter）のタイムライン上で、各投稿の**インプレッション速度（1 時間あたりの表示回数）**をリアルタイムに表示します。なお、このドキュメントでは「インプレッション速度」と呼んでいますが、拡張機能の日本語 UI では「流速」（例：流速バッジ、流速フィルター）と表示されます。あわせて、閲覧や投稿づくりを支えるツール群も備えています。

[![Chrome Extension](https://img.shields.io/badge/Chrome-拡張機能-blue?logo=googlechrome)](https://chromewebstore.google.com/detail/x-viral-monitor/dkplofpecmjmbhgjgleeflcnfgfkdfpd)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://chromewebstore.google.com/detail/x-viral-monitor/dkplofpecmjmbhgjgleeflcnfgfkdfpd)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-軽量版-orange?logo=tampermonkey)](userscript/x-viral-monitor.user.js)
[![iOS Userscripts](https://img.shields.io/badge/iOS_Safari-Userscripts-lightgrey?logo=safari)](userscript/x-viral-monitor.mobile.user.js)

> 共通のコアロジックを、**Chrome 拡張機能 / Tampermonkey ユーザースクリプト / iOS Safari の Userscripts アプリ / Android の Quetta ブラウザ**という 4 つの環境で動かせます。詳しくは[インストール](#インストール)をご覧ください。

> **このリポジトリについて**
>
> このリポジトリ（`sysCat64/x-viral-monitor-syscat`）は、X Viral Monitor の**日本語対応を改善するためのフォーク**です。オリジナルのプロジェクトは [Icy-Cat/x-viral-monitor](https://github.com/Icy-Cat/x-viral-monitor) です。
>
> - このフォークは独立した公式製品ではありません。本家による公式サポートやアップデートがこのフォークに提供されるわけではありません。
> - Chrome ウェブストアで配布されている公式版と、このフォークのソースから作成したビルドは別物です。公式版のライセンス認証・自動更新・サポートは、このフォークのビルドには適用されません（詳しくは[オープンソースと公式版](#オープンソースと公式版)を参照）。
> - 本家の最新の情報や公式版については、[本家リポジトリ](https://github.com/Icy-Cat/x-viral-monitor)をご確認ください。

---

## 機能一覧

| 機能 | 表示場所 | 説明 |
|---|---|---|
| インプレッション速度バッジ | タイムライン上の各投稿 | 1 時間あたりの表示回数（impression/h）を表示。カプセル型とインライン型の 2 種類のスタイルから選べます |
| インプレッション速度ランキング | フローティングパネル（ドラッグ可） | 現在のページに表示されている投稿を速度順に並べます。列は自由にカスタマイズできます |
| ブックマーク数の表示 | 投稿のアクションバー | タイムライン上のブックマークボタンの横に、数を直接表示します |
| 画像ビューアの強化 | X 標準のライトボックス | トラックパッドのピンチ操作 / Ctrl+ホイールで拡大縮小、2 本指 / ドラッグで移動、ダブルクリックで切り替え。縦長画像（高さ/幅 > 3）は、幅固定の縦スクロール表示に自動で切り替わります |
| コンテンツフィルター | 投稿の返信欄 | スパム・アダルト・Telegram 誘導などを段階的なルールで非表示にします。**ルールはリモートから取得**され、自動更新されます |
| インプレッション速度フィルター | タイムライン | views/min のしきい値を下回る投稿を非表示にします。短い投稿と長文（記事）でしきい値を別々に設定できます |
| AI返信候補 | 返信ボックスの ✦ ボタン | ブラウザのログイン状態を利用する X Grok に加え、外部 AI サービスにも対応。プロンプトテンプレートを使って返信候補を生成します |
| Markdownとしてコピー | 共有メニュー | 投稿を Markdown 形式でコピーします |
| サンクス・スターチャート | 共有メニュー | リポスト・引用してくれたユーザーを、アニメーションする粒子の図として可視化します |

---

## オープンソースと公式版

このリポジトリには、Pro 機能のゲートやライセンスのロジックを含む X Viral Monitor の完全なソースコードが入っています。ソースコードは MIT ライセンスで公開されており、自分で監査・改変・ビルドできます。

Chrome ウェブストアの版は**公式配布版**で、ワンクリックでのインストール、自動更新、ライセンス認証、メンテナンスによるサポートが提供されます。GitHub から自分でビルドした版や、デベロッパーモードで読み込んだ版は community / セルフビルドの扱いとなり、MIT ライセンスのもと「現状有姿（as-is）」で提供されます。Chrome ウェブストアの自動更新や、公式サポートの約束は含まれません。

### Community DEV ビルドについて

`npm run build:community` で作成したビルドは **Community DEV ビルド**です。ポップアップに「Community DEV Build」と表示され、ローカルでは Pro 機能がすべて有効になります。公式のライセンスサービスと自動更新は Chrome ウェブストア版向けのものです。

一方、`npm run build:dist`（`build:store` と同じ処理）で作成するのは、ストア版と同じ `store` チャンネルのビルドです。ただし、ソースから自分でビルドしたものであることに変わりはなく、公式配布版ではありません。この 2 つのビルドはどちらも `dist/` に出力されるため、あとから実行したほうが前のビルドを上書きします。

### 無料機能と Pro 機能の区分

| 無料機能 | Pro / トライアルで使える高度な機能 |
|---|---|
| インプレッション速度バッジ、インプレッション速度ランキング、ブックマーク数の表示 | インプレッション速度フィルター：views/min と総表示回数で、速度の低い投稿を非表示 |
| 画像ビューアの強化、縦長画像の閲覧 | 短い投稿と長文でそれぞれ別のしきい値を設定 |
| コンテンツフィルター、リモートルールの更新、カスタムルール | Home / Lists / Profile / 投稿詳細ごとに適用範囲を選択 |
| AI返信候補、Markdownとしてコピー、サンクス・スターチャート | 今後追加予定の高度なモニタリング・通知・自動化機能 |

Proライセンスは、公式版の Pro 機能を解放するためだけのものです。クライアントのコード自体は DRM による保護を前提としていません。有料で提供される価値は、公式ビルド、自動更新、ライセンスサービス、サポート、そして継続的なメンテナンスにあります。

> 補足：Pro 機能は初回利用から 14 日間のトライアルで試せます（実装上の `TRIAL_DAYS = 14`）。

---

## インプレッション速度のランク

速度は「総表示回数 ÷ 投稿からの経過時間（時間単位）」で求めます。投稿直後の極端な値を避けるため、経過時間は最小で 0.1 時間として計算します。

| アイコン | 色 | 速度 | 意味 |
|------|------|------|------|
| 🌱 | 緑 | < 1,000/h | 通常 |
| 🚀 | オレンジ | 1,000 - 10,000/h | 注目され始めている |
| 🔥 | 赤 | ≥ 10,000/h | バズっている |

上記は初期値です。しきい値はポップアップの設定から変更できます。

### バズ指数（ホバーカードに表示）

0〜100 の総合スコアです。4 つの要素に重みを付けて算出します。

| 要素 | 重み | 満点になる条件 |
|------|------|----------|
| インプレッション速度 | 40% | 50,000/h |
| エンゲージメント率 | 25% | 10%（（いいね + リポスト + 返信）÷ 表示回数） |
| リポスト比 | 20% | リポスト/いいね = 50% |
| ブックマーク比 | 15% | ブックマーク/いいね = 30% |

---

## AI返信候補

返信ボックスの右下に **✦ AI 生成**ボタンが表示されます。クリックすると、次のように進みます。

1. プロンプトテンプレートを選択します。
2. 返信候補がストリーミングで表示されます（最初の 1 件が出た時点で選べるので、すべての生成完了を待つ必要はありません）。
3. 候補を 1 つクリックすると、X の返信エディタにそのまま入力され、返信ボタンが有効になります。

返信先が別の返信である入れ子のケースにも対応しています。この場合、プロンプトには「元の投稿 + 返信先の内容」の 2 段階の文脈が自動的に組み込まれます。

### 対応プロバイダー

ポップアップの「AI 返信」タブで、プロバイダーを選べます。

| プロバイダー | 概要 |
|---|---|
| X Grok（初期設定） | X にログイン済みの状態をそのまま利用します。API キーは不要です |
| Ollama | ローカルで動作するモデルサービスです。Ollama が起動済みで、モデルをダウンロード済みである必要があります |
| OpenAI 互換 | OpenAI / DeepSeek / OpenRouter / Kimi（Moonshot）/ Qwen（DashScope）/ SiliconFlow / LM Studio / Ollama（OpenAI 互換）のプリセットから選べます。API Key が必要です（ローカルのサービスを除く） |

> **プライバシーに関する注意**
>
> - X Grok を使う場合、リクエストは手元のブラウザから、ログイン済みの X の Grok 窓口（`x.com/i/grok`）経由で送られます。API キーや第三者サービスへのログインは不要です。
> - OpenAI 互換のクラウドサービスを選んだ場合は、投稿の本文と返信の文脈が、設定したサービスに送信されます。Ollama と LM Studio はローカルで動作します。

### X Grok を使うときの条件と制約

- X にログインした状態の x.com のタブで利用します。拡張機能は、そのタブの X のログイン状態を使って Grok に接続します。
- 「Grok の準備状態を確認」ボタンは、X のセッションの状態と署名の生成を確認するだけで、チャットは送信しません。生成用のエンドポイントそのものは検証せず、アカウントの有効性や Grok の利用権限を保証するものでもありません。
- 生成に失敗した場合は、エラーの種類に応じて、表示言語に合わせたメッセージが表示されます。対応するメッセージがない場合は、サービスから返った元のエラー文がそのまま表示されます（このため、日本語以外の文言が表示されることがあります）。
- 「一時チャット」（Temporary chat）モードが初期設定で有効になっており、Grok の会話履歴を汚しません。
- X Grok を使う機能は Chrome 拡張機能版の機能です。Tampermonkey / iOS 向けのユーザースクリプトには含まれません。
- X 側の Web フロントエンドの仕様変更によって、動作しなくなる可能性があります。

### プロンプトテンプレート

テンプレートは拡張機能のポップアップから編集できます。`[推文内容]` というプレースホルダーは、元の投稿のテキストに置き換えられます。テンプレートにこのプレースホルダーがない場合は、元のテキストが自動的に先頭へ追加されます。

---

## コンテンツフィルター

X の投稿の返信欄にあるスパム・アダルト・Telegram 誘導などを、段階的に絞り込んで非表示にします。**判定はすべてローカルで行われ、投稿の内容がアップロードされることはありません。**

- 強度は 3 段階：**軽め / 標準 / 強め**（ポップアップ上の名称）
- ルールの重大度は 4 種類：`block` / `high` / `medium` / `low`
  - 軽め：`block` のみ
  - 標準：`high` と `block`
  - 強め：`medium`、`high`、`block`
- ホワイトリスト（フォロー中のユーザー / ハンドル / ドメイン）と、ハンドルのブラックリストに対応
- カスタムルールの種類：`keyword` / `regex` / `domain` / `short-symbol`
- 非表示になった返信は、メインの投稿の下で「{N} 件の返信をフィルターしました - XVM」というパネルに折りたたまれ、展開して確認できます

### リモートルールの自動更新

リモートルールは、本家リポジトリの `src/premium/content-filter/rules.json` が配信元です。同梱ルール（`bootstrap-rules.json` から生成）は、リモートルールを取得できるまでの最小限の初期値です。拡張機能は次のように動作します。

1. **コールドスタート時**は、拡張機能に同梱された最小限のルール（`rules.js`）を使います。これは常に利用できます。なお、同梱ルールは `rules.json` の複製ではなく、別ファイルの `bootstrap-rules.json` から `npm run sync:rules` で生成されます。
2. バックグラウンドで `raw.githubusercontent.com` から最新の `rules.json` を取得します（キャッシュの有効期間は 6 時間で、`chrome.storage.local` に保存されます。取得に失敗した場合も、再試行は最短 5 分間隔です）。
3. 取得に成功すると、拡張機能を再読み込みしなくても、ルールが**その場で差し替わります**。
4. ポップアップの「フィルター」タブには、現在のルールの取得元と最終更新時刻が表示されます。**「今すぐ更新を確認」**で手動更新もできます。

```
[GitHub raw rules.json]
   ↓ fetch (6h TTL, cached in chrome.storage)
[XVM_CONTENT_FILTER_RULES_UPDATE postMessage]
   ↓
[filter.js 差し替え + 再分類]
```

> **このフォークでのルールの取得元について**
>
> 現在のコードでは、ルールの取得元は本家リポジトリ（`Icy-Cat/x-viral-monitor` の `main` ブランチ）に固定されています。このフォークで `rules.json` を変更しても、フォークのビルドには反映されません。新しいスパムのパターンを見つけた場合の提案は、本家のリポジトリへ送ってください。

---

## インストール

### Chrome / Edge 拡張機能（推奨）

**Chrome ウェブストア（公式配布版）：**
[X Viral Monitor をインストール](https://chromewebstore.google.com/detail/x-viral-monitor/dkplofpecmjmbhgjgleeflcnfgfkdfpd)

**手動でインストールする（本家のリリース版 ZIP）：**

> 以下の ZIP は**本家**が公開しているビルドで、このフォークの日本語修正は含まれません。日本語修正を含む版を使う場合は、次の「このフォークのソースからビルドして読み込む」を参照してください。

1. [本家の Releases](https://github.com/Icy-Cat/x-viral-monitor/releases) ページから、最新版の zip をダウンロードします
2. zip を展開します
3. Chrome を開き、`chrome://extensions/` にアクセスします
4. 右上の**デベロッパーモード**をオンにします
5. 左上の**パッケージ化されていない拡張機能を読み込む**をクリックします
6. 展開したフォルダーを選択します

**このフォークのソースからビルドして読み込む（日本語修正を含む版）：**

このフォークの日本語修正は `ja-fix` ブランチにあります。`--branch ja-fix` を指定して取得してください。

```bash
git clone --branch ja-fix https://github.com/sysCat64/x-viral-monitor-syscat.git
cd x-viral-monitor-syscat
npm install
npm run build:community   # Community DEV ビルドを dist/ に出力
```

その後、手順 3〜5 と同様に `chrome://extensions/` で **`dist/` フォルダー**を選択して読み込みます。

> Community DEV ビルドでは、Pro 機能がローカルですべて有効になります。公式版のライセンス認証・自動更新・サポートの対象ではありません。

### Tampermonkey ユーザースクリプト（デスクトップ軽量版）

バッジとランキングだけで十分で、Pro 機能は不要という方には、単体のユーザースクリプトがあります。

1. ブラウザ拡張機能の [Tampermonkey](https://www.tampermonkey.net/) をインストールします
2. [`userscript/x-viral-monitor.user.js`](userscript/x-viral-monitor.user.js) を開き、「Raw」をクリックしてインストールします
3. Tampermonkey のメニューから設定パネルを開きます

### Android — Quetta + ユーザースクリプト

Android 版の Chrome は拡張機能に対応していませんが、[**Quetta**](https://quetta.net/) ブラウザは Tampermonkey に標準で対応しています。

1. Play ストアまたは公式サイトから Quetta アプリをダウンロードします
2. Quetta の中で Tampermonkey をインストールします
3. [`userscript/x-viral-monitor.mobile.user.js`](userscript/x-viral-monitor.mobile.user.js)（モバイル版。DOM フォールバックが有効です）をインストールします

### iOS Safari — Userscripts アプリ

iOS の Safari では、[**Userscripts**](https://apps.apple.com/app/userscripts/id1463298887)（無料のオープンソースアプリ）を使います。

1. App Store で、Justin Wasack 作の「Userscripts」を検索してインストールします
2. 「設定」→「Safari」→「機能拡張」で Userscripts を有効にします
3. Userscripts アプリで [`userscript/x-viral-monitor.mobile.user.js`](userscript/x-viral-monitor.mobile.user.js) を追加します
4. x.com を開き、Safari のアドレスバー左下の ⓂA メニュー →「Userscripts」→ スクリプトを有効にします

> モバイル版のユーザースクリプトは、画面が小さいため、初期設定ではフローティングのランキングパネルを表示せず、バッジのみを表示します。

> ユーザースクリプト版は、バッジとランキングを中心とした軽量版です。コンテンツフィルター、インプレッション速度フィルター、AI返信候補、Proライセンスなどは、Chrome 拡張機能版の機能です。

---

## 仕組み

拡張機能は、X のフロントエンドが使う `fetch` / `XMLHttpRequest` をフックして GraphQL API のレスポンスを途中で取得（インターセプト）し、各投稿の指標（表示回数・いいね・リポスト・返信・ブックマーク・投稿日時）を取り出します。そこから平均速度（`総表示回数 ÷ 投稿からの経過時間（時間）`）を計算し、投稿のアクションボタンの横にインラインのラベルとして描画します。

最初のインターセプトで取得できなかった投稿は、TweetDetail API で 1 件ずつ補完します。

コンテンツフィルターも同じ GraphQL レスポンスの取得経路で動きます。`TweetDetail` や `HomeTimeline` などのレスポンスから、各返信の投稿者と本文のフィールドを取り出し、ローカルのルールと照合します。**サーバーとのやり取りはありません。**

ユーザースクリプト版や iOS のモバイル版は、ネットワークをフックできない場合に DOM フォールバックを使い、article ノードから見えている項目を直接取り出します。精度はやや下がりますが、バッジは確実に表示されます。

---

## 謝辞

「サンクス・スターチャート」機能は、[London-Chen/Thank-you-star-chart](https://github.com/London-Chen/Thank-you-star-chart)（MIT ライセンス）を改作したものです。軌道アニメーションの数式、サイドパネルのレイアウト、配色は、このプロジェクトから移植しています。

また、本プロジェクトのオリジナルは [Icy-Cat/x-viral-monitor](https://github.com/Icy-Cat/x-viral-monitor) です。

---

## プロジェクト構成

```
├── _locales/                  # 多言語対応（en / zh_CN / ja）
├── icons/                     # 拡張機能のアイコン
├── lib/                       # ランタイムライブラリ
│   ├── x-net-hook.js          # fetch/XHR のフック（レスポンス取得）
│   ├── grok-reply.js          # AI返信候補（Grok）
│   ├── image-viewer.js        # 強化版の画像ビューア（拡大縮小・移動）
│   └── long-image-viewer.js   # 縦長画像の閲覧モード
├── src/premium/               # Pro のゲート + 高度な機能
│   ├── license/               # トライアル / 認証 / ティアの振り分け
│   ├── content-filter/        # コンテンツフィルター（無料、リモートルール）
│   └── rate-filter/           # インプレッション速度フィルター（Pro）
├── userscript/                # ユーザースクリプト（デスクトップ + モバイル + デバッグ）
├── scripts/                   # ビルド / 同期スクリプト
├── tests/                     # vitest のテスト
├── background.js              # サービスワーカー（AI プロバイダー呼び出しなど）
├── bridge.js                  # 拡張機能 ↔ ページ間の通信ブリッジ
├── content.js                 # メインのコンテンツスクリプト（MAIN world）
├── popup.html / popup.js      # 拡張機能ポップアップの設定画面
├── starchart.js               # サンクス・スターチャートのモジュール
├── styles.css                 # ページに注入するスタイル
└── manifest.json              # Chrome 拡張機能のマニフェスト
```

---

## 開発

```bash
npm install
npm test                # vitest run
npm run build:community # 同梱ルールを生成し、Community DEV ビルドを dist/ に出力
npm run build:dist      # 同梱ルールを生成し、store チャンネルのビルドを dist/ に出力
npm run sync:rules      # bootstrap-rules.json から rules.js を生成するのみ
```

- `build:community`：Pro 機能がローカルですべて有効になる Community DEV ビルドを `dist/` に出力します。開発や動作確認向けです。
- `build:dist`（`build:store` と同じ）：公式配布版と同じ `store` チャンネルのビルドを `dist/` に出力します。Pro 機能は、ライセンスまたはトライアルがなければ使えません。
- `package:community` / `package:store` / `package:edge`：ビルドに続けて zip を作成します。

`dist/` は、`chrome://extensions/` の「パッケージ化されていない拡張機能を読み込む」で指定するフォルダーです。ソースを変更したらビルドコマンドを実行し、拡張機能のページで 🔄 をクリックして再読み込みしてください。

---

## ライセンス

MIT。詳しくは [LICENSE](LICENSE) を参照してください。

本プロジェクトは、オリジナルの [Icy-Cat/x-viral-monitor](https://github.com/Icy-Cat/x-viral-monitor) から派生したフォークです。
