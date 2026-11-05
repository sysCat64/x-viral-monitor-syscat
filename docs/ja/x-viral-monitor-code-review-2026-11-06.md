# X Viral Monitor — Phase 1：全体静的コードレビュー

- 記録日：2026-11-06
- 対象：`sysCat64/x-viral-monitor-syscat`
- フェーズ：**Phase 1：全体静的コードレビュー**
- 状態：**調査結果の記録。修正未着手。**
- 出典：直前に報告したレビュー結果（A〜G）の保存版。

> 本書の「確認済み」は、各項目に記したメモリ内検証の範囲を意味する。Chrome実機、実アカウント、現在のXサーバーでの再現を確認したものではない。本書保存に伴う追加検証や修正は実施していない。
>
> 本文中の「開始時・終了時」「報告時点」のGit状態は、Phase 1レビュー実施時点（本書の新規保存前）の記録である。ソースの行番号と本家比較も、そのレビュー時点のHEAD・比較コミットを基準とする。

**新規候補10件と、仕様確認事項1件**を整理しました。コード・テスト・ドキュメントの変更、Gitの更新操作、実アカウントへの操作は行っていません。

## A. 総括

| 項目 | 結果 |
|---|---|
| ブランチ | `ja-fix` |
| HEAD | `1293334c4322a46e8763400b1199c866fa532542` |
| 作業ツリー | 開始時・終了時ともクリーン |
| 対象 | 実行時JavaScript 26ファイル、`manifest.json`、`package.json`、`popup.html` |
| 補助確認 | `docs/ja/`の既知課題2文書、Vitest設定、関連テスト |
| 新規候補 | 10件：P1＝5件、P2＝5件 |
| 確度 | 確認済み6件、有力候補4件 |
| 別枠 | 同名フォルダー：INFO／要調査 |
| 実行検証 | 実ソース・抽出処理を用いたNode VM内検証。実通信・永続保存なし |
| 構文確認 | 実行時JavaScript 26ファイルすべて解析成功 |
| 既存テスト | 39ファイルの構成を確認。テストスイート全体は未実行 |

「確認済み」は以下に記載したメモリ内の再現範囲を意味します。Chrome実機や現在のXサーバーでの再現確認とは区別しています。

主要な実行経路は次のとおりです。

- **ISOLATED world**：`build-channel → bookmark-timeline-storage → bridge → tier-logic → entitlement → isolated`。設定・保存・ライセンス・一部X API通信を担当。
- **MAIN world**：`build-channel → x-net-hook → x-client-transaction → grok-reply → long-image-viewer → image-viewer → bookmark-timeline-inject → timeline-ad-prune → gate → rules → content-filter → rate-filter → content → starchart → bookmark-menu`。
- **外部AI**：MAINの返信UI → `postMessage` → `bridge` → Runtimeメッセージ → `background` → AIサービス。
- **Grok**：MAINの返信UI → `grok-reply` → `x-client-transaction`／捕捉済み署名 → Grok。
- **Popup**：ビルド識別・ライセンス共通処理 → Pro UI → 各フィルターUI → `popup.js` → `popup-dashboard.js`。

通信境界、フィルター間の状態管理、ブックマークの非同期処理、AI生成、ライセンス情報の公開範囲を重点確認しました。

本家比較は、ローカルに存在する `upstream/main` の **`b1b896de5079d672afc9d829beef01c51a0b970c`（Release v1.18.17）**が対象です。最新版で修正済みかどうかは未確認です。

## B. 不具合候補一覧

