# Settings

設定 shows Andon's install/update copy. In the browser dashboard the page is real, but install and update buttons stay in the VS Code / Cursor webview.

## Sub-features

- `settings-open` shows heading `設定` and `[data-testid="settings-page"]`.
- `settings-browser-copy` tells the operator that install happens in the IDE.
- `settings-ide-actions` (extension host only) shows 導入バージョン, インストール・ツール追加, and 更新を確認.

## How to get to it (user POV)

- Header `メニュー` then `設定`.
- In the extension: command `Andon: Setup` is a different wizard; do not treat it as this page unless you are in the Extension Development Host.

## Driving it with the Andon harness

Preconditions:

- Doctor is green; 1280×800 on `{origin}`; this recipe is the **browser** dashboard unless you explicitly launched the extension host.

- **Open settings.** Open `メニュー`, then click menuitem `設定`. `[data-testid="settings-page"]` exists and heading `設定` is focused/visible. Screenshot `settings-page.png`.
- **Read browser copy.** The aidlc-workflows card includes the sentence that install is done in VS Code / Cursor. There is no `更新を確認` button (`check-update`) in this host. That absence is the proof for the browser path.
- **Return home.** Open `メニュー`, then click `ステージ一覧`. Settings unmounts.

Do not mark `settings-ide-actions` verified from this harness. Report it skipped with reason `browser-host`.

## Gotchas

- Seeing the page without the install buttons is correct in dashboard-server. Do not fail the run for missing `check-update`.
- `Andon: Setup` in the command palette is the preflight wizard inside the extension, not this settings route.
- Do not click install/update in a live extension host as part of a default verify run; those mutate the user's tooling install.
