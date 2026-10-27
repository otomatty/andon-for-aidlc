import { WORKFLOWS_TARGET_VERSION, type WorkflowsManagementState } from "@aidlc-guide/shared-types";
import { DownloadIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { inVsCodeWebview, vsCodeApi } from "@/services/vscode-api.ts";

/** 初回の環境構築と、利用開始後の更新・ツール追加を分ける設定ページ。 */
export function SettingsPage(): ReactNode {
  const inIde = inVsCodeWebview();
  const heading = useRef<HTMLHeadingElement>(null);
  const [workflows, setWorkflows] = useState<WorkflowsManagementState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inIde) return;
    const receive = ({ data }: MessageEvent) => {
      if (data?.type === "workflows-management" && Array.isArray(data.state?.tools)) {
        setWorkflows(data.state);
        setError(null);
      }
      if (data?.type === "workflows-management-error" && typeof data.message === "string")
        setError(data.message);
    };
    window.addEventListener("message", receive);
    const refresh = () => vsCodeApi()?.postMessage({ type: "get-workflows-management" });
    window.addEventListener("focus", refresh);
    refresh();
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("focus", refresh);
    };
  }, [inIde]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6 p-4 wrap-anywhere"
      aria-labelledby="settings-heading"
      data-testid="settings-page"
    >
      <h1 id="settings-heading" className="text-page-title font-bold" ref={heading} tabIndex={-1}>
        設定
      </h1>
      <section aria-labelledby="settings-setup-title">
        <Card size="lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <IconTile>
                <DownloadIcon />
              </IconTile>
              <h2 id="settings-setup-title">セットアップ</h2>
            </CardTitle>
            <CardDescription>
              {inIde
                ? "初めてAI-DLCを使う方や、既存プロジェクトに参加する方のために、このマシンのCLIと作業環境を準備します。"
                : "セットアップはVS Code / Cursorの拡張機能で行います。IDEで対象のプロジェクトを開き、AIDLC Guideの設定からセットアップしてください。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>CLIの導入、プロジェクトの準備、Doctorによる確認を進めます。</p>
          </CardContent>
          {inIde ? (
            <CardFooter>
              <Button
                type="button"
                onClick={() => vsCodeApi()?.postMessage({ type: "open-workflows-setup" })}
              >
                セットアップを開く
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      </section>
      <section aria-labelledby="settings-workflows-update-title">
        <Card size="lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <IconTile>
                <RefreshCwIcon />
              </IconTile>
              <h2 id="settings-workflows-update-title">更新・修復</h2>
            </CardTitle>
            <CardDescription>
              {inIde
                ? "このマシンのCLIと、リポジトリ内のエンジン・設定をそれぞれ更新できます。AIDLC Guide拡張の更新確認もこちらで行います。"
                : "更新はVS Code / Cursorの拡張機能で行います。IDEでAIDLC Guideを開き、設定から更新画面へ進んでください。"}
            </CardDescription>
          </CardHeader>
          {inIde ? (
            <CardContent className="flex flex-col gap-3">
              <dl className="grid overflow-hidden rounded-md border sm:grid-cols-2">
                <div className="flex flex-col gap-0.5 px-4 py-3">
                  <dt className="text-xs font-semibold text-muted-foreground">更新先バージョン</dt>
                  <dd className="text-base font-bold">
                    {workflows?.target ?? WORKFLOWS_TARGET_VERSION}
                  </dd>
                </div>
                {workflows ? (
                  <div className="flex flex-col gap-0.5 border-t px-4 py-3 sm:border-t-0 sm:border-l">
                    <dt className="text-xs font-semibold text-muted-foreground">
                      対象プロジェクト
                    </dt>
                    <dd className="font-mono text-sm break-all">{workflows.root}</dd>
                  </div>
                ) : null}
              </dl>
              {workflows ? (
                <ul
                  aria-label="設定済みツール"
                  className="m-0 flex list-none flex-wrap gap-1.5 p-0"
                >
                  {workflows.tools.map((tool) => (
                    <li key={tool.id}>
                      <Badge variant="secondary">
                        {tool.label}：{tool.version ?? "確認が必要"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p role="status">{error ?? workflows?.message ?? "設定状態を確認しています…"}</p>
              <p>リポジトリの更新は、このプロジェクトに設定済みのすべてのツールが対象です。</p>
            </CardContent>
          ) : null}
          {inIde ? (
            <CardFooter className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => vsCodeApi()?.postMessage({ type: "open-workflows-update" })}
              >
                更新画面を開く
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => vsCodeApi()?.postMessage({ type: "get-workflows-management" })}
              >
                状態を再確認
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      </section>
      <section aria-labelledby="settings-workflows-tools-title">
        <Card size="lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <IconTile>
                <PlusIcon />
              </IconTile>
              <h2 id="settings-workflows-tools-title">ツール追加</h2>
            </CardTitle>
            <CardDescription>
              {inIde
                ? "設定済みのプロジェクトに、Claude CodeやCursorなどのツールを追加します。追加するツールは複数選べます。"
                : "ツール追加はVS Code / Cursorの拡張機能で行います。IDEで対象のプロジェクトを開き、AIDLC Guideの設定から追加してください。"}
            </CardDescription>
          </CardHeader>
          {inIde ? (
            <CardFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => vsCodeApi()?.postMessage({ type: "open-workflows-install" })}
              >
                ツール追加を開く
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      </section>
    </main>
  );
}
