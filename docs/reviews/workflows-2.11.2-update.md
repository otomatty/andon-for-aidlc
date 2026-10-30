# aidlc-workflows 2.11.2 更新記録

対象は[公式リリース v2.11.2](https://github.com/awslabs/aidlc-workflows/releases/tag/v2.11.2)（2026-10-28）、タグが指すコミット `10a9bc9d85395a601de2624cf5bdd35292c10db4`。比較元は manifest の公式 v2.11.1 `895a35d86d20336d9b7bc4aedc9440e4a12c83ab`。差分は 391 コミット・850 ファイル。文書の差分は[同期差分](official-docs-diff-2.11.2.md)を参照。

リポジトリを otomatty/andon-for-aidlc に移した直後のため、毎日の同期ジョブ（aidlc-workflows-update）はまだ新しいリポジトリで PR を作っていない。今回は公式タグの独立 checkout から配布物を生成し、手元で同期した。

## 変更内容と互換性

- State Version **8**・基本 **33 ステージ**・**14 エージェント**は維持。`check-workflows-drift` は blocking 0、findings 5（導入先・Doctor 対応版・AGENTS・README・版表記）。
- 英語文書・Claude / Cursor シェル・manifest・README・AGENTS・bridge・agent map・`WORKFLOWS_TARGET_VERSION`・`.aidlc-version` を 2.11.2 に揃えた。ルートの `.gitignore` の AI-DLC ブロックと `.mcp.json` は公式配布物と同じで変更なし。
- シェルのローカルパッチ: audit の Windows 追記修正（O_APPEND の位置指定）は 2.11.2 でも未修正のため再適用した。Cursor adapter の PR #43 パッチ（進行中の作業がないときはガードを走らせない）も再適用した。2.11.2 の adapter は StrReplace の Edit への読み替え、Task の送出記録、委任先の AI-DLC コマンドの許可を加えたが、パッチの位置とは重ならない。`scripts/workflows-shell-overrides.json` のハッシュを更新。`.cursor/aidlc-install.json` は 2.11.1 の時点でも 231/293 件が古く、従来どおり再生成していない。
- **ステージグラフ**: Build and Test の結合・性能・セキュリティのテスト指示が `produces` から新しい `optional_produces` に移った（Minimal では作らず、Standard は結合のみ）。bridge-map の出力は `produces` と一致させる規則のため、ステージカードの出力からこの 3 件を外し、説明文を合わせた。成果物 map の生成は、`outputs:` 行が必須の成果物の後に `CONDITIONAL:` で任意の成果物を並べる形に合わせ、位置対応を `produces` と `optional_produces` を続けた並びで判定するようにした（`test-results.md` の対応が切れて生成を拒否していた）。
- bridge-map の説明: Code Generation（作業前からあったファイルの変更を承認時に示す）、Reverse Engineering（名前を挙げていない 10 以上のリポジトリは読む前に確認、relaxed / off の差し戻しは部分的に走査し直す）、Requirements Analysis と Domain Design（「Approve, and add <Stage> next」）、Build and Test（全テストでのカバレッジ床、実ブラウザ未実行の `Unverified`）。
- **reader**:
  - `intent add-checkout` で記録した追加のチェックアウト（`<record>/.aidlc-engine/source-checkouts.json`）は、2.11.2 ではワークスペースのソース指紋に含まれる。Andon はその走査を再現しないため、記録がある間は strict のレビュー判定を表示しない（不明として扱う）。
  - ソース指紋の除外規則・CRLF の扱い・レビュー記録の形式（指摘の状態の語彙を含む）・State の項目・Unit DAG の解析・`intents.json` の読み取り関数は 2.11.1 から変わっていないことを上流のコードで確認した。
  - 新しい監査イベント（`STAGE_OUTPUT_AMENDED`・`INTENT_CHECKOUTS_CHANGED`・`SUBAGENT_DISPATCHED`・`STATE_TRANSITION_BLOCKED`・`STAGE_RULES_BLOCKED`・`SENSOR_COULD_NOT_RUN`）は汎用の解析で読める。

### 上流と一致させていない点

- 承認後に成果物が補正された場合（`STAGE_OUTPUT_AMENDED`）、上流は新しい受領で承認を保つが、Andon の strict のレビュー判定は現在の成果物とレビュー時の指紋を比べるため表示しない。
- 変更なしで指摘を却下して同じレビューのゲートに戻る場合（再入行の `Review Kept`）、上流はレビューを保つが、Andon は従来どおり差し戻しで判定を消す。
- 競合マーカーを含む `intents.json`、`[]{}` を含む source manifest のパス、Unit の依存フォルダー下の宣言は、2.11.1 と同じく判定を保留する。

## Doctor

2.11.2 のコンパイル版 Doctor は、`aidlc engine hook <name>` で登録したフックが、実行中のコマンドの隣にあるランタイムに含まれるかを確認する。採取スクリプトはネイティブ版の Doctor をダウンロードした実行ファイルそのもので動かしていたため、隣にランタイムがなく 16 件の失敗になった。利用者と同じく、導入したコマンド（`<install>/versions/<version>/aidlc`）で Doctor・フック・版の確認を動かすように直した（実行ファイルは公式資産と同じハッシュ）。

2.11.2 の Doctor は、Windows でプロジェクトフォルダーが 75 文字以上だと警告する（AI-DLC の記録でさらに約 185 文字増えるため）。CI の採取先（`C:\Users\runneradmin\AppData\Local\Temp\aidlc-doctor-capture-…`）では healthy シナリオが警告になったため、採取先をランナーの一時フォルダー（`RUNNER_TEMP`）と短い接頭辞 `adc-` に変えた。正規化後の出力は Linux・macOS では変わらない。

古い更新確認は `Update: binary X, latest known Y, checked N days ago` と経過日数を示すようになった。warning シナリオの確認日時を固定日（2000-01-01）から採取時点の 30 日前に変え、再採取しても同じ出力になるようにした。

新しい診断の日本語訳を追加した（更新確認の経過日数と、チャンネルの経過日数つきの表示、ランタイムにないフックとその対処、別のクローンで進んだ作業の警告と対処、Kiro CLI Workflows、Windows のプロジェクトフォルダーの深さと対処、doctor 自身の監査記録以外に未コミットの変更がない場合）。

Linux の 9 ケースを手元で採取し、依存ソースの指紋（70 ファイルの変更を確認）と共に 2.11.2 の契約として登録した。Windows と macOS は作業ブランチで doctor-record を実行して採取・登録する。出力の捏造や旧版 fixture の版番号だけの置換は行っていない。

## 文書

- 英語 66 ページを同期し、新規 1 ページ（2.11.2 の更新履歴）を追加。日本語は変更のあった全ページを英語の差分と照合して更新し、2.11.2 の更新履歴と改善点ガイドを追加した。
- 各ページで見出し数・表の行数・コードフェンス数を英語と照合した。
- `official-docs.translations.json`（人間の翻訳承認）は変更していない。