| ID | 重要度 | 確度 | ファイル・行番号 | 問題概要 | 発生条件 | 本家にも存在 |
|---|---|---|---|---|---|---|
| R01 | P1 | 確認済み | `content-filter/filter.js:197` | フィルターがページへ返すResponse本文を消費 | 対象GraphQLをfetchで取得 | 本家にも存在 |
| R02 | P1 | 確認済み | `license/isolated.js:308–334` | ページからライセンスキー取得・無効化要求が可能 | 対象ページ上でスクリプトが実行される | 本家にも存在 |
| R03 | P1 | 確認済み | `bridge.js:1560` | 未承認のページメッセージから外部AI生成を起動可能 | 外部AIを設定済み、同一ページスクリプトが要求 | 本家にも存在 |
| R04 | P1 | 確認済み | `content-filter/filter.js:499,543` | 両フィルター解除後も投稿が非表示のまま | 両方が同じ投稿を隠し、コンテンツ側を先に解除 | 本家にも存在 |
| R05 | P1 | 確認済み | `grok-reply.js:193`、`content.js:4602` | Grokで候補数設定が反映されない | 候補数を10以外に設定 | 本家にも存在 |
| R06 | P2 | 確認済み | `bookmark-timeline-inject.js:89–95` | 複数フォルダー由来の同一投稿を二重挿入 | 選択キャッシュ間で投稿IDが重複 | 本家にも存在 |
| R07 | P2 | 有力候補 | `bookmark-menu.js:135–139,284–315` | 遅い所属取得応答が追加・削除後の状態を上書き | hover取得とクリック時の再取得・更新が交差 | 本家にも存在 |
| R08 | P2 | 有力候補 | `grok-reply.js:263–313` | Grokの停止した通信をタイムアウト・即時中止できない | 応答開始前／ストリーム途中で通信が停止 | 本家にも存在 |
| R09 | P2 | 有力候補 | `starchart.js:1320–1327,471` | 閉じたスターチャートのタイマーが残る | チャートを開閉 | 本家にも存在 |
| R10 | P2 | 有力候補 | `starchart.js:928,1025–1100,1377` | 閉じても通信・レート制限待ちが止まらず再表示を妨げる | 通信中または429待機中に閉じる | 本家にも存在 |

本家との一致は、同一ファイルまたは該当関数ブロックと関連差分で確認しています。今回の候補について、日本語化による新規導入は確認していません。

## C. 個別の詳細

### R01：ネットワーク応答本文の消費

