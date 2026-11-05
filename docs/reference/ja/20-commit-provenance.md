# コミット来歴

> 対象: Tier 2/3（チーム導入担当者、フレームワーク貢献者）。

この章は **commit provenance（コミット来歴）** の正式なリファレンスです。任意の Git コミットや差分範囲から、変更パスを所有するレビュー済み Unit を逆引きします。構成要素は、各クローンへ引き継ぐ **コミット済みのレビュー対象ソースの証拠**、帰属・変更の有無・信頼の根拠を返す読み取り専用の **`aidlc attest resolve`**、監査の **`SOURCE_COMMITTED`** アンカーです。アンカーは補足情報であり、resolver は読みません。`aidlc attest anchor` または明示的に有効化したセッション開始時の処理が記録します。

関連資料: [状態マシン](12-state-machine.md)、[フックとツール](06-hooks-and-tools.md)、監査形式レジストリ `knowledge/aidlc-shared/audit-format.md`、[CLI コマンド](../guide/12-cli-commands.md)。

## 1. 解決する問題

Code Generation の Unit ごとの `REVIEW_COMPLETED` 記録は、Unit が宣言したパスとマニフェストのバイト列から求める `Unit Source Fingerprint` により、レビュー対象を特定します。コミット来歴は逆方向の照合を追加します。後から squash・rebase したり、無関係な変更とまとめてコミットした場合でも、各パスがどの Unit・インテントのレビューに属し、コミットした内容がレビュー時と一致するかを調べられます。パイプライン、監査、リリースノート、将来の履歴調査から「ソースの各変更をレビュー済み Unit までたどれるか」を確認するための仕組みです。

## 2. 脅威モデル

照合では次の 2 点を分けます。

- **完全性:** コミットしたバイト列が、あるレビュー記録の承認対象と等しいか。内容だけで検証します。証拠のハッシュが記録の `Unit Source Fingerprint` と一致する必要があるため、改変すると `drifted` / `unverifiable` になり、誤って検証成功にはなりません。
- **真正性:** その記録は実際に行われたレビューから生じたか。ディスク上の形式だけでは証明できません。記録・マニフェスト・証拠は普通のリポジトリ内のファイルであり、書き込める人なら、承認対象のソースと同じ変更に承認記録を含めることもできます。

すべてのレポートは、実際に確認した根拠を `trust{}` に記載します。

| `trust.level` | 意味 | 排除できるもの |
| --- | --- | --- |
| `informational` | 作業ツリーから記録を読みました。同じコミットの別クローンで再現できるとは限りません。記録を対象リポジトリ内に置けない構成（§10）だけで使います | なし |
| `reproducible` | Git ツリーから読み、同じ `(base, head)` なら別クローンでも将来でも再現できます。ただし対象範囲自身が記録パスを変更しており（`trust.selfAttested`）、自己承認の可能性があります | 非決定性。後から記録を編集しても過去のレポートは変わりません |
| `independent` | 再現可能で、照合対象の変更が承認記録の出所ではありません。対象範囲が記録を変更していないか、変更側が書けない参照へ `--record-ref` を固定しています | 自己承認。変更自身が判定を作れません |
| `signed` | independent に加え、判定の根拠となる全入力が署名付きコミットで届いています。各 Unit の記録を含む監査 shard と、指紋が選んだ証拠ファイルの両方が対象です。Git `%G?` が `G` / `U` で、各入力の生の値を `trust.signatures` に報告します。少なくとも 1 入力が必要です | 匿名での記録書き込み。承認の鍵を特定できます |

照合される変更ではなく、**検証者**が指定する 2 つの引数で信頼の水準を上げられます。

- `--record-ref <ref>`: 対象コミットの代わりに指定ツリーから記録・マニフェスト・証拠を読みます。保護ブランチ、記録専用 ref、レビューシステムのミラーなど、対象変更が動かせない参照を指定します。対象変更が偽の記録を書いても参照先には存在せず、パスは `drifted` または `unattested` になります。
- `--require-trust <level>`: 必要水準に達しなければ終了コード **3** にします（`--fail-on` と共通）。

