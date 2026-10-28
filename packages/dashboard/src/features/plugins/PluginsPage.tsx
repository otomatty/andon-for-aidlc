import {
  BUNDLED_PLUGINS,
  type BundledPlugin,
  type BundledPluginCatalog,
  type BundledPluginRequirement,
  type BundledPluginStage,
  type PluginAction,
  type PluginPrerequisite,
  type PluginStatus,
} from "@aidlc-guide/shared-types";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PanelBody, PanelShell } from "@/shell/PanelShell.tsx";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { svgDataUrl } from "@/viewer/local-image.ts";
import { type PluginsHost, usePluginsHost } from "./usePluginsHost.ts";

/**
 * 「プラグイン」: the AI-DLC plugins the extension ships, shown before anything is installed —
 * what a plugin changes in the workflow, an example of what it produces, who it suits, what it
 * needs, and the files it adds and changes (docs/maintenance/plugins-page-design.md).
 *
 * The catalog is bundled, so the browser shows the same description as the IDE. Only the
 * extension can install, so only in the IDE does the page show each plugin's state in the project
 * and the one action that state allows; the browser offers no button that would do nothing.
 */

const PHASE_LABELS: Record<string, string> = {
  ideation: "Ideation",
  inception: "Inception",
  construction: "Construction",
  operation: "Operation",
};

const ORIGIN_LABELS: Record<BundledPluginStage["origin"], string | null> = {
  plugin: "＋ 追加",
  "core-extended": "△ 手順を追記",
  core: null,
};

const LEVEL_LABELS: Record<BundledPluginRequirement["level"], string> = {
  required: "必須",
  recommended: "推奨",
  info: "参考",
};

function StatusBadge({ plugin }: { plugin: BundledPlugin }): ReactNode {
  return plugin.status === "preview" ? <Badge variant="outline">試験版</Badge> : null;
}

/** Never by color alone: a symbol and words for each state. */
const STATUS_LABELS: Record<PluginStatus, string> = {
  "not-installed": "○ 未導入",
  enabled: "✔ 有効",
  disabled: "⊘ 無効",
  "update-available": "△ 更新あり",
  attention: "！ 要確認",
};

const ACTION_FOR: Record<PluginStatus, PluginAction> = {
  "not-installed": "install",
  enabled: "disable",
  disabled: "enable",
  "update-available": "update",
  attention: "update",
};

const ACTION_LABELS: Record<PluginAction, string> = {
  install: "導入する",
  enable: "有効にする",
  disable: "無効にする",
  update: "更新する",
};

const RUNNING_LABELS: Record<PluginAction, string> = {
  install: "導入しています",
  enable: "有効にしています",
  disable: "無効にしています",
  update: "更新しています",
};

const DONE_LABELS: Record<PluginAction, string> = {
  install: "導入しました",
  enable: "有効にしました",
  disable: "無効にしました",
  update: "更新しました",
};

function projectStatus(host: PluginsHost, name: string): PluginStatus | null {
  return host.state?.plugins.find((plugin) => plugin.name === name)?.status ?? null;
}

function InstallStatus({ host, name }: { host: PluginsHost; name: string }): ReactNode {
  const status = projectStatus(host, name);
  return status === null ? null : (
    <Badge variant={status === "enabled" ? "default" : "secondary"}>{STATUS_LABELS[status]}</Badge>
  );
}

function PluginCard({
  plugin,
  host,
  onOpen,
}: {
  plugin: BundledPlugin;
  host: PluginsHost;
  onOpen: () => void;
}): ReactNode {
  return (
    <Card data-testid={`plugin-card-${plugin.name}`} size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{plugin.title}</span>
          <span className="font-mono text-xs text-muted-foreground">v{plugin.version}</span>
          <StatusBadge plugin={plugin} />
          <InstallStatus host={host} name={plugin.name} />
        </CardTitle>
        <CardDescription>{plugin.tagline}</CardDescription>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`${plugin.title} の詳細`}
            onClick={onOpen}
          >
            詳しく見る
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-section-title font-bold">{title}</h3>
      {children}
    </section>
  );
}

