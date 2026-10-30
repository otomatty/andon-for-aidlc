# リリースと upstream 同期（メンテナ向け）

このリポジトリの GitHub Actions の挙動をまとめたものです。利用者側の手順は
[README](../../README.md) を参照してください。

## リリース（CI/CD）

`main` にマージすると [`.github/workflows/release.yml`](../../.github/workflows/release.yml) が走り、VSIX をビルドして GitHub Releases に添付します。手動作業はありません。VSIX の隣には、その VSIX が対応する aidlc-workflows のバージョンを記録した `andon-for-aidlc-release.json`（`scripts/release-metadata.ts` が生成）も添付します。拡張の更新確認はこのファイルを読み、対応版が変わる場合は「更新後はプロジェクトの更新が必要」と先に知らせます（[バージョン確認の設計](version-gate-design.md)）。

**`main` へのマージは既定でリリースされます。** [`.github/workflows/bump-extension-version.yml`](../../.github/workflows/bump-extension-version.yml) がマージ後にバージョンを上げ、そのコミットから Release を出します。ラベルは「リリースするかどうか」ではなく**上げ幅**を選ぶものです。

| ラベル                 | 例（いま `0.2.0`）       |
| ---------------------- | ------------------------ |
| `release:major`        | `1.0.0`                  |
| `release:minor`        | `0.3.0`                  |
| `release:patch`        | `0.2.1`                  |
| **ラベル無し（既定）** | `0.2.1`（= patch）       |
| `release:skip`         | 据え置き。リリースしない |

ラベルを付け忘れたマージは patch として出荷されます。リリースしたくないマージ（ドキュメントの誤字、CI だけの変更など）は `release:skip` を明示的に付けてください。上げ幅のラベルは 1 つだけにしてください。2 つ付いている場合や `release:skip` と併用した場合は、推測せず失敗します。