**対象に含む脅威:** レビュー後の内容変更、証拠の欠落・不一致・gitignore 対象だけに残る証拠、所有者を一意に決められない順序、署名のない承認記録から署名付き証拠を参照する場合、自己承認、照合対象コミットと作業ツリーの記録の食い違い、後からの記録改変です。証拠だけ署名されていても `signed` にはならず `independent` までです。作業ツリーや後からの改変は、Git ツリーから読む過去の判定を変えません。

**対象外:** 固定した参照へ書ける人や署名を偽造できる人は、resolver が受理する記録を作れます。承認を書ける人を制限するのは、ホスティング側のブランチ保護・署名必須化・レビューゲートの役割です。レビューが不十分だったか、正しい Unit をレビューしたかは判断しません。

**既定の扱い:** 信頼の参照と必要水準を指定しないレポートは、内容の完全性に関する情報です。権限の証明にはなりません。検証者が信頼する出所と必要水準を指定したときにゲートとして使えます。保存後も根拠以上の意味に受け取られないよう、`trust{}` は常に出力します。

## 3. 設計上の制約

1. **多くのコミットは手動です。** 利用者は別マシンから、セッション終了後に通常の `git commit` を実行します。フックやセッション中の観測は補足情報であり、照合の基盤にできません。
2. **指紋だけでは Unit を逆引きできません。** `Unit Source Fingerprint` はレビュー内容を証明しますが、クローンとコミット範囲から変更パスをその記録へ結び付けるには、コミット済みの帰属情報が必要です。
3. **コミットメッセージを情報経路にしません。** 書式はチームが決めるため、trailer・チケット接頭辞・命名規則は解析しません。

## 4. 帰属モデル

帰属は **コミット済み内容の純粋関数** です。対象コミットのツリーと、インテント記録の Git ツリー（監査 shard、Unit の `source-manifest.json`、後述の証拠）から求めます。作業ツリー、ローカル状態、解決対象以外の ref、フックの実行、環境変数、メッセージ本文には依存しません。

- **任意のクローンで照合可能:** 対象コミットだけがあるクローンでも作成元と同じレポートになります。ただし、クローンが初期化していない submodule の下は例外で、コミットの一覧にその中のファイルのエントリがありません。
- **決定的:** 同じ `(base, head)` の結果は将来も同じです。追加レビューや作業ツリーの証拠編集は過去の帰属を変えません。除外も同様です。ハーネスのディレクトリは base ツリーの `<dir>/tools/data/harness.json` で識別するため、ローカルのインストール状態や変更自身が除外範囲を作ることはありません。

記録の出所は既定では対象 head のツリー、指定時は `--record-ref` です。唯一、複数ルート構成で記録ルートが対象 repo の外にある場合は作業ツリーを読み、`informational` と警告を返します。

所有権は完了判定と同じく、Unit ごとの最新の READY な `REVIEW_COMPLETED` 記録で決まります。`Verdict: READY`、`Unit`、`Stage`、`Unit Source Fingerprint` が必要です。タイムスタンプ、shard 内位置、shard 番号の順で並べます。ただし同一 Unit の別 shard に同時刻の READY がある場合は一意に順序を決めず `indeterminate` にします。複数 Unit が同じパスを宣言した場合は最新の宣言が所有します。最新時刻が同じなら名前順で選ばず、同様に `indeterminate` にします。

各承認記録のパス宣言は、利用できる最も強い根拠を使います。

| `claimsSource` | 意味 |
| --- | --- |
| `manifest` | `source-manifest.json` のハッシュが証拠ヘッダーの digest と一致。`src/generated/` などディレクトリ接頭辞を含む完全な宣言です |
| `evidence-only` | 検証できるマニフェストがなく、証拠に列挙された完全一致のパスを使用。接頭辞の宣言は失われ、配下の新規ファイルは `unattested` になります |
| `manifest-unverified` | マニフェストはあるが、証拠欠落などで照合できません。帰属は付けますが内容は検証できません |

