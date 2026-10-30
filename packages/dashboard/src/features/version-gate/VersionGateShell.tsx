import {
  VERSION_GATE_ACTIONS,
  type VersionGate,
  type VersionGateAction,
  versionGateActionLabel,
  versionGateRollbackGuide,
} from "@aidlc-guide/shared-types";
import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocsShell } from "@/features/docs/DocsPage.tsx";
import { inVsCodeWebview, vsCodeApi } from "@/services/vscode-api.ts";
import { AreaBoundary } from "@/shell/AreaBoundary.tsx";
import { useAppState, useDispatch } from "@/store/context.tsx";

/**
 * The whole app while the version check blocks the workspace
 * (docs/maintenance/version-gate-design.md): one action for the situation, and
 * the bundled docs, which do not depend on the project's version.
 */

const TITLES: Record<Exclude<VersionGate["status"], "ok">, string> = {
  "project-older": "プロジェクトの更新が必要です",
  "project-newer": "Andon の更新が必要です",
  "engine-mismatch": "この PC への aidlc の導入が必要です",
  "engine-newer": "プロジェクトのバージョンの固定が必要です",
  unknown: "バージョンを確認できません",
  "not-installed": "aidlc-workflows のセットアップが必要です",
};

/** What the action does to files other people share — the reason to commit, or not. */
function actionNote(action: VersionGateAction, gate: VersionGate): string | null {
  switch (action) {
    case "update-project":
      return "更新すると .claude/ や .aidlc-version など、リポジトリで共有するファイルが変わります。変わるファイルは実行前に確認でき、更新後はコミットが必要です。チームのメンバーは pull した後、Andon の案内に従えば揃えられます。";
    case "install-engine":
      return "共有するファイルは変わりません。この PC だけに導入します。";
    case "pin-project":
      return `固定すると .aidlc-version が作られ、このプロジェクトは ${gate.target} で動きます。リポジトリで共有するファイルなのでコミットが必要です。この PC の既定バージョンはそのまま使えます。既定を ${gate.target} に戻す方法も、更新画面から選べます（固定していない他のプロジェクトにも影響します）。`;
    case "update-guide":
      return "対応する Andon が出ていれば、更新すると使えるようになります。Andon がプロジェクトを古いバージョンに戻すことはありません。";
    default:
      return null;
  }
}

function GateNotice({ gate, onRecheck }: { gate: VersionGate; onRecheck: () => void }): ReactNode {
  const heading = useRef<HTMLHeadingElement>(null);
  const dispatch = useDispatch();
  const inIde = inVsCodeWebview();
  const status = gate.status === "ok" ? "unknown" : gate.status;
  const action = VERSION_GATE_ACTIONS[status];
  const note = actionNote(action, gate);
  const rollback = versionGateRollbackGuide(gate);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 p-4 wrap-anywhere"
      aria-labelledby="version-gate-heading"
      data-testid="version-gate"
      data-status={gate.status}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h1
              id="version-gate-heading"
              className="text-xl font-medium"
              ref={heading}
              tabIndex={-1}
            >
              {TITLES[status]}
            </h1>
          </CardTitle>
          <CardDescription role="status">{gate.message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1" aria-label="バージョン">
            <dt>Andon の対応版</dt>
            <dd>{gate.target}</dd>
            {gate.tools.map((tool) => (
              <div key={tool.id} className="contents">
                <dt>{tool.label}</dt>
                <dd>{tool.version ?? "確認できません"}</dd>
              </div>
            ))}
            {gate.pin === null ? null : (
              <>
                <dt>固定バージョン（.aidlc-version）</dt>
                <dd>{gate.pin}</dd>
              </>
            )}
            {gate.native ? (
              <>
                <dt>この PC のエンジン</dt>
                <dd>{gate.engine ?? "未導入"}</dd>
              </>
            ) : null}
          </dl>
          {note === null ? null : <p>{note}</p>}
          {rollback === null ? null : (
            <section
              className="flex flex-col gap-2"
              aria-labelledby="version-gate-rollback-heading"
              data-testid="version-gate-rollback"
            >
              <h2 id="version-gate-rollback-heading" className="font-medium">
                {rollback.heading}
              </h2>
              {rollback.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {rollback.commands.length === 0 ? null : (
                <pre className="rounded-md bg-muted p-3 whitespace-pre-wrap">
                  <code>{rollback.commands.join("\n")}</code>
                </pre>
              )}
            </section>
          )}
          {inIde ? null : (
            <p>
              更新は VS Code / Cursor の Andon から行います。IDE
              でこのプロジェクトを開き、表示される案内に従ってください。
            </p>
          )}
          <p>更新が終わるまでは、同梱のドキュメントだけを読めます。</p>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {inIde ? (
            <Button
              type="button"
              data-testid="version-gate-action"
              onClick={() => vsCodeApi()?.postMessage({ type: "version-gate-action", action })}
            >
              {versionGateActionLabel(action, gate.target)}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onRecheck}>
            状態を再確認
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => dispatch({ type: "docs-shell", open: true })}
          >
            ドキュメントを読む
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

export function VersionGateShell({
  gate,
  onRecheck,
}: {
  gate: VersionGate;
  onRecheck: () => void;
}): ReactNode {
  const { route } = useAppState();
  const dispatch = useDispatch();
  const reading = route.name === "docs";

  // Coming back to the window after updating elsewhere re-checks on its own.
  useEffect(() => {
    window.addEventListener("focus", onRecheck);
    return () => window.removeEventListener("focus", onRecheck);
  }, [onRecheck]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden" data-testid="version-gate-shell">
      <header className="flex items-center gap-2 border-b p-2">
        <span className="font-medium">Andon</span>
        <nav aria-label="ブロック中に使える画面" className="ml-auto flex gap-1">
          <Button
            type="button"
            variant={reading ? "ghost" : "secondary"}
            aria-current={reading ? undefined : "page"}
            onClick={() => dispatch({ type: "home" })}
          >
            更新の案内
          </Button>
          <Button
            type="button"
            variant={reading ? "secondary" : "ghost"}
            aria-current={reading ? "page" : undefined}
            onClick={() => dispatch({ type: "docs-shell", open: true })}
          >
            ドキュメント
          </Button>
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {reading ? null : <GateNotice gate={gate} onRecheck={onRecheck} />}
        <AreaBoundary name="docs-shell">
          <DocsShell />
        </AreaBoundary>
      </div>
    </div>
  );
}