対象：[content-filter/filter.js:197](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/src/premium/content-filter/filter.js#L197)、[x-net-hook.js:205](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/lib/x-net-hook.js#L205)

```js
data = typeof response?.json === 'function'
  ? await response.json()
  : response?.json;
```

- **流れ・条件**：通信フックは購読先へ通知したResponseを、そのままfetch呼び出し元へ返します。コンテンツフィルターは複製せず本文を読みます。購読自体は設定OFFでも登録されます。
- **影響**：X本体の`response.json()`が失敗します。また、後続の速度フィルターや`content.js`の`clone()`も失敗し得ます。対象はHome、List、UserTweets、TweetDetail等です。
- **検証**：実際の`x-net-hook.js`とフィルターを同じVMで起動し、設定が既定のOFFのままHomeTimelineを模擬fetch。呼び出し元で `TypeError: Body is unusable: Body has already been read` を再現しました。
- **既存防御・テスト**：履歴用cloneはありますが、ライブ通知用ではありません。`x-net-hook-replay.test.js`の通常応答モックは繰り返し読めるため、この単回消費を再現しません。フィルターテストも実フックとの結合を検証していません。
- **成立しない条件・留保**：XHR側の再解析可能なラッパー、対象外URLには同じ問題は成立しません。実際のXでfetch経路が占める範囲は未測定です。
- **最小修正方針**：fetch応答を読む購読先でcloneを使用し、実Responseによる結合テストを追加する。

### R02：ライセンスの秘密情報と操作をMAIN worldへ公開

対象：[isolated.js:308](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/src/premium/license/isolated.js#L308)

説明用コード（省略・再構成あり。実コードの正確な引用ではありません）：

```js
if (t === 'XVM_LICENSE_STATUS_REQUEST') {
  // ...
  window.postMessage({
    type: 'XVM_LICENSE_STATUS',
    record: lic.record,
    // ...
  }, '*');
}
```

- **流れ・条件**：同じwindowから状態要求を送ると、保存レコードをそのまま返信します。レコードには`key`、`instanceId`等が入ります。同じ受信口には`XVM_LICENSE_DEACTIVATE`もあります。
- **影響**：対象ページで動作するスクリプトがライセンスキーを取得できます。また、利用者のPopup操作なしに無効化処理を要求できます。
- **検証**：実`isolated.js`に合成レコードとメモリ内storageを渡し、状態要求に対して合成キーがページ向けメッセージへ出ることを確認しました。実キーや無効化APIは使用していません。
- **既存防御・テスト**：署名検証・商品ID検証は存在しますが、この情報公開を防ぎません。`premium-license-slice.test.js`は契約・秘密鍵不在等を検査し、ページからの秘密情報取得を否定するテストは確認できませんでした。
- **成立しない条件・留保**：ライセンス未保存なら漏れるキーはありません。任意の別サイトから直接呼べるという指摘ではなく、対象Xページ上のスクリプトが信頼境界です。
- **最小修正方針**：MAINへ返す情報をtier等の必要最小限に限定。ライセンス管理操作は拡張機能内部の通信へ移す。

### R03：ページから保存済み資格情報を使ったAI要求を起動可能

対象：[bridge.js:1560](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/bridge.js#L1560)、[background.js:470](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/background.js#L470)

説明用コード（省略・再構成あり。実コードの正確な引用ではありません）：

```js
if (type === 'XVM_AI_GENERATE'
    && typeof event.data.requestId === 'string') {
  chrome.runtime.sendMessage({
    type: 'XVM_AI_GENERATE',
    requestId,
    payload: event.data.payload || {},
  }, ...);
}
```

- **流れ・条件**：同一window・同一originの要求をbridgeが転送し、backgroundが保存済みプロバイダー設定・APIキーを読み出して生成します。
- **影響**：対象ページのスクリプトが任意のプロンプトで有料APIやローカルAIを利用できます。結果もページへ返信されます。
- **検証**：実受信分岐へ未登録の`requestId`を渡し、Runtimeへの転送を確認しました。外部AIへの通信は行っていません。
- **既存防御・テスト**：URL許可リストは送信先を制限しますが、起動の承認を検証しません。`aiPendingRequests`は結果受信側の管理で、要求転送を防ぎません。`ai-message-hardening.test.js`はsource・origin等の文字列検査です。
- **成立しない条件・留保**：Grok設定の場合、backgroundの外部生成経路は拒否します。APIキーそのものを返す経路がある、という指摘ではありません。
- **最小修正方針**：特権的なAI起動に拡張機能側で管理する承認境界を設ける。MAINから見えるrequestIdやnonceだけでは、ページスクリプトの認証にはなりません。

### R04：フィルター解除後に残るインライン非表示

対象：[content-filter/filter.js:499](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/src/premium/content-filter/filter.js#L499)、[rate-filter/filter.js:350](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/src/premium/rate-filter/filter.js#L350)

説明用コード（省略・再構成あり。実コードの正確な引用ではありません）：

```js
cell.style.display = 'none';
// 解除時
if (cell?.style && !hasOtherXvmHideMarker(art, cell))
  cell.style.display = '';
```

- **再現順序**：同じ返信を両フィルターで隠す → コンテンツフィルターをOFF → 速度フィルターをOFF。
- **原因・影響**：最初の解除では速度マーカーがあるためインラインstyleを残します。その後、速度側はCSSのroot属性・マーカーを操作するだけで、残った`display:none`を消しません。
- **検証**：既存DOMハーネスと実フィルターで、コンテンツマーカーも速度マーカーも除去済みなのに`display === 'none'`が残ることを確認しました。
- **既存テスト**：`premium-content-filter.test.js`に単独OFFでの復旧テストはありますが、両フィルターの解除順序は含まれていません。
- **成立しない条件・留保**：コンテンツフィルター単独の場合は復旧します。DOMの再マウントでも見かけ上解消し得ます。
- **最小修正方針**：非表示の所有権を属性／CSSへ統一するか、各解除時に両機能の有効状態から表示を再計算する。

### R05：Grokが候補数設定を使用しない

対象：[content.js:4602](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/content.js#L4602)、[grok-reply.js:193](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/lib/grok-reply.js#L193)

説明用コード（省略・再構成あり。実コードの正確な引用ではありません）：

```js
const dedupe = (...) => ...slice(0, 10);
```

- **流れ・条件**：Popupは候補数1～20を保存し、MAINも読みます。しかしGrokの`generate()`呼び出しには候補数を渡さず、解析上限は10固定です。
- **影響**：20を選んでも最大10。1を選んでも複数候補を表示し得ます。
- **検証**：実パーサーに15個の独立したコードブロックを渡し、10件になることを確認しました。
- **既存防御・テスト**：外部AI側には候補数の正規化・上限制御があります。Grok側の既存テストは固定上限の挙動を扱い、Popup設定との一致は検証していません。
- **成立しない条件・留保**：10件設定では上限の不一致はありません。モデルが指定件数を必ず生成するとは限らない問題とは別です。
- **最小修正方針**：Grokにも候補数を渡し、プロンプト・途中結果・最終解析で共通利用する。

### R06：フォルダーをまたぐ重複投稿の挿入

対象：[bookmark-timeline-inject.js:89](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/lib/bookmark-timeline-inject.js#L89)

```js
return id && !existingIds.has(id) && !excludedIds.has(String(id));
```

- **流れ・条件**：複数フォルダーの候補を連結しますが、比較対象は元のHome応答と既読IDだけです。追加候補同士の重複を取り除きません。
- **影響**：同じ投稿が別の`entryId`を持って同一Home応答へ複数回挿入されます。
- **検証**：2つのキャッシュに投稿99を置き、Home10件・間隔5で実ヘルパーを実行。投稿99が2件挿入されました。
- **既存防御・テスト**：フォルダー内のキャッシュ重複排除、元Homeとの重複排除、既読排除はあります。`bookmark-timeline-inject.test.js`に選択フォルダー間の重複ケースは確認できませんでした。
- **成立しない条件・留保**：キャッシュ間でIDが一意なら発生しません。現在のXが同時所属を許すかは未検証ですが、フォルダー移動後の古いキャッシュと新しいキャッシュの重なりでも成立します。
- **最小修正方針**：全追加候補を投稿IDで一意化してから配置する。

### R07：古い所属取得による更新状態の上書き

対象：[bookmark-menu.js:135](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/bookmark-menu.js#L135)

説明用コード（省略・再構成あり。実コードの正確な引用ではありません）：

```js
const ids = new Set(...);
setContains(tweetId, ids);
```

- **具体的順序**：hoverで所属取得Aを開始 → 結果未到着のままクリックし取得B → B完了後に追加／削除成功 → Aが旧状態で到着。
- **原因・影響**：`fetchContains()`は世代確認なしでキャッシュを置換します。更新後の所属表示が戻り、次のクリックで逆の操作を選ぶ可能性があります。
- **既存防御・テスト**：更新後に最新Setを読み直す処理はありますが、「更新完了後に到着する取得応答」には効きません。30秒TTLと`currentTweetId`確認も書き込み順序を保護しません。関連テストは主に静的な接続確認です。
- **検証方法**：2本のGET応答とmutation完了を個別に遅延できるモックで、上記順序を固定する。
- **成立しない条件・留保**：取得が直列、またはAがmutation前に完了すれば成立しません。今回、この競合自体の実行再現は未実施です。
- **最小修正方針**：投稿単位の取得共有と世代管理を行い、mutation以前の取得結果を破棄する。

### R08：停止したGrok要求から復帰できない

対象：[grok-reply.js:263](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/lib/grok-reply.js#L263)、[content.js:4621](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/content.js#L4621)

- **根拠**：GrokのfetchにAbortSignal・生成タイムアウトがありません。`reader.read()`にも上限がありません。
- **流れ・影響**：通信が停止すると`generate()`が完了せず、UI側の`finally`に到達しないため生成ボタンのbusy状態が残ります。
- **既存防御**：パネルを閉じるとepochは更新されます。しかしキャンセル判定は次の解析済み候補が到着して`onProgress`を呼べた時だけです。無通信状態では動きません。署名初期化のホーム取得タイムアウトも生成通信を覆いません。
- **既存テスト**：`grok-reply.test.js`に`onProgress=false`での読取中止はありますが、永久pendingのread／fetchは確認できませんでした。
- **検証方法・留保**：未解決Promiseを返すfetch/readで閉じる操作を試す。通常完了・通常エラーでは復帰します。今回は静的経路確認です。
- **最小修正方針**：生成全体をAbortControllerで管理し、閉じる操作とタイムアウトから中止する。

### R09：スターチャートの自動送りタイマーが解放されない

対象：[starchart.js:1320](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/starchart.js#L1320)、[starchart.js:471](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/starchart.js#L471)

- **根拠・流れ**：`setupRiver()`はローカル変数に`setInterval()`を保持します。返すAPIには破棄処理がなく、`closeOverlay()`もこのintervalを解除しません。
- **影響**：閉じたDOM・引用データをタイマーのクロージャーが保持します。開閉ごとに残存し、引用がある場合は切断済みDOMへの描画も続きます。
- **既存防御・テスト**：canvas rendererのdestroyは別系統です。`startAuto()`内のclearは同じRiverの再始動にしか作用しません。開閉後のタイマー残数を検証するテストは確認できませんでした。
- **検証方法・留保**：fake timerで開閉前後のinterval数を比較する。引用0件でもタイマー自体は作成されます。実メモリ増加量は未測定です。
- **最小修正方針**：Riverにdestroyを持たせ、overlay終了時に呼ぶ。

### R10：チャートを閉じても進行中処理が止まらない

対象：[starchart.js:928](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/starchart.js#L928)、[starchart.js:1025](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/starchart.js#L1025)

- **根拠**：ページング関数は`signal.aborted`をループ先頭で確認しますが、`callGraphQL()`のfetchへsignalを渡しません。429待機も通常の`setTimeout()`です。
- **具体的条件**：429を受けて待機中、またはfetch未完了の状態でチャートを閉じ、その直後に開き直す。
- **影響**：`activeAbort.abort()`しても進行中処理は止まりません。元の`openStarChart()`が終了するまで`openInFlight`がtrueなので、新しい表示が拒否されます。429のreset情報がない場合、待機は60秒です。
- **既存防御・テスト**：次のループは中断しますが、待機・fetchを即時終了しません。中止から再表示までの結合テストは確認できませんでした。
- **検証方法・留保**：429＋fake timer、または未完了fetchでclose→openを試す。取得完了後に閉じる場合は成立しません。
- **最小修正方針**：fetchと待機にsignalを伝播し、終了処理をその表示セッションに結び付ける。

## D. セキュリティ関連

優先度が高いのは **R02とR03** です。

`event.source === window`やorigin確認は、同じXページで動くスクリプトを拡張機能自身から識別しません。特にR02では、ISOLATED内に置いたライセンスキーを通信でMAINへ戻してしまっています。

一方、次の防御は確認しました。

- 外部AIのAPIキーはbackgroundがstorageから取得し、通常の設定通知には含めない。
- 外部AIの送信先には許可リストがある。
- entitlementにはECDSA署名・商品・インスタンス・キー対応の確認がある。
- AI候補本文は`textContent`で描画する。
- Grok署名用のHTMLからはSVG形状を選別して再構築し、そのままHTMLを挿入しない。
- manifestの通常権限は`storage`。広い`tabs`権限等は要求していない。

これらを理由に、ページメッセージ経由の特権操作まで安全と判定することはできません。

## E. 既知の課題・仕様確認事項

既知のi18n残存10項目・要確認2項目、言語切替時のDOM更新制約、フォルダー名変更・削除未実装は、新規10件に含めていません。

### I01：同名フォルダーの作成後検索 — INFO／要調査

対象：[bookmark-menu.js:337](https://github.com/sysCat64/x-viral-monitor-syscat/blob/1293334c4322a46e8763400b1199c866fa532542/bookmark-menu.js#L337)

説明用コード（省略・再構成あり。実コードの正確な引用ではありません）：

```js
await gql('createBookmarkFolder', 'POST', { name });
const fresh = await fetchFoldersDirect();
const created = fresh.find((f) => f.name === name);
```

作成応答のIDを使用せず、再取得一覧の最初の同名項目を選びます。

- **成立条件**：Xが同名作成を許し、再取得一覧で既存同名フォルダーが先に並ぶ。この場合、既存側へ投稿を追加します。
- **成立しない条件**：同名作成がエラーになれば、`gql()`が例外化して追加処理へ進みません。同名が一意なら検索上の曖昧さはありません。
- **確認結果**：確認した[X公式のPremium操作説明](https://help.x.com/en/using-x/x-premium-how-to)では、同名作成の許可／禁止や一覧順序を確定できませんでした。実アカウントでの作成は行っていません。
- **テスト**：`bookmark-folder-menu.test.js`にこの条件の動作検証はありません。
- **方針**：Phase 2でAPI仕様または許可された実機試験を先に確認。作成応答にIDがあるなら、そのIDを利用する方針が最小です。

本家の同一コードにも存在しますが、**現時点では不具合と断定していません。**

## F. レビュー網羅性

「実施」は主要経路の静的確認を意味し、全分岐を実行した意味ではありません。

| ファイル | 確認した主要処理 | 静的レビュー | 次の深掘り | 関連ID |
|---|---|---|---|---|
| `manifest.json` | 権限、world、読込順 | 実施 | 実機の通信方式 | R01 |
| `package.json` | scripts、依存、テスト起動 | 実施 | 今回の追加事項なし | — |
| `background.js` | AI設定、URL検証、ストリーム、Runtime | 実施 | ページ起点要求の結合検証 | R03 |
| `bridge.js` | storage、設定通知、AI転送、フォルダー取得 | 実施 | 複数タブ・アカウント切替 | R03、R07 |
| `src/build-channel.js` | store／community識別 | 実施 | 配布物別の状態確認 | — |
| `lib/x-net-hook.js` | fetch/XHR、patch、replay | 実施 | Chrome実Response結合 | R01 |
| `lib/x-client-transaction.js` | 初期化共有、署名生成、reset | 実施 | 現行X bundleとの互換性 | R08 |
| `content.js` | 投稿抽出、ブックマーク挿入、UI、AI epoch、SPA処理 | 実施・主要経路中心 | DOM再利用、スクロール復元の実機確認 | R01、R05、R06、R08 |
| `starchart.js` | 取得、ページング、overlay、終了処理 | 実施・描画計算は浅い確認 | timer／abort試験 | R09、R10 |
| `lib/image-viewer.js` | 対象画像、ズーム、解除、イベント | 実施 | カルーセル遷移 | — |
| `lib/long-image-viewer.js` | 長画像判定、observer、再試行 | 実施 | 画像読込と遷移の交差 | — |
| `lib/timeline-ad-prune.js` | 広告判定、配列削除、対象API | 実施 | 現行API応答との対応 | — |
| `bookmark-menu.js` | 所属取得、作成、追加・削除、hover | 実施 | 応答順序、同名仕様 | R07、I01 |
| `lib/bookmark-timeline-inject.js` | キャッシュ、候補選択、重複排除 | 実施 | 複数フォルダーの実データ | R06 |
| `lib/bookmark-timeline-storage.js` | アカウントscope、容量・件数・TTL | 実施 | 複数タブ保存競合 | — |
| `rate-filter/filter.js` | 境界値、OR判定、scope、非表示解除 | 実施 | 両フィルター結合 | R01、R04 |
| `rate-filter/popup-rate-filter.js` | 正規化、保存、tierロック | 実施 | Popup終了直前の保存 | — |
| `content-filter/rules.js` | 組込ルール、severity、形式 | 実施 | 現行リモートルール | — |
| `content-filter/filter.js` | 応答購読、分類、DOM fallback、復旧 | 実施 | Chrome結合 | R01、R04 |
| `content-filter/popup-content-filter.js` | ルール入力、保存、リモート更新 | 実施 | 異常ルール・保存競合 | — |
| `lib/grok-reply.js` | 署名fallback、HTTP、NDJSON、候補解析 | 実施 | 停止ストリーム | R05、R08 |
| `popup.html` | 入力制約、操作要素、script順 | 実施 | 実UI結合 | R05 |
| `popup.js` | 設定復元、AI保存・切替、候補数 | 実施 | プロバイダー変更中の応答 | R05 |
| `popup-dashboard.js` | タブ・テーマ・tier表示 | 実施 | 初期読込中の操作競合 | — |
| `license/tier-logic.js` | 試用、cache、offline grace | 実施 | 時刻境界の実運用 | — |
| `license/entitlement.js` | 署名、期限、商品・キー対応 | 実施 | 不正形式の結合処理 | — |
| `license/gate.js` | tier通知、機能判定、購読 | 実施 | 改変耐性の設計境界 | R02 |
| `license/isolated.js` | license操作、公開情報、更新 | 実施 | ページ境界・更新競合 | R02 |
| `license/popup-pro.js` | 有効化、再検証、表示、保存 | 実施 | 操作と再検証の競合 | R02 |

未確認なのは、Chrome実機、現在のX内部API仕様、実サービスの障害応答、配布済みビルド、本家の比較コミット以降です。userscript版、Worker側実装、サイト、ビルドスクリプト全体は今回の拡張機能レビュー対象外です。

指定主要ファイルに未着手のものはありませんが、上表の「次の深掘り」は未検証として残しています。

## G. Phase 2への引き継ぎ

1. **R01を最優先でChrome検証**  
   設定OFFでも成立し、X本体の通信と複数機能へ波及するためです。fetch／XHRを分けて確認してください。

2. **R02・R03の通信境界を結合検証**  
   合成ライセンス・モックAIで十分です。秘密情報の取得と、ユーザー操作なしの特権要求をそれぞれ検証してください。

3. **R04・R05・R06を回帰条件として固定**  
   今回メモリ内で再現済みです。解除順序、候補数1／10／20、フォルダー間重複を含めます。

4. **R07～R10を遅延応答・fake timerで検証**  
   応答順序、停止ストリーム、開閉後のinterval数、429待機中の再表示を固定すれば、実アカウントなしで大部分を確認できます。

5. **I01は仕様確認を先行**  
   同名禁止なら「既存同名を選ぶ」という経路は成立しません。前提を確定するまで修正対象へ昇格させない扱いが妥当です。

報告時点でもHEAD・作業ツリーは変更していません。修正には着手せず、ここで停止します。