## 5. コミットするレビュー対象ソースの証拠

レビュー時、Unit のソーススナップショットを 2 か所へ書き込みます。

- **コミットする証拠:** `<record>/construction/<unit>/<stage>/reviewed-source-<hash12>.tsv`。`<hash12>` は指紋の先頭 12 桁です。照合の正式な根拠であり、記録とともに各クローンへ届きます。
- **従来のローカルスナップショット:** `<record>/.aidlc-engine/source-review/<stage>/unit-<unit>-<hash12>.tsv`。gitignore 対象で、完了時の鮮度検査に使います。照合の検証根拠には使いません。使うと実行マシンによって結果が変わるためです。

Swarm worktree の最終化では、`aidlc-swarm.ts` の `captureReviewedRecordSnapshot` / `mergeReviewedRecordSnapshot` が `source-manifest.json` と `reviewed-source-<hash12>.tsv` を主記録へ運びます。記録の指紋とハッシュ照合し、成果物と同じ不可分のトランザクションで書きます。証拠の二重書き込み導入前にレビューした進行中 swarm は、記録と一致するローカルスナップショットをコミット対象へ昇格します。ローカル証拠の欠落・改変は拒否します。そのため正常な swarm Unit に更新後の再レビューは不要です。

両ファイルの内容は **バイト単位で同一** で、その SHA-256 が `Unit Source Fingerprint` です。新しい指紋方式は導入していません。同じ指紋の再書き込みは何もしません。同じ保存先に別の内容がある場合は `address collision or corruption` として拒否します。

形式は `aidlc-lib.ts` の `parseUnitSourceListing` / `serializeSourceListing` が扱う厳密な TSV です。

```text
manifest\t<sha256-of-manifest-bytes>\t-\n
<repo>\t<path>\t<mode>\t<oid>\n        # キー順に並べた 0 行以上
```

ヘッダーはマニフェストのバイト列を結び付けます。各行は repo selector（ワークスペースルートは空文字）、パス、Git file mode（`/^\d{6}$/`）、16 進 40 桁または 64 桁の内容 ID です。内容 ID は、通常ファイルならそのバイト列の SHA-256（テキストは CRLF を LF として読む）、シンボリックリンクならリンク先テキストの SHA-256、submodule の gitlink（mode `160000`）ならそのコミット ID です。フィールド内の `\t`、`\n`、`\r`、`\\` はバックスラッシュでエスケープします。重複キー、末尾改行の欠落、不正フィールドはファイル全体を拒否し、parser の null を証拠なしとして扱います。有効なヘッダーだけの空リストは受理します。

## 6. 照合 — `aidlc attest resolve`

```text
aidlc attest resolve [<commit>|--commit <rev>] [--diff <base>..<head>]
                     [--repo <name>] [--space <name>] [--intent <dir>]
                     [--record-ref <ref>] [--require-trust <level>]
                     [--fail-on <statuses>]
```

読み取り専用です。書き込み・監査イベント発行・`SOURCE_COMMITTED` の読み取りはしません。位置引数のコミットまたは `--commit`（併用不可、既定 `HEAD`）は first-parent との差分、`--diff <base>..<head>` は両端の差分、`<base>...<head>` は merge base からの差分です。各 verb が受理するフラグ以外は終了コード 1 です。`resolve --reconcile` や `anchor --record-ref` を黙って無視しません。浅いクローンで親がないコミットも、ツリー全体の差分にはせずエラーにします。

