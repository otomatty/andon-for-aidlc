# 非同期共有規約

> 対象: モブに同席できない参加者へ、AI-DLC のレコードを共有する運用  
> 関連: [使い方ガイド一覧](./README.md)

## 目的

同席できない参加者に「いまワークフローがどこまで進んだか」を届けるのに、このマシンの Dashboard は使えない（時間も場所も共有していない）。そこで**すでに git 管理下にあるレコードそのもの**を共有物にする。

この規約が満たすのは2つ。

1. **ドライバー側**: ゲートを通過するたびに、`aidlc/` 配下のレコードだけを push する。作業中のアプリコードは巻き込まない
2. **参加者側**: **clone を checkout せずに**、成果物を読む。ブランチを切り替えたり作業ツリーを汚したりせずに済む

前提: リポジトリに共有リモート（`origin`）があること。無い場合は「[使えないときの代替](#使えないときの代替)」へ。

> **push 先が private であることを先に確認する。** `aidlc/` の成果物には、質問回答に貼り付けたログや設定が含まれ得る。public リポジトリへ push すれば、それはそのまま公開される。
>
> ```sh
> git remote get-url origin
> ```
>
> 期待される出力: 共有していい先のリポジトリ URL が1行。想定と違う先が出たら、push しない。

## ゲート通過時の自動 push

git には「ゲートを通過した」というイベントが無いので、トリガーは**操作者がゲート承認の直後にコマンドを1回叩くこと**にする。叩く中身をサンプルとして下に置く。

### サンプル

`scripts/aidlc-share.sh` として保存する（**このリポジトリには意図的に置いていない。使うと決めた人が自分でコピーする**）。

```sh
#!/bin/sh
set -eu

# --- 契約: この3つを書き換えずに使うか、書き換えるなら意味を理解して書き換える ---
BRANCH="main"          # (a) 対象ブランチ。ここ以外へは push しない
RECORD_PATH="aidlc"    # (b) 対象パス。ここ以外は add も commit もしない
REMOTE="origin"

current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current" != "$BRANCH" ]; then
  echo "aidlc-share: 現在のブランチは '$current' です。'$BRANCH' 上でのみ実行します。" >&2
  exit 1
fi

git add -- "$RECORD_PATH"
if git diff --cached --quiet -- "$RECORD_PATH"; then
  # 新しいコミットは作らない。ただしここで終わらない —
  # 「コミット済みだが push できていない」状態を素通りさせないため、push は必ず試す。
  echo "aidlc-share: '$RECORD_PATH' に未コミットの変更はありません。push だけ試します。"
else
  git commit -q -m "aidlc: ${1:-gate passed}" -- "$RECORD_PATH"
fi

if ! git push "$REMOTE" "HEAD:refs/heads/$BRANCH"; then
  echo "aidlc-share: push に失敗しました。コミットはローカルに残っています。" >&2
  exit 1
fi
echo "aidlc-share: $REMOTE/$BRANCH に反映済みです（HEAD = $(git rev-parse --short HEAD)）。"
```

### このスクリプトがすること / しないこと

**すること**:

- `aidlc/` 配下の変更（新規の成果物ファイルを含む）だけを stage して commit する
- 現在のブランチが `BRANCH` と一致するときだけ動く。それ以外では何もせず終了コード 1 で止まる
- `aidlc/` に未コミットの変更が無ければ**コミットは作らない**（何度叩いても空コミットを作らない）が、**push は必ず試す**。「コミット済みだが push できていない」状態を成功扱いで素通りさせないため。共有済みなら git が `Everything up-to-date` と出して終わる
- push に失敗したら、失敗したことを stderr に出して終了コード 1 で止まる

**しないこと**:

- **アプリケーションコードを一切 stage / commit しない。** `git add -- "$RECORD_PATH"` と `git commit ... -- "$RECORD_PATH"` の pathspec がそれを保証する。作業中の `src/` の変更や、操作者が別途 stage していたものは、そのまま手元に残る
  - ただし **push は「ブランチごと」であってパス単位ではない**。`$BRANCH` に**既にコミット済みで未 push の**アプリコードがあれば、このスクリプトの push はそれも一緒に公開する（git の push にパス指定は無い）。この規約はゲート成果物を private リポジトリで共有する前提なので開示範囲は変わらないが、「記録だけが飛ぶ」とは思わないこと。アプリコードは Bolt ブランチ側で扱い、`main` に未 push のコミットを溜めない運用がこの点でも効く
- **`--force` を使わない。** 履歴を書き換えない。リモートが先に進んでいれば push は普通に拒否される（後述）
- `BRANCH` 以外のブランチへ push しない。ブランチ名を推測して補完することもしない
- `git pull` / `git merge` / `git rebase` をしない。手元の履歴を勝手に動かさない
- 失敗を握り潰さない（推奨事項。契約の3条件には含まれないが、黙って失敗するスクリプトはゲート通過が共有されていないことに気付けない）

> **Construction の Bolt ブランチで使う場合**: `BRANCH` をその Bolt ブランチ名に書き換える。`main` 固定のまま Bolt ブランチ上で叩いても、上の分岐で止まるだけで何も起きない（これは意図した挙動である）。「今いるブランチへ push する」形にはしないこと — それは「対象ブランチを明示する」という契約そのものを外すことになる。

### 使い方

ゲートを承認した直後に、ゲート名を引数にして1回叩く。

```sh
sh scripts/aidlc-share.sh "requirements-analysis 承認"
```

期待される出力:

```
To <origin の URL>
   1a2b3c4..5d6e7f8  HEAD -> main
aidlc-share: origin/main に反映済みです（HEAD = 5d6e7f8）。
```

実際に何が乗ったかの確認:

```sh
git show --stat --oneline HEAD
```

期待される出力（`aidlc/` 配下だけが並ぶこと）:

```
5d6e7f8 aidlc: requirements-analysis 承認
 aidlc/spaces/default/intents/<intent>/inception/requirements-analysis/requirements.md | 12 ++++
 aidlc/spaces/default/intents/<intent>/aidlc-state.md                                  |  2 +-
 2 files changed, 13 insertions(+), 1 deletion(-)
```

作業中のアプリコードが手元に残っていることの確認:

```sh
git status --porcelain
```

期待される出力（`aidlc/` 配下の行が消え、アプリコードの変更は `M` のまま残る）:

```
 M src/app.ts
```

### 起きうる失敗と対処

| 出力                                                                                                        | 意味                           | 対処                                                             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `aidlc-share: 'aidlc' に未コミットの変更はありません。push だけ試します。` に続いて `Everything up-to-date` | 記録は変わっておらず、共有済み | 対処不要（exit 0）。ゲート通過が記録に反映されているかを確認する |
| `aidlc-share: 現在のブランチは 'bolt/7-xxx' です。'main' 上でのみ実行します。`                              | 対象ブランチ以外にいる         | `main` に戻るか、`BRANCH` を意図したブランチ名に書き換える       |
| `! [rejected] HEAD -> main (fetch first)` に続いて `aidlc-share: push に失敗しました。`                     | 他の人が先に push している     | **`--force` を足さない。** 下記の手順で復旧する                  |

### push を拒否されたときの復旧

```sh
git pull --rebase --autostash origin main
sh scripts/aidlc-share.sh "<同じゲート名>"
```

期待される出力: 1本目が `Created autostash: <sha>` → `Successfully rebased and updated refs/heads/main.`、2本目が `<sha>..<sha>  HEAD -> main` と `aidlc-share: origin/main に反映済みです（HEAD = <sha>）。`

2つ、間違えやすい点がある。

- **`--autostash` を省くと `git pull --rebase` はそもそも失敗する** — `error: cannot pull with rebase: You have unstaged changes.` になる。このスクリプトを使う場面は「アプリコードを触っている最中にゲートを通過した」であり、作業ツリーが汚れているのが通常である。`--autostash` は rebase の前後で作業中の変更を自動的に退避・復元する（復元されたことは `Applied autostash.` の行で確認できる）
- **再実行では新しいコミットは作られない**（1回目で作成済み）。スクリプトはそれでも push を試すので、記録は実際に共有される。**`push だけ試します` の行が出ても、それは「何もしなかった」という意味ではない** — 続く git の出力が実際の結果である

## 参加者側: checkout 不要の閲覧

参加者は clone を持っているだけでよい。**ブランチを切り替えず、作業ツリーにも触れずに**成果物を読む。

作業ツリーが要らないなら、そもそも checkout しない clone を作れる:

```sh
git clone --no-checkout <リポジトリ URL> aidlc-record
cd aidlc-record
```

期待される結果: ディレクトリの中身は `.git` だけ（`ls -a` で確認できる）。以降のコマンドはすべてこの状態のまま動く。

### 1. 最新を取り込む

```sh
git fetch origin
```

期待される出力: 新しい commit があれば `<sha>..<sha>  main -> origin/main` の行が出る。何も無ければ無出力。

### 2. 成果物を読む

```sh
git show origin/main:aidlc/spaces/default/intents/<intent>/inception/requirements-analysis/requirements.md
```

期待される出力: そのファイルの中身がそのまま標準出力に出る。ページャで読むなら `| less`、エディタで見るならリダイレクトする:

```sh
git show origin/main:aidlc/spaces/default/intents/<intent>/aidlc-state.md > /tmp/state.md
```

> パスの `<intent>` は `<slug>-<id8>` 形式のディレクトリ名。どのインテントが現在アクティブかを示すカーソルは**共有されない**（後述）ので、パスは自分で確かめる。

### 3. 何があるかを一覧する

```sh
git ls-tree -r --name-only origin/main -- aidlc/
```

期待される出力: 共有されている成果物のパスが1行1件で並ぶ。

```
aidlc/spaces/default/intents/<intent>/aidlc-state.md
aidlc/spaces/default/intents/<intent>/inception/requirements-analysis/requirements.md
aidlc/spaces/default/intents/<intent>/inception/scope-definition/scope-document.md
```

### 4. 前回のゲートから何が変わったかを見る

```sh
git log --oneline origin/main -- aidlc/
```

期待される出力: ゲートごとのコミットが新しい順に並ぶ。

```
5d6e7f8 aidlc: requirements-analysis 承認
1a2b3c4 aidlc: scope-definition 承認
```

差分:

```sh
git diff origin/main~1 origin/main -- aidlc/
```

期待される出力: 直前のゲートからの差分。`--stat` を付ければファイル単位の要約になる。

```
 aidlc/spaces/default/intents/<intent>/inception/requirements-analysis/requirements.md | 12 ++++
 1 file changed, 12 insertions(+)
```

**追いつくときはこれが最も速い。** 全文を読み直すのではなく、自分が最後に見たコミットからの差分だけを読む:

```sh
git diff <前回見た sha> origin/main -- aidlc/
```

## 何を共有し、何を共有しないか

`aidlc/` 配下が丸ごと共有されるわけではない。リポジトリの `.gitignore` が「チームの共有物」と「各自の手元の状態」を分けている。

### 共有される（commit される）

| 対象                                            | 中身                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `aidlc/spaces/*/memory/**`                      | 方法論のルール（`org.md` / `team.md` / `project.md` / `phases/*.md`）           |
| `aidlc/spaces/*/codekb/**`                      | コードベース知識                                                                |
| `aidlc/spaces/*/knowledge/**`                   | チーム・ドメイン知識（自由形式。スペース内の全インテントに跨って蓄積される）    |
| `aidlc/spaces/*/intents/intents.json`           | インテントのレジストリ                                                          |
| `aidlc/spaces/*/intents/*/aidlc-state.md`       | ワークフローの状態（現在ステージ・進捗）                                        |
| `aidlc/spaces/*/intents/*/audit/*.md`           | 監査ログ。**クローンごとのシャード**（`<host>-<clone>.md`）として commit される |
| `aidlc/spaces/*/intents/*/<phase>/<stage>/*.md` | 各ステージの成果物と観察日誌（`memory.md`）                                     |

### 共有されない（`.gitignore` されている）

| 対象                                          | 理由                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `aidlc/active-space`                          | 各自のカーソル。2人が別々のスペースを見ていて正常                                  |
| `aidlc/spaces/*/intents/active-intent`        | 同上（どのインテントを見ているか）                                                 |
| `aidlc/.aidlc-clone-id`                       | このクローンの監査シャード名。共有すると全クローンが同じシャードに追記して衝突する |
| `aidlc/.aidlc-sessions/`                      | セッション → インテントの対応（各自のランタイム状態）                              |
| `aidlc/spaces/*/intents/*/runtime-graph.json` | マシンごとに再生成される派生物                                                     |
| `aidlc/spaces/*/intents/*/.aidlc-*`           | リカバリ・フック健全性・センサーの作業ファイル                                     |
| `.claude/settings.local.json`                 | 各自のローカル設定                                                                 |

### 参加者にとっての帰結

- **「いまどのインテントを見ているか」は伝わらない。** カーソルが共有されないため。ドライバーは push の通知にインテントのディレクトリ名を添えるか、参加者は `git ls-tree` で一覧して確かめる
- **監査ログは全員分が揃うとは限らない。** シャードはクローンごとなので、共有リポジトリに乗っているのは push した人の分だけ。自分の手元の監査はローカルにしか無い
- **成果物と状態は完全に揃う。** 現在地の判断に必要なもの（`aidlc-state.md` と各ステージの成果物）は全部共有側にある

> **上表は `.gitignore` のコメントの写しではない。** `.gitignore` 末尾の「COMMITTED（NOT ignored、記録のためここに列挙）」コメントは `aidlc/spaces/*/knowledge/**` を挙げていないが、ignore ルールも存在しないため実際には共有される。**共有されるかどうかの判定は ignore ルールの有無であって、あのコメントの網羅性ではない。** 迷ったら `git check-ignore -v <パス>` で確かめる（何も出力されなければ ignore されていない＝共有される）。

> `.gitignore` に**追加のルールを足さないこと。** 上の分割は意図的に設計されている。特に `aidlc/spaces/*/intents/*/audit/*.md` を ignore すると監査の履歴が失われる（シャード方式は、まさに ignore せずに衝突を避けるための構造である）。

## 使えないときの代替

### 代替 1: 手動 push（スクリプトを置きたくない場合）

スクリプトがしていることを、そのまま手で叩く。契約の3条件（対象ブランチ・対象パス・force 無し）は同じである。

```sh
git add -- aidlc
git commit -m "aidlc: <ゲート名> 承認" -- aidlc
git push origin HEAD:refs/heads/main
```

期待される出力: 最後のコマンドが `<sha>..<sha>  HEAD -> main` を出す。

`git commit` に `-- aidlc` を付けるのを忘れないこと。付けないと、stage 済みの他の変更まで一緒に commit される。

### 代替 2: 成果物を添付して渡す（共有リモートが無い場合）

社外の参加者、あるいは共有リポジトリを持てない場合。

ファイル1つだけなら:

```sh
git show HEAD:aidlc/spaces/default/intents/<intent>/inception/requirements-analysis/requirements.md > requirements.md
```

レコード全体をまとめるなら:

```sh
git archive --format=zip --output=aidlc-record.zip HEAD aidlc/
```

期待される出力: 無出力で `aidlc-record.zip` が生成される。中身の確認:

```sh
unzip -l aidlc-record.zip | head
```

期待される出力: 先頭に commit の SHA、続いて `aidlc/` 以下のパスが並ぶ。

**この代替で失うもの**: 差分で追えなくなる（毎回、全体を読み直すことになる）。履歴も辿れない。ゲートを重ねるほど不利になるので、共有リモートが用意できるならそちらを使う。

> **添付する前に中身を確認する。** zip はレビューされずに転送されがちである。`unzip -l` でパスを一覧し、さらに `aidlc/` 配下の成果物に、社外へ出せない情報（貼り付けたログ・設定値・内部のホスト名）が含まれていないかを確認してから渡す。