function StageFlow({ stages }: { stages: BundledPluginStage[] }): ReactNode {
  const phases = [...new Set(stages.map((stage) => stage.phase))];
  return (
    <div data-testid="plugin-stages" className="flex flex-col gap-3">
      {phases.map((phase) => (
        <div key={phase} className="flex flex-col gap-1">
          <p className="text-xs font-bold text-muted-foreground">{PHASE_LABELS[phase] ?? phase}</p>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stages
              .filter((stage) => stage.phase === phase)
              .map((stage) => {
                const origin = ORIGIN_LABELS[stage.origin];
                return (
                  <li
                    key={stage.slug}
                    data-origin={stage.origin}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border bg-card px-3.5 py-2.5 text-sm data-[origin=plugin]:border-primary data-[origin=plugin]:bg-primary-light"
                  >
                    <span className="font-bold">{stage.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{stage.slug}</span>
                    <span className="flex-1" />
                    {origin === null ? null : (
                      <Badge variant={stage.origin === "plugin" ? "default" : "secondary"}>
                        {origin}
                      </Badge>
                    )}
                    {stage.perUnit ? <Badge variant="outline">Unit ごと</Badge> : null}
                  </li>
                );
              })}
          </ol>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        ＋ はプラグインが足すステージ、△ は標準のステージにプラグインの手順を追記するステージです。
      </p>
    </div>
  );
}

function FileList({
  value,
  title,
  files,
}: {
  value: string;
  title: string;
  files: string[];
}): ReactNode {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger>
        {title}（{files.length} 件）
      </AccordionTrigger>
      <AccordionContent>
        <ul className="flex flex-col gap-0.5 font-mono text-xs wrap-anywhere">
          {files.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
      </AccordionContent>
    </AccordionItem>
  );
}

const MARKS: Record<string, string> = { true: "✔", false: "✖", null: "？" };

/** One prerequisite as a row of a ruled, striped list. */
const REQUIREMENT_ROW =
  "flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 last:border-b-0 odd:bg-muted/60";

function Prerequisites({
  host,
  items,
}: {
  host: PluginsHost;
  items: PluginPrerequisite[];
}): ReactNode {
  return (
    <ul
      data-testid="plugin-requirements"
      className="m-0 flex list-none flex-col overflow-hidden rounded-md border p-0 text-sm"
    >
      {items.map((item) => (
        <li key={item.id} data-met={String(item.met)} className={REQUIREMENT_ROW}>
          <span
            aria-hidden="true"
            className="w-4 text-center font-bold data-[met=false]:text-destructive data-[met=true]:text-status-done"
            data-met={String(item.met)}
          >
            {MARKS[String(item.met)]}
          </span>
          <Badge variant={item.level === "required" ? "secondary" : "outline"}>
            {LEVEL_LABELS[item.level]}
          </Badge>
          <span>{item.label}</span>
          {item.detail === "" ? null : <span className="text-muted-foreground">{item.detail}</span>}
          {item.action === undefined ? null : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => host.send({ type: item.action as string })}
            >
              開く
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function PluginActions({ plugin, host }: { plugin: BundledPlugin; host: PluginsHost }): ReactNode {
  const { state, progress, result } = host;
  const status = projectStatus(host, plugin.name);
  if (state === null || status === null)
    return (
      <p className="text-sm text-muted-foreground">このプロジェクトでの状態を確かめています…</p>
    );
  const action = ACTION_FOR[status];
  const running = state.running?.name === plugin.name ? state.running : null;
  const unmet = state.prerequisites.filter(
    (item) => item.level === "required" && item.met !== true,
  );
  const detail = state.plugins.find((entry) => entry.name === plugin.name)?.detail;
  const own = result?.name === plugin.name ? result : null;
  return (
    <section
      className="flex flex-col gap-2 rounded-md border bg-card p-4 shadow-xs"
      data-testid="plugin-actions"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>このプロジェクトでは</span>
        <InstallStatus host={host} name={plugin.name} />
        {detail === undefined ? null : <span className="text-muted-foreground">{detail}</span>}
      </div>
      {running === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={action === "disable" ? "outline" : "default"}
            size="sm"
            disabled={!state.canAct}
            onClick={() => {
              host.clearResult();
              host.send({ type: "plugins-action", action, name: plugin.name });
            }}
          >
            {ACTION_LABELS[action]}
          </Button>
          {action === "disable" ? (
            <span className="text-xs text-muted-foreground">
              ファイルは残ります。もう一度有効にすると、すぐに使えます。
            </span>
          ) : null}
          {!state.canAct && unmet.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              必要なものがそろっていないため、操作できません（下の「必要なもの」）。
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="plugin-progress">
          <span role="status">
            {RUNNING_LABELS[running.action]}
            {progress?.name === plugin.name
              ? `（${progress.step} / ${progress.total}）${progress.text}`
              : ""}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => host.send({ type: "plugins-cancel" })}
          >
            取り消す
          </Button>
        </div>
      )}
      {own === null ? null : (
        <div data-testid="plugin-result" className="flex flex-col gap-1.5 text-sm" role="status">
          {own.outcome === "succeeded" ? (
            <>
              <p className="font-medium">{DONE_LABELS[own.action]}</p>
              {own.changedFiles.length === 0 ? null : (
                <>
                  <p className="text-xs text-muted-foreground">変わったファイル</p>
                  <ul className="font-mono text-xs wrap-anywhere">
                    {own.changedFiles.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                    {own.moreFiles > 0 ? <li>ほか {own.moreFiles} 件</li> : null}
                  </ul>
                </>
              )}
              {own.commitMessage === null ? null : (
                <p className="text-xs text-muted-foreground">
                  チームで使うには、変わったファイルをコミットしてください（例:{" "}
                  <code className="font-mono">{own.commitMessage}</code>）。
                </p>
              )}
            </>
          ) : own.outcome === "failed" ? (
            <>
              <p className="text-destructive">{own.message}</p>
              {own.doctor ? (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => host.send({ type: "version-gate-action", action: "doctor" })}
                  >
                    Doctor を開く
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p>取り消しました。</p>
          )}
        </div>
      )}
    </section>
  );
}

function PluginDetail({
  plugin,
  host,
  onBack,
}: {
  plugin: BundledPlugin;
  host: PluginsHost;
  onBack: () => void;
}): ReactNode {
  return (
    <article data-testid={`plugin-detail-${plugin.name}`} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon data-icon="inline-start" />
            一覧に戻る
          </Button>
        </div>
        <h2 className="flex flex-wrap items-center gap-2 text-page-title font-bold">
          <span>{plugin.title}</span>
          <span className="font-mono text-xs text-muted-foreground">v{plugin.version}</span>
          <StatusBadge plugin={plugin} />
        </h2>
        <p className="text-sm">{plugin.tagline}</p>
        <p className="text-sm text-muted-foreground">{plugin.summary}</p>
      </div>

      {host.inIde ? <PluginActions plugin={plugin} host={host} /> : null}

      <Section title="何が変わるか">
        <p className="text-sm text-muted-foreground">
          進め方 <code className="font-mono">{plugin.scope}</code>{" "}
          で実行するステージです（初期化を除く）。
        </p>
        <StageFlow stages={plugin.stages} />
        {plugin.sample === null ? null : (
          <figure className="flex flex-col gap-1">
            <img
              className="viewer__diagram"
              src={svgDataUrl(plugin.sample.svg)}
              alt={plugin.sample.alt}
            />
            <figcaption className="text-xs text-muted-foreground">{plugin.sample.alt}</figcaption>
          </figure>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border bg-card p-4 shadow-xs">
            <p className="mb-2 font-bold text-status-done">合う人</p>
            <ul className="list-disc pl-5 text-sm">
              {plugin.fitFor.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border bg-card p-4 shadow-xs">
            <p className="mb-2 font-bold text-destructive">合わない人</p>
            <ul className="list-disc pl-5 text-sm">
              {plugin.notFitFor.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section title="必要なもの">
        {host.state !== null ? (
          <Prerequisites host={host} items={host.state.prerequisites} />
        ) : (
          <ul
            data-testid="plugin-requirements"
            className="m-0 flex list-none flex-col overflow-hidden rounded-md border p-0 text-sm"
          >
            <li className={REQUIREMENT_ROW}>
              <Badge variant="secondary">必須</Badge> Claude Code（
              <code className="font-mono">.claude</code>）で AI-DLC を使っていること
            </li>
            {plugin.requirements.map((requirement) => (
              <li key={requirement.id} className={REQUIREMENT_ROW}>
                <Badge variant={requirement.level === "required" ? "secondary" : "outline"}>
                  {LEVEL_LABELS[requirement.level]}
                </Badge>{" "}
                {requirement.label}:{" "}
                <span className="text-muted-foreground">{requirement.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="追加・変更されるファイル">
        <div data-testid="plugin-files" className="flex flex-col gap-1.5">
          <Accordion variant="contained" multiple>
            <FileList value="added" title="追加されるファイル" files={plugin.files.added} />
            <FileList value="changed" title="変更されるファイル" files={plugin.files.changed} />
          </Accordion>
          <p className="text-xs text-muted-foreground">
            アプリケーションのコードは変えません。変わるのは AI-DLC の設定（
            <code className="font-mono">.claude/</code>
            ）だけで、AI-DLC の記録（<code className="font-mono">aidlc/</code>
            ）に、プラグインの選択を変えた記録が 1 行残ります。
          </p>
        </div>
      </Section>

      <Section title="始め方">
        <p className="text-sm text-muted-foreground">
          導入した後、Claude Code で次のように始めます。
        </p>
        <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm wrap-anywhere">
          {plugin.startCommand}
        </code>
        {host.inIde ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => host.send({ type: "plugins-copy-start", name: plugin.name })}
            >
              始めるコマンドをコピー
            </Button>
          </div>
        ) : null}
      </Section>
    </article>
  );
}

export function PluginsPanel({
  catalog = BUNDLED_PLUGINS,
}: {
  catalog?: BundledPluginCatalog;
}): ReactNode {
  const dispatch = useDispatch();
  const host = usePluginsHost();
  const [open, setOpen] = useState<string | null>(null);
  const selected = catalog.plugins.find((plugin) => plugin.name === open) ?? null;
  return (
    <PanelShell
      headingId="plugins-heading"
      title="プラグイン"
      headingFont="body"
      testId="plugins-panel"
      returnFocusSelector='[data-testid="header-menu-trigger"]'
      onClose={() => dispatch({ type: "plugins", open: false })}
    >
      <PanelBody>
        <div className="flex flex-wrap items-center gap-x-1 text-sm">
          <p>AI-DLC に、決まった進め方を追加します。</p>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => dispatch({ type: "customization", open: true })}
          >
            自分で作る場合はカスタマイズへ
          </Button>
        </div>
        {host.inIde ? null : (
          <p
            data-testid="plugins-browser-note"
            className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
          >
            導入は VS Code / Cursor の拡張から行えます。ここでは、プラグインの内容を確かめられます。
          </p>
        )}
        {selected !== null ? (
          <PluginDetail plugin={selected} host={host} onBack={() => setOpen(null)} />
        ) : catalog.plugins.length === 0 ? (
          <p data-testid="plugins-empty" className="text-sm text-muted-foreground">
            同梱のプラグインはありません。
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {catalog.plugins.map((plugin) => (
              <PluginCard
                key={plugin.name}
                plugin={plugin}
                host={host}
                onOpen={() => setOpen(plugin.name)}
              />
            ))}
          </div>
        )}
      </PanelBody>
    </PanelShell>
  );
}

export default function PluginsPage(): ReactNode {
  const state = useAppState();
  return state.route.name === "plugins" ? <PluginsPanel /> : null;
}