| 状態 | 意味 | 失敗指定可能 |
| --- | --- | :---: |
| `verified` | レビュー済み Unit が所有し、コミットの blob OID が証拠と一致 | — |
| `drifted` | 所有 Unit はあるが、コミット内容がレビュー時と異なる | ✓ |
| `unattested` | 宣言するレビュー済み Unit がない | ✓ |
| `unverifiable` | 宣言する記録はあるが、証拠がない、指紋と不一致、または gitignore 対象のローカル証拠しかない。検証成功にはしない | ✓ |
| `indeterminate` | 別 shard の同時刻 READY や、同じパスを宣言する別レコードの同時刻記録など、順序が曖昧 | ✓ |
| `excluded` | repo 内の `aidlc/` / `.aidlc/`、インテント下の `.aidlc-engine/`（旧 `.aidlc-sensors/` を含む）、ワークスペースを含む repo の base ツリーで既にハーネスと識別された `.claude/` / `.kiro/` など。head が新設したマニフェストで自身や兄弟パスを除外できない。帰属・失敗判定の対象外 | — |

`--fail-on` は失敗指定可能な 4 状態をコンマ区切りで受け取ります。一致すれば **3**、該当なしは **0**、使用法・環境の問題は **1** です。厳密なゲートには 4 状態すべてを指定します。`unverifiable` を省くと、内容を検証できないパスが通ります。`--require-trust` も水準不足なら 3 です。前者は変更の帰属範囲、後者はレポートの信頼度を制限します。

標準出力の JSON は次を含みます。

- `paths[]`: パスごとの状態・Unit・インテント・理由。
- `units[]`: 所有する記録の stage、iteration、`evidenceSource`、`claimsSource`、記録済み bypass、証拠を最後に書いた `evidenceCommit` / `evidenceSignature`、採用した監査 shard の `receipt` / `receiptCommit` / `receiptSignature`、全宣言パスがレビュー時の OID で head に届いたかを示す `fullyLanded`。
- `summary`: 状態別件数。`failOn`: 指定値。
- `trust{}`: `level`、`required`、`satisfied`、`recordSource`、`recordRef`、`recordCommit`、`recordPinned`、`recordPathsChangedInRange`、`selfAttested`、`signatures[]`。
- `warnings[]`: `.gitattributes` による repo のバイト形式変換（§10）、コミット済みインテント記録がない出所、作業ツリーへのフォールバックなど、個別分類は変えないがレポート全体に影響する条件。警告自体ではゲートを失敗させません。

検証には `evidenceSource: "committed"` が必要です。旧ローカル証拠も診断のため `"local"` として報告しますが、検証には使いません。その Unit は `unverifiable` となり、証拠をコミットする再レビューが必要な理由を示します。複数ルート構成は 1 回につき 1 repo を照合します。既定はルート、記録した repo は `--repo <name>` で選びます。プロジェクトディレクトリが Git repo でなく、記録した repo のうち Git repo がちょうど 1 つなら、その repo を自動で選びます（その旨の注記が出ます）。該当が 0 個または複数なら `--repo` が必須です。

## 7. アンカー — `SOURCE_COMMITTED`（補足情報）

```text
aidlc attest anchor [--commit <rev>] [--reconcile] [--max-commits <n>]
                    [--repo <name>] [--space <name>] [--intent <dir>]
```

`anchor` はコミット（既定 `HEAD`）を照合し、レビュー対象が届いていれば、関係する各インテントに `SOURCE_COMMITTED` を追記します。「このコミットがこれらの Unit を含む」という人向けの参照です。resolver は読まないため、手動コミットだけで一度も anchor を実行しなくても照合精度は変わりません。

フィールドは `Commit`、`Repo`（記録した selector、ルートは `-`）、`Units`（ソートしたコンマ区切り）、`Attributed Paths`（件数）、`Observed`（直接実行は `session`、履歴走査は `reconciled`）です。