`release:minor` と `release:major` の PR は、[更新情報](#更新情報を書く)の項目を追加していないとマージ前に `release-labels` が失敗します。

PR 内で `version` を既に上げている場合は、ラベルの有無にかかわらず二重に上げません（従来の手動 bump もそのまま使えます）。ただし `release:skip` は**自動 bump だけ**を止めるものです。手で書いたバージョンは `release.yml` がマニフェストの値だけを見て出荷するため、ラベルでは止まりません。そのため両方を指定した PR は矛盾として[`release-labels.yml`](../../.github/workflows/release-labels.yml) が**マージ前に**落とします（マージ後に気づいても Release は既に出ているため）。同じ判定をマージ後のゲートも走らせます — 判定関数は 1 つで、PR 上と push 上の両方から呼ばれます。

`release-labels` は**required status check に設定して初めてマージを実際に止められます**（設定画面で選ぶチェック名も `release-labels`）。設定しない場合は PR 上の赤い ✗ が出るだけです。`release.yml` 側のゲートは従来どおり**バージョン変更**です（`v<version>` タグが未作成のときだけ公開）。したがって `release:skip` のマージはタグが動かず、公開もされません。

```bash
# 任意のバージョンを手で指定するとき（自動 bump は据え置きになる）
jq '.version="0.2.1"' packages/vscode-extension/package.json > tmp && mv tmp packages/vscode-extension/package.json
# → main へマージ → タグ v0.2.1 + Release + andon-for-aidlc-0.2.1.vsix が自動生成される
```

リリースラベルの準備と main の保護は、[依存更新と品質チェック](dependency-quality.md) の手順に従ってください。main の保護を有効にする前に専用 GitHub App を設定し、実際のバージョン更新が成功することを確認します。GitHub Actions 全体へのバイパスは付与しません。

判定の基準は「**公開済み Release があるか**」です（タグの有無だけでは判定しません）。

| 挙動                   | 条件                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| リリースする           | `v<version>` タグが無い                                            |
| リリースし直す         | タグはあるが公開済み Release が無い（前回が途中で落ちた状態）      |
| 何もしない             | `v<version>` の Release が公開済み（= バージョン据え置きのマージ） |
| pre-release として出す | バージョンに `-` が含まれる（例 `0.2.0-rc.1`）                     |

ジョブは `decide`（タグ判定）→ `build`（`bun run check` + VSIX）→ `publish`（Release 作成）の 3 段です。

- 公開前に `bun run check`（単一の品質ゲート）を通します。赤ければリリースしません。
- 書込み権限は `publish` ジョブだけに付きます。`build` は `contents: read` かつ `persist-credentials: false` で、checkout もしない `publish` が artifact を受け取って公開します。自動 bump も同じ分離です。`apply` は `contents: read` で bun を走らせ、`push` は tip の version が apply 起点と同じときだけ `.version` を書き換え、lockfile は起点と一致するときだけ成果物を使います（リポジトリ上のスクリプトは実行しません）。
- **途中で失敗したら Actions から再実行してください。** `gh release create` は「下書き作成 → asset upload → 公開」の別々の API 呼出しなので中断は下書きを残します。`publish` は残骸の下書きを破棄してから作り直し、公開済みなら何もせず正常終了します。タグが残るかどうかに関係なく再実行で回復できるよう、ゲート自体が「公開済み Release の有無」を見ています。
- 手動実行（`workflow_dispatch`）は `main` 以外では失敗します。feature ブランチのバージョンが公開されるのを防ぐためです。
- 公開後に asset が実際に Release へ載っているかを検証します。載っていなければジョブは失敗します。
- 既存タグが別コミットを指している場合は公開せず失敗します（タグと VSIX の出所が食い違う Release を作らないため）。タグを打ち直すか、バージョンを上げてください。
- 排他はワークフロー全体ではなくタグ単位（`release-v0.2.0`）です。全体で 1 グループにすると、連続した version bump のうち待機中の run が後続に取り消され、そのバージョンが公開されないままになります。
- 自動 bump は、bump ワークフローがバージョンを上げたあと同じ実行から `release.yml` を呼びます。`GITHUB_TOKEN` の push は別ワークフローを起動しないためです。bump 側の排他は `queue: max` 付きです。既定の「待機 1 件」だと 3 件目のマージが 2 件目を取り消します。

## 更新情報を書く

利用者に見える変更は、同じ PR で `packages/shared-types/src/whats-new.ts` の先頭に 1 件追加します。拡張を更新した利用者には、Dashboard の「更新情報」と、再読み込み後の通知でお知らせします。

追加するかどうかは次のとおりです。

- **必須**: `release:minor` と `release:major`。新しい `id` の項目を追加していないと、`release-labels` チェックが失敗します。既存の項目の書き直しは追加に数えません。機能を複数の PR に分けたときは、上げ幅のラベルを付ける PR で追加します。
- **追加する**: patch（ラベル無しを含む）でも、利用者が気づく変更。画面・操作・表示の文言・通知が変わる場合です。
- **不要**: 内部の作り替え、テスト、依存の更新、docs や CI だけの変更。

| 項目        | 書き方                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | 英小文字・数字・ハイフンの固定 ID。公開後は変更も再利用もしません。利用者の既読記録がこの ID を参照します                                    |
| `date`      | マージ予定日（`YYYY-MM-DD`）。一覧は新しい順に並べます                                                                                       |
| `title`     | 40 文字以内。何ができるようになったかを書きます                                                                                              |
| `body`      | 200 文字以内。どの画面で何ができるかを 1〜2 文で書きます                                                                                     |
| `action`    | 任意。変わった画面を開くボタンです。`target` は `home`・`welcome`・`tour`・`docs`・`customization`・`effectiveness`・`settings` から選びます |
| `spotlight` | 任意。機能がある画面に一度だけ出す「新機能」の案内です。画面の中で気づきにくい変更に限って使います                                           |

項目にはバージョン番号を書きません。版はマージ後にラベルから自動で決まり、PR の作成時には分からないためです。項目を追加した PR は、ラベルに関係なく更新情報に表示します。項目を追加しない修正は、更新情報にも通知にも出ません。

形式は `packages/shared-types/tests/whats-new.test.ts` が `bun run check` の中で検査します。minor と major で項目を求める検査は、PR のラベルと差分を入力にするため `bun run check` ではなく [`release-labels.yml`](../../.github/workflows/release-labels.yml) がマージ前に行います。判定は `scripts/bump-extension-version.ts` の `notes` で、そのテストは `bun run check` に含まれます。patch で項目が必要かどうかは、レビューで確認してください。

画面を変えた PR では、オンボーディングの説明が古くなっていないかも確認します。ツアーが指す場所は `bun run check` が検査しますが、次の文章と画像は検査しません。

- 画面ごとのヒント: `packages/dashboard/src/features/onboarding/content/tips.ts`
- 「はじめに」の文案: `packages/dashboard/src/features/onboarding/content/welcome.ts`
- 「はじめに」のスクリーンショット: `docs/introducing/images/`。撮り直したら、`welcome.ts` の撮影日 `CAPTURED_ON` も更新します

「更新を確認」の確認画面には、新しい版の GitHub Release の自動生成ノートから PR タイトルを表示します。PR タイトルは利用者が読む前提で書いてください。Release の本文の先頭に手で箇条書きを書き足した場合は、それを先に表示します。

## 公式リリースの同期

[aidlc-workflows-update.yml](../../.github/workflows/aidlc-workflows-update.yml) が毎日 03:00 UTC に公式の最新安定版を確認します。従来の docs と shell の二つの同期ジョブは、このワークフローへ統合しました。手動実行も main から行います。

比較の基準は `docs/official-docs.manifest.json` の版と SHA です。公式 Release のタグ、タグが指すコミット、配布物の `version.json`、チェックサム、来歴ファイルを照合します。default branch の未公開変更は取り込みません。同じ版のタグが別の SHA に移動した場合や、リリースが古い版へ戻った場合は失敗します。

処理は次の順です。

1. Windows・macOS・Linux で公式 Doctor を採取し、既存の解析・日本語訳・関連ソースの契約と比較する。
2. 英語文書と更新履歴、Claude / Cursor の両シェルを同じ SHA へ同期する。
3. 版の宣言と GUI 導入先を更新し、検証済みの Doctor 採取物を登録する。State Version の変更や未確認の診断ソース変更はここで止める。
4. 成果物マップと検索索引を再生成し、`bun run check` を実行する。
5. 差分があれば `chore/aidlc-workflows-update` に Draft PR を作成する。採取物と失敗レポートは Actions の artifacts に残す。

上流のコードを実行するジョブには書き込み権限を与えません。`publish` は許可したパスのパッチを適用して PR を作るだけで、リポジトリのスクリプトを実行しません。同期 PR に人のコミットがある間は更新を止めます。

`GITHUB_TOKEN` で作った PR は通常の PR 検査を自動起動しないため、同期側でも検査を行い、PR は常に Draft にします。人が Draft を解除すると `ready_for_review` で通常の検査が走ります。未対応差分を直し、required checks が揃ってからマージしてください。`release:skip` は互換性検査を免除しません。ラベルなしでマージすると通常の patch リリースになるため、CI だけの変更など、出荷しない場合に限って `release:skip` を選びます。

### 日本語文書とシェルの扱い

英語本文と `CHANGELOG.md` は公式 SHA から取り込みます。全版の履歴は `docs/overview/en/changelog.md`、版別の記録は `docs/overview/en/releases/<version>.md` です。原文が変わった日本語ページには更新待ちの印が付きます。日本語訳、bridge-map の説明、リポジトリ独自の `release-highlights.md` は差分を読んで更新してください。

両シェルは上流の `scripts/package.ts` で生成します。リポジトリ所有の scope、検証スキル、テスト、ローカル設定、Cursor のインストール記録は同期対象外です。Cursor adapter、計画承認ガード、監査ログ追記のパッチは [workflows-shell-overrides.json](../../scripts/workflows-shell-overrides.json) に元のファイルと修正版のハッシュを記録しています。両方が一致する間は同期後に修正版を戻します。上流の元ファイルが変わったときは自動再適用せず、PR で見直します。

### 互換性チェック（docs 以外の追随）

`bun run check:workflows-compatibility` はネットワークなしで動きます。manifest、索引、bridge / agent / artifact マップ、両シェルと stamp、reader の状態版、GUI 導入先、README / AGENTS の宣言、Doctor の証跡を完全一致で照合します。欠落や不一致は終了コード 1 です。通常の `bun run check` に含まれます。

`bun scripts/check-workflows-drift.ts --upstream <checkout>` は調査用のレポートとして残しています。こちらの終了コード 0 や `blocking=0` は出荷の許可ではありません。ステージの入出力、エージェント、リンク、成果物説明の再生成チェックも引き続き必要です。

Doctor の対応版は [doctor-compatibility.json](../../packages/vscode-extension/data/doctor-compatibility.json) から導出します。導入対象には 3 OS 各 9 ケースの実採取が必要です。通常・警告・異常をコピー版とネイティブ版で確認し、コピー版では Bun の PATH 案内、JSON に出ない追加警告、Kiro の provider 診断も確認します。旧 2.8.x の組み立てた例は legacy として区別し、新版の証跡には流用しません。

[doctor-contract.yml](../../.github/workflows/doctor-contract.yml) は公式タグから再採取します。上流の診断データと追加警告から期待値を作り、Andon の解析結果・件数・終了コード・訳と照合します。期待値を Andon の parser から生成しません。未知の行、未翻訳の診断、関連ソースの変更は失敗としてレポートします。`core/tools` の全 TypeScript / JSON を比較するため、採取ケースが通らない分岐の変更も要確認になります。版定数の値だけは別の版検査で確認します。

採取物（artifact）を手元に取得できない環境では、作業ブランチで [doctor-record.yml](../../.github/workflows/doctor-record.yml) を手動実行します。doctor-contract で採取したあと、`record` ジョブが `record-doctor-candidate.ts --all-platforms` で検査・登録し、そのブランチにコミットします。3 OS すべての採取物がそろわない場合は登録しません。main では動かず、書き込み権限はこのジョブだけが持ちます。上流の実行ファイルは動かしません。

`record` を doctor-contract.yml の中に置かないでください。呼び出し先のワークフローに、呼び出し元より強い権限を求めるジョブがあると、そのジョブが実行されない場合でも呼び出し元全体が起動時に失敗します。2026-10-10〜14 の定期同期はこれで止まっていました。`bun run lint:workflows` がこの形を検出します。

採取は一時プロジェクト・一時ホーム・一時インストール先で行います。外部 CLI の存在確認と非対話 PATH はテスト用の実行ファイルで制御し、公式 AI-DLC のコードは変更しません。利用中の設定やインストールは使いません。採取ファイルの一時パスと Bun の場所を置換しますが、診断文・件数・コマンドは保持します。

### 手元での採取と更新候補

公式タグの checkout で依存を導入し、Claude / Cursor 配布物を生成してください。ネイティブ用のフォルダーには、対象 OS の公式実行ファイル、`aidlc-runtime-<version>.tar.gz`、`version.json`、`checksums.txt`、`aidlc-release.intoto.jsonl` を用意します。

```bash
bun scripts/capture-doctor-fixtures.ts --upstream ../aidlc-workflows --out logs/doctor-new --release-dir logs/doctor-release
bun scripts/check-doctor-candidate.ts logs/doctor-new
bun scripts/check-bundled-shells.ts ../aidlc-workflows
bun run check:workflows-compatibility
```

採取先は空の新しいディレクトリを指定します。前回の採取物と再実行の一部が混ざるのを防ぐため、既存の `candidate.json` がある場所は拒否します。`--copy-only` は採取器の調査用です。出荷検査を満たすにはネイティブ版を含む全ケースが必要です。

`prepare-workflows-update.ts <公式checkout> <OS別採取物の親ディレクトリ>` が同期候補をまとめます。親ディレクトリの各子フォルダーに、各 OS の `candidate.json` と採取物を置いてください。ソースに未確認の変更がある場合は、自動登録を止めます。診断コードと表示変更をレビューし、parser・日本語訳・回帰テストを更新してから採取をやり直し、版別の検証記録を更新します。通すために未知行を消したり、期待値を parser の結果で上書きしたりしないでください。

main の required checks は `workflows-compatibility`、3 OS の `doctor-contract`、3 OS の `check`、`release-labels` です。

### PR の検査を走らせる範囲

検査の時間と同時実行枠を無駄にしないため、次のように絞っています。規則は [ci-workflow-policy.ts](../../scripts/ci-workflow-policy.ts) にあり、`bun run lint:workflows`（`bun run check` の一部）が守られているかを確認します。

- `check` と `doctor-contract` は main への push では走りません。main の保護は「最新の main を取り込んだ PR だけマージ可」なので、マージ後の内容は PR で通した内容と同じです。
- Draft の PR では両方とも検査しません（`doctor-contract` は Linux 上で何もせず報告します）。Draft を解除すると `ready_for_review` で同じコミットを検査します。Draft のまま確認したいときは、Actions からそのブランチで手動実行してください。
- `doctor-contract` は、PR が検査の入力（スクリプトとその import 先、Doctor の採取物と対応表、同梱シェル、manifest、lockfile など）を変えたときだけ 3 OS で採取します。入力を変えない PR でも 3 つの必須チェックは報告しますが、Linux ランナー上で全ステップを飛ばします。入力の一覧は doctor-contract.yml の `DOCTOR_INPUTS` です。スクリプトの import を増やして一覧から漏れると `bun run lint:workflows` が失敗し、足りないパスを表示します。設定テンプレートと専用 Release App の準備は [依存更新と品質チェック](dependency-quality.md#main-の保護を有効にする) を参照してください。App 未設定のまま保護だけを有効にすると、既存の自動リリースの push が拒否されます。

### 成果物説明の派生（`artifact-map.json`）

同梱文書の検索索引 `docs/official-docs.index.json` も同期コマンドが再生成し、同期 PR に含めます。文書を直接編集した場合は `bun run build:docs-index` を実行してください。`bun run check` が生成結果との差分を検出します。翻訳の確認情報と引用元の扱いは [文書への質問ガイド](../guides/asking-aidlc.md#索引と翻訳の更新) を参照してください。

索引は末尾改行を含む UTF-8 で32 MiBまでです。生成時と読み取り時は `MAX_DOCS_INDEX_BYTES` を共有し、単一文書の10 MiB制限とは分けています。生成結果が上限を超えると `index_too_large` で停止し、既存索引は置き換えません。その場合は索引の分割設計や収録範囲を見直してください。上限超過の索引を手動で置いても、実行時に同じエラーで拒否します。

ステージカードに出る「この成果物には何が書かれているか」の一文は、**手書きではなく同梱スナップショットからの派生**です。`docs/reference/<locale>/04-stages/*.md` の `### Outputs` / `### 出力` 節が、すでにファイル 1 件につき 1 行の説明を持っているため、それを機械的に抜き出します。

```bash
bun run build:artifact-map          # 再生成
bun scripts/build-artifact-map.ts --check   # 差分があれば exit 1
```

- **結合キーはステージ番号**（`2.7`）です。見出し文言はロケールで変わりますが番号は変わりません。どの成果物が存在するかは `stage-graph.json` の `produces[]` が決め、スナップショットにしか無い行は捨てます。
- **正規名とファイル名は一致しないことがあります**（`build-test-results` → `test-results.md`）。対応はステージファイルの `outputs:` フロントマター行から解決します。厳密な語幹一致か、位置対応のどちらかで裏が取れた場合だけ「解決済み」とし、`.md` を推測しただけのものは**未解決として書き込みを拒否**します（`outputs:` 行が無い場合だけでなく、行はあるがその成果物を挙げていない場合も同様）。推測したファイル名は、存在しないファイルを指して I/O リンクを黙って殺すためです。

  位置対応を信じてよいのは、**名前で一致した成果物がそろって同じ位置にいる**ときだけです。件数が同じでも並びが違えば、別名の成果物は無関係なファイルを掴みます（`outputs:` が並べ替わると `build-test-results` が `build-instructions.md` を指す、など）。名前一致した成果物が 1 つでもずれた位置にいたら、位置対応は根拠にならないと判断し、残りは未解決として扱います。

- **説明文からは Markdown 記法を落とします**。カードはこれを Markdown ではなくテキストとして描画し、`../13-runtime-graph.md` のような相対リンクはカードからは解決できません。リンクテキスト・コードスパンの中身・強調された語は残し、記法だけを取り除きます。
- **ja の construction / operation ページは成果物名そのものを翻訳しています**（`cd-config.md` → 「CD 設定文書」）。そのためファイル名では結合できず、**行の並び順**で結合します。これが成り立つ根拠は、ja がファイル名を書いている ideation / inception の全 65 行で並び順が en と一致していることで、`tests/artifact-map.test.ts` がこれを毎回測ります。ja が並べ替えたらゲートが落ちます。
- ただしこの計測は、行順結合を実際に使うステージ（construction / operation）そのものには届きません。ja にファイル名が無いため照合できる行がゼロだからです。そこで各ステージに、ペアリングに使った **en の行順**（`joinOrder`）を記録し、次の 2 つの場合は**そのステージの ja 説明を捨てます**（カードは en にフォールバック）。

  | 状況                                              | 挙動                                                 |
  | ------------------------------------------------- | ---------------------------------------------------- |
  | ja の行数が en と違う（翻訳が追いついていない）   | そのステージの ja を null にする                     |
  | en の行順がコミット済みの `joinOrder` と違う      | 同上。CLI がステージ名を出力する                     |
  | ja の行そのものが変わった（並べ替え・訳文の修正） | 同上。en が無傷でも `jaFingerprint` の差分で検出する |
  | 以前の実行で落としたまま、まだ確認されていない    | 同上。行数が揃っても自動では戻さない                 |

  **止めずに落とす**のが要点です。この状態が起きるのはまさに docs 同期のときで、ja の翻訳が更新されるのはその同期 PR です。ここで生成を拒否すると、同期 PR がゲートで止まって永久に開けなくなります。誤ったペアリングは公開せず、しかしパイプラインも止めない、という選択です。

  縮退したとき、**信頼済みの `joinOrder` は据え置きます**（新しい順序や null で上書きしません）。上書きすると次の導出で「変化なし」と判定され、古い ja 行が別の成果物に付き直すうえ、その結果が直前に書いた内容と食い違って byte 一致のゲートに落ち、結局同期 PR が開けなくなります。据え置くことで状態は導出をまたいで安定します。

  ja 側だけが動いた場合は `joinOrder` では検出できません。en が無傷なら記録した並びも無傷で、説明だけが隣の成果物へずれるからです。そこで **ja 行の本文のダイジェスト（`jaFingerprint`）** も記録し、これが変わったら位置対応を信頼しません。訳文の修正でも発火しますが、翻訳が動いた瞬間こそ対応関係を確認すべきタイミングです。

  そして**縮退は粘着的です**。いったん落としたペアリングは、人が確認するまで戻りません。`joinOrder` が記録できるのは en の並びだけで、それが観測可能な全てだからです。これらの ja ページは成果物名そのものを翻訳しているため、**正しい状態で戻ってきた ja 表と、行が入れ替わって戻ってきた ja 表は区別がつきません**。行数が揃ったことを根拠に自動復帰させると、黙って別の成果物に付き直します。

  ja ページを en と突き合わせて確認したら、`bun scripts/build-artifact-map.ts --accept-ja-order <ステージ>[,<ステージ>]` でペアリングを復帰させます。**確認したステージ名が必須**です。1 ページ見ただけで全ステージの安全確認を解除しないためで、名前を伴わない実行は拒否されます。このフラグは**縮退から抜けるための手段**であって、何かを止めるゲートではありません。

- 同じ理由で、テストは **ja の欠落一覧をピン留めしません**（en 側だけをピン留めします）。ja の欠落は翻訳の遅れであって回帰ではありません。
- 同期は自動です。`sync-official-docs.ts` がスナップショット差し替えの直後に再生成し、`aidlc-workflows-update.yml` の `add-paths` に生成ファイルを含めてあるので、同期 PR に古い説明が残りません（`add-paths` から漏れると、ゲートは作業ツリーを見て通るのにコミットにはファイルが乗らない、という形で古い説明がマージされます）。生成物が古いまま出荷されないことは data-lint が byte 一致で担保します。
- このファイルは `.oxfmtrc.json` の `ignorePatterns` で **oxfmt の対象外**です。整形の所有者を生成器に一本化しないと、byte 一致の検証が成立しません。
- 上流の `### Outputs` 表に行が無い成果物は**説明なし**で出します（推測しません）。2.7.0 時点では 6 件（5 ステージの `traceability.json` と Build and Test の `cross-unit-traceability.md`）です。この一覧は手で持たず、**コミット済みマップ自体を許可リストとして使います**。上流が埋めれば説明がマップに入り、以後それを失うとゲートが落ちます。手書きの一覧は一度与えた許可を撤回できず、「もともと欠けていた」と「一度得たのに失った」を区別できません。
