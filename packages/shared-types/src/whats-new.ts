import type { WhatsNewEntry } from "./onboarding.ts";

/**
 * Andon's own user-facing changes, newest first, shown in the 更新情報
 * sheet and announced after an update.
 *
 * Entries are keyed by id and date rather than by version: the release
 * version is assigned after merge by the bump workflow, so the author of a
 * change cannot know it. Add an entry in the same pull request as the change
 * (docs/maintenance/release-and-sync.md, 「更新情報を書く」); a release:minor
 * or release:major PR that adds no new id here fails the release-labels
 * check. Never rename or reuse a shipped id — stored seen-sets refer to it.
 */
export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    id: "renamed-to-andon",
    date: "2026-10-29",
    title: "名前を「Andon for AI-DLC」に変えました",
    body: "AIDLC Guide は「Andon for AI-DLC」（略して Andon）になりました。アンドンは、現場の状態を一目で示し、人の判断が要るときに人を呼ぶ表示灯です。リポジトリを otomatty/andon-for-aidlc に移し、バージョンは 0.1.0 から数え直します。以前の版からは自動で更新されないため、Releases から VSIX を入れ直してください。",
  },
  {
    id: "unused-features-removed",
    date: "2026-10-29",
    title: "使われていない機能を整理しました",
    body: "ブラウザ版ダッシュボードの提供を終え、拡張だけになりました。「Open in Docs」は常に同梱のドキュメントを開きます（stageDocs / docsBaseUrl は廃止）。State Version 7 の記録は「未対応」と表示します。MCP の用語・ステージ解説ツールは文書の検索・読み取りにまとめました。",
  },
  {
    id: "doc-videos-removed",
    date: "2026-10-29",
    title: "ドキュメントの解説動画をなくしました",
    body: "ドキュメントのページ上部に出ていた解説動画を表示しなくなりました。解説動画パックの拡張を入れている場合は、アンインストールしてかまいません。本文の内容は変わりません。",
  },
  {
    id: "welcome-screenshots-refresh",
    date: "2026-10-29",
    title: "「はじめに」の画像を、今の画面で撮り直しました",
    body: "「はじめに」で見られる画面の例を、新しくなったダッシュボードの画面に差し替えました。拡張の中と同じ表示で撮り、画面だけを大きく写しているので、文字も読みやすくなっています。画像を軽くしたため、拡張のファイルも小さくなりました。",
    action: { label: "はじめにを開く", target: "welcome" },
  },
  {
    id: "docs-chat-screen",
    date: "2026-10-28",
    title: "ドキュメントへの質問を、チャット画面で行えるようにしました",
    body: "「ドキュメント」の「AIに質問する」から、チャットアプリと同じ形の画面で質問できます。入力欄は画面の下に固定し、回答の作成中は進み具合を表示します。回答の番号を押すと、会話の横に出典が開き、根拠の箇所を強調します。トップページに戻っても会話は残り、「前回の会話の続き」から再開できます。「新しい会話」で最初から始められます。",
    action: { label: "ドキュメントを開く", target: "docs" },
  },
  {
    id: "docs-home-for-readers",
    date: "2026-10-28",
    title: "ドキュメントのトップページを、読みたいページへすぐ行ける形にしました",
    body: "「ページを探す」にページ名の一部を入れると、公式ドキュメント・運用Tips・拡張機能の使い方をまとめて探せます。初めての方向けに「はじめて読むなら」で読む順番を示し、「目的から選ぶ」ではユーザーガイドや運用Tipsなどのよく読まれるページを、一覧を開かずに直接開けます。AIへの質問欄はページの下部に移し、見つからなかった言葉をそのまま質問できます。",
    action: { label: "ドキュメントを開く", target: "docs" },
  },
  {
    id: "unified-disclosures",
    date: "2026-10-28",
    title: "開いて閉じる欄の見た目と操作をそろえました",
    body: "効果測定の「記録の内訳」やカスタマイズの「詳細設定」など、開いて閉じる欄を、向きが変わる矢印付きのボタンにそろえました。ステージ一覧では、フェーズの見出しの間を ↑↓ キーで移動できます。プラグインの「追加・変更されるファイル」も、ほかの一覧と同じ枠で表示します。",
  },
  {
    id: "update-repair-plan",
    date: "2026-10-27",
    title: "更新を止めたファイルを、ボタン 1 つで直せるようにしました",
    body: "AI-DLC の更新前のチェックで問題が見つかると、ファイルごとに何が起きたかと直し方を日本語で示し、「自動で直します」「確認してください」「AI が直します」「手で直してください」に分けます。「N 件を直して更新」を押すと、作業用コピーで直して確かめてから、更新まで続けます。AI は答えが決まらないファイルにだけ使い、反映する前に差分を見せます。「AI に聞く」で理由と選び方を尋ねられます。",
  },
  {
    id: "vscode-theme-colors",
    date: "2026-10-27",
    title: "VS Code のカラーテーマの色で表示します",
    body: "ダッシュボードとセットアップ・更新の画面を、VS Code で選んでいるカラーテーマの背景・文字・ボタン・リンクの色で描きます。テーマを切り替えると、画面の色もその場で変わります。",
  },
  {
    id: "update-screen-steps",
    date: "2026-10-27",
    title: "AI-DLC の更新画面を整理しました",
    body: "いまの状態を 1 行で示し、この PC・このプロジェクト・Andon の対応版の 3 つの版を並べます。やることは手順で示し、押すボタンは 1 つだけです。プロジェクトの更新は、この PC への準備と更新前のチェックから、変わったファイルのコミットまで続けて案内します。",
  },
  {
    id: "mantine-look",
    date: "2026-10-27",
    title: "ダッシュボードの見た目を新しくしました",
    body: "ステージ一覧は終わったフェーズを要約にたたみ、工程をタイムラインで示します。現在のステージの項目はカードに、完了は進捗バーで表示します。セットアップと更新の画面も同じ配色にそろえました。",
    action: { label: "ステージ一覧を開く", target: "home" },
  },
  {
    id: "setup-three-steps",
    date: "2026-10-27",
    title: "セットアップ画面を 3 つの手順に整理しました",
    body: "「このマシンの CLI」「プロジェクトの設定」「完了」の順に、いまの手順と押すボタンを 1 つだけ示します。この画面で進めないときは、理由と行き先のボタンを表示します。使うツールの追加は、「完了」の手順の「ツールを追加」から行います。",
  },
  {
    id: "manual-engine-update",
    date: "2026-10-22",
    title: "aidlc を手動で新しくしたときの案内を改善しました",
    body: "この PC の aidlc だけを新しくしても、バージョンを固定したプロジェクトはそのまま使えます。固定していない場合は、更新画面から対応版に固定できます。プロジェクトまで新しくした場合は、対応する Andon があるかと、対応版に戻すコマンドを案内します。プレビュー版も正しく案内します。",
  },
  {
    id: "workflows-2-11-1",
    date: "2026-10-22",
    title: "aidlc-workflows 2.11.1 に対応しました",
    body: "同梱ドキュメントと導入・更新の対象を 2.11.1 にそろえ、変更のあった日本語ページも更新しました。対応版が変わるため、各プロジェクトの更新が必要です。Space の切り替えはツールのルールファイルを書き換えず、Git の対象外の手順のコピーを更新します。主な変更は「ドキュメント」の更新のハイライトで確認できます。",
    action: { label: "ドキュメントを開く", target: "docs" },
  },
  {
    id: "plugins-page",
    date: "2026-10-15",
    title: "プラグインで、決まった進め方を追加できます",
    body: "右上のメニューに「プラグイン」を追加しました。同梱の focus は、Jira のチケットからテストを先に書いて実装まで進め、成果物を AI が描いた図で説明します。導入前に、必要な準備と変わるステージを確認できます。導入・無効化は VS Code / Cursor の拡張から行います。",
    action: { label: "プラグインを開く", target: "plugins" },
  },
  {
    id: "artifact-svg-diagrams",
    date: "2026-10-15",
    title: "成果物の SVG の図をダッシュボードで表示します",
    body: "成果物と同じフォルダーにある SVG の図を、説明の文字ではなく図として表示します。図はこのパソコンの成果物から読み込み、外部には接続しません。それ以外の画像は、これまでどおり説明の文字だけを表示します。",
  },
  {
    id: "unit-progress-rail",
    date: "2026-10-14",
    title: "ステージ一覧で Unit ごとの進み具合が分かるようになりました",
    body: "Construction の進め方に合わせて表示します。stage-major では、各ステージの行に Unit ごとの状態と「何 Unit 完了」を表示します。unit-major では Unit ごとにまとめ、作業中の Unit とその手順を開いて示します。現在のステージの欄にも、作業中の Unit を表示します。",
  },
  {
    id: "space-switch",
    date: "2026-10-14",
    title: "Andon から Space を切り替えられます",
    body: "画面上部の Space から、既存の作業スペースと使用するツールを選べます。切り替えると、そのスペースのインテント・成果物・作業時間を読み直します。",
  },
  {
    id: "stage-model-badges-steady",
    date: "2026-10-14",
    title: "ステージ一覧のモデル表示がちらつかなくなりました",
    body: "ホームのステージ一覧で、担当・レビュワー・補助のモデル表示が定期的な更新のたびに「読み込み中」に切り替わったり消えたりしなくなりました。新しい情報が届くまで、直前の表示をそのまま残します。",
  },
  {
    id: "workflows-2-11",
    date: "2026-10-09",
    title: "aidlc-workflows 2.11.0 に対応しました",
    body: "同梱ドキュメントと導入・更新の対象を 2.11.0 にそろえ、未翻訳だったページも日本語にしました。進行中の作業があってもツールの追加・更新ができ、作業はそのまま続けられます。Windows で管理者として実行している場合は、導入前に警告を表示して確認します。主な変更は「ドキュメント」の更新のハイライトで確認できます。",
    action: { label: "ドキュメントを開く", target: "docs" },
  },
  {
    id: "version-check",
    date: "2026-10-09",
    title: "対応版と違うプロジェクトでは更新画面を表示します",
    body: "プロジェクトやエンジンのバージョンが Andon の対応版（aidlc-workflows 2.11.0）と違う場合、ダッシュボードの代わりに「バージョン確認」の画面を表示し、必要な更新を一つずつ案内します。更新が済むまでは、更新・セットアップ画面、同梱ドキュメント、Doctor と修復だけを使えます。",
  },
  {
    id: "remove-sharing-btw",
    date: "2026-10-02",
    title: "LAN共有とサイド質問コマンドをやめました",
    body: "Ask (btw)、Ask one-shot、Share on LAN と --host による LAN 公開を削除しました。ダッシュボードはこれまでどおりこのマシンの 127.0.0.1 で開き、ファイルの変更は画面に反映されます。ドキュメントの閲覧と質問、MCP の登録、AI-DLC の起動もそのまま使えます。",
    action: { label: "ドキュメントを開く", target: "docs" },
  },
  {
    id: "aidlc-workflows-tips",
    date: "2026-09-30",
    title: "AI-DLCの運用Tipsを読めるようになりました",
    body: "「ドキュメント」の「運用Tips」から、ルールの読み込み、hooksの復旧、Boltの進め方などを記事ごとに読めます。関連記事へのリンクや5 Boltの図解、2.8.1・2.10.0の違いも掲載しています。",
    action: { label: "ドキュメントを開く", target: "docs" },
  },
  {
    id: "timings-on-open",
    date: "2026-09-27",
    title: "開いた直後から作業時間が表示されます",
    body: "ダッシュボードを開いたとき、ステージの所要時間と現在の作業時間が、接続を待たずに表示されます。",
  },
  {
    id: "onboarding",
    date: "2026-09-25",
    title: "はじめにページと更新情報を追加しました",
    body: "右上のメニューから「はじめに」と「更新情報」を開けます。はじめにでは主な画面の見方を紹介し、実際の画面を順に案内するツアーも始められます。",
    action: { label: "はじめにを開く", target: "welcome" },
    spotlight: {
      area: "home",
      text: "右上のメニューに「はじめに」と「更新情報」を追加しました。画面の見方をいつでも確認できます。",
    },
  },
  {
    id: "docs-chat",
    date: "2026-09-25",
    title: "ドキュメントへの質問を会話で続けられます",
    body: "「ドキュメント」の質問欄で、前の回答を踏まえて続けて質問できます。会話はこのマシンに保存され、パネルを開き直しても続きから読めます。",
    action: { label: "ドキュメントを開く", target: "docs" },
    spotlight: {
      area: "docs",
      text: "質問欄が会話形式になりました。前の回答を踏まえて続けて質問できます。",
    },
  },
  {
    id: "workflows-2-10",
    date: "2026-09-24",
    title: "aidlc-workflows 2.10.0 に対応しました",
    body: "同梱ドキュメントと、インストール・更新の導入先を 2.10.0 にそろえました。主な変更は「ドキュメント」の更新のハイライトで確認できます。",
    action: { label: "ドキュメントを開く", target: "docs" },
  },
  {
    id: "stage-detail-tabs",
    date: "2026-09-24",
    title: "ステージ詳細を「概要」と「時間」のタブに分けました",
    body: "工程の説明と時間の内訳をタブで切り替えられます。前後の工程へは、パネル上部の矢印で移動します。",
    action: { label: "ステージ一覧を開く", target: "home" },
  },
  {
    id: "newest-intents-first",
    date: "2026-09-24",
    title: "インテントを新しい順に並べました",
    body: "インテントの一覧と効果測定の一覧を新しい順に表示し、最近の作業を見つけやすくしました。",
  },
  {
    id: "update-repair-ai",
    date: "2026-09-23",
    title: "更新できない設定の競合を AI で解消できます",
    body: "更新画面で設定の競合が見つかったとき、「AIで修正して更新」から修正と更新をまとめて進められます。診断は画面を開くと自動で始まります。",
    action: { label: "設定を開く", target: "settings" },
  },
];