- **重複防止:** インテントごとの `(commit, repo)` で重複を判定し、再実行は skipped にします。
- **Swarm 対応:** `SWARM_SOURCE_MERGED` の `Merge commit` で既に結び付いたコミットは省きます。
- **上限付き照合:** `--reconcile` は直近の first-parent コミットを `--max-commits` 件（既定 100）走査します。既存アンカーの手前で止まらず、過去の未記録部分も補います。結果は anchored / skipped / unattributed / 浅いクローンの boundary です。
- **浅いクローン:** 親に到達できない境界コミットは、単独 anchor ではエラー、reconcile では `boundaries[]` に記載して続行します。ツリー全体を各 Unit の変更と誤認しません。
- **曖昧な所有権:** `indeterminate` のパスにはアンカーを付けません。曖昧さの報告は resolve の役割です。
- **CLI による保護:** `SOURCE_COMMITTED` は `aidlc-audit.ts` の `CLI_PROTECTED_EVENT_TYPES` にあり、所有ツールがライブラリ経由でのみ追記します。エージェントは audit CLI で作れません。shard の merge は通常どおり受け入れます。
- **作業ツリーの記録:** anchor は現在のローカル状態を観測する補足処理なので作業ツリーを読みます。ツリーからの決定的な読み取りが必要なのは resolve です。

既定では **明示的に** `aidlc attest anchor [--reconcile]` を実行します。自動記録したいチームは **`AIDLC_SESSION_ANCHOR=1`** を設定できます。`hooks/aidlc-session-start.ts` が実セッション開始時に最大 25 コミットを best-effort で照合します。重複は防ぎ、非 Git 環境などの失敗で起動を止めません。compact 再開と rebind probe は対象外です。未設定（既定）なら、起動時に来歴アンカーの行は書かず、来歴処理もしません。`SESSION_STARTED` または `SESSION_RESUMED` の行は引き続き記録します。新しいクローン、フック無効の環境、25 件より古い履歴には明示的コマンドを使います。

## 8. 保証と境界条件

- **Squash / rebase:** コミットの祖先ではなく内容（一覧の内容 ID）で照合します。まとめたコミットも検証でき、revert 後にレビュー時の内容へ戻したファイルも `verified` に戻ります。
- **更新前の記録:** 二重書き込み前のレビューは、作成マシンでも別クローンでも次の Unit レビューまで `unverifiable` です。不足を理由に明記します。
- **除外処理を共有:** コミット側の `gitCommitSourceListing` とレビュー側は、`aidlc-lib.ts` の除外処理を共有します。ハーネス判定も `isHarnessShellManifest` を共有します。ただしバイト形式は同じではありません（§10）。
- **改変時の判定:** 証拠の破損は `unverifiable` になり、正常なローカルコピーで隠しません。作業ツリーの改変は、ツリー blob を読む判定に影響しません。
- **読み取りコスト:** `git ls-tree -r -z --full-tree` で記録ツリーを一度列挙し、必要な blob を `git cat-file --batch` でまとめて読みます。

## 9. 信頼設定の例

- **保護ブランチに記録:** レビューシステムだけが動かせる `refs/heads/aidlc-records` 等へ記録を push します。検証者は `resolve --diff <base>..<head> --record-ref aidlc-records --require-trust independent --fail-on drifted,unattested,unverifiable,indeterminate` を使います。変更自身が書いた承認記録は根拠になりません。
- **署名付き記録:** 記録コミットに署名し、ブランチで署名を必須にします。`--require-trust signed` が成立するのは、記録の出所が照合範囲からも独立しており（記録が範囲より前に書かれている、または `--record-ref` で固定されている）、かつ使う監査 shard と証拠のすべてが署名付きコミットで届いた場合だけです。範囲自身が記録パスに書き込み、それを含む記録から読む場合は、署名があっても `reproducible` のままです。ただし署名可能な変更作成者は自己承認もできます。署名は鍵を識別するもので、役割分離ではありません。帰属・否認防止には署名、職務分離には固定 ref を使い、必要なら両方を組み合わせます。

どちらも指定せず報告用として利用しても構いません。その場合の限界を `trust.level` が示します。

## 10. 制限

- **信頼の基点:** ツールは出所を報告します。ref 自体への信頼はホスティング側の保護・署名方針・アクセス制御で確立します。
- **署名はコミット単位:** 各監査 shard・証拠を最後に書いたコミットの `%G?` を使います。承認ごとの署名や承認可能な人物の判定はありません。Git が受理する `G`、未信頼の鍵による有効署名 `U` のどちらも数えます。鍵環境を設定し、必要なら `trust.signatures[]` を確認してください。
- 証拠は内容 ID を保存し、ファイル本体を保存しません。drifted パスのレビュー時と実際の差分は、レビュー済みのバイト列に到達できないと表示できません。差分が必要なチームは、レビュー済み blob を保持する ref を push するか、別途内容を保存してください。
- 1 回の呼び出しは 1 repo です。ワークスペース全体の報告は `--repo` を変えて繰り返します。
- `--fail-on` は状態単位です。「`docs/` 配下だけ unattested を許可」などはパイプライン側で実装します。
- **作業ツリーと repo のバイト形式:** 証拠は `stableFileSha256` により作業ツリーのバイト列をハッシュ化します。コミット側は checkout filter を適用せず生の blob を読みます。どちらの側も Git のテキスト規則どおり CRLF のテキストを LF として読むため、`core.autocrlf`（Windows チェックアウトの既定）ではずれが生じません。clean/smudge filter や working-tree encoding（Git LFS など）が有効だと形式が異なり、内容が同じでも `drifted` になります。初期化済みの submodule は gitlink（mode `160000`、そのコミット ID）と中のファイルのエントリとして列挙します。初期化していない submodule は gitlink だけなので、中のファイルは帰属しません。コミット済みの `.gitattributes` は `warnings[]` で警告します。ゲートに使う前にバイト形式を揃えてください。指紋の入力を統一する変更は別課題です（[ロードマップ](../overview/roadmap.md)）。
- **浅いクローン:** 境界コミットの resolve / 単独 anchor は、履歴を深く取得するよう案内して拒否します。CI なら `fetch-depth: 0` を使います。reconcile は `boundaries[]` に記載します。`--diff` は両端と merge base が必要です。
- **対象 repo 外の記録:** 複数ルート構成で記録が対象 repo 外なら、その repo のツリーから読めません。作業ツリーを使って `informational` と警告を返し、履行できない `--record-ref` は無視せず拒否します。

## 11. ファイルとテスト

| 対象 | 場所 |
| --- | --- |
| Resolver / anchor CLI | `tools/aidlc-attest.ts`（dispatcher: `aidlc attest …`） |
| 記録の読み取り (`RecordView`) | 同ファイルの `treeRecordView`（既定、`ls-tree` + `cat-file`）、`worktreeRecordView`（fallback / anchor） |
| セッション開始時の任意アンカー | `hooks/aidlc-session-start.ts`、`AIDLC_SESSION_ANCHOR=1`、既定 off |
| 証拠の書き込み・解析・除外 | `aidlc-lib.ts`: `writeUnitSourceSnapshot`、`reviewedSourceEvidenceRelPath`、`reviewedSourceEvidencePath`、`parseUnitSourceListing`、`serializeSourceListing`、`normalizeManifestSourcePath`、`sourcePathIsExcluded`、`gitCommitSourceListing`。`parseAuditShardEvents` は `aidlc-record-core.ts` |
| Swarm の証拠転送 | `aidlc-swarm.ts`: `captureReviewedRecordSnapshot`（ハッシュ検査）、`mergeReviewedRecordSnapshot`（主記録へのトランザクション） |
| イベント登録 | `aidlc-audit.ts` の `VALID_EVENT_TYPES` / `CLI_PROTECTED_EVENT_TYPES`、`knowledge/aidlc-shared/audit-format.md` |
| テスト | `tests/unit/t311-committed-reviewed-source-evidence.test.ts`（文法・二重書き込み・除外）、`tests/unit/t312-attest-resolve-anchor.test.ts`（照合・決定性・信頼水準・曖昧さ・anchor・セッション処理） |
