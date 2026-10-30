import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { emitOnboardingEvent } from "@/services/onboarding.ts";
import { inVsCodeWebview, vsCodeApi } from "@/services/vscode-api.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { Screenshot } from "./components/Screenshot.tsx";
import { BASICS, CAPTURED_ON, MORE } from "./content/welcome.ts";
import { targetActions } from "./utils/target-actions.ts";

interface WelcomeAction {
  label: string;
  run: () => void;
}

/**
 * The next step depends on what this project can show: a workflow gets the
 * guided tour on real data, a project without work goes to the start form,
 * and anything unreadable falls back to the stage list.
 */
function useWelcomeActions(): { primary: WelcomeAction; secondary: WelcomeAction | null } {
  const { workflow } = useAppState();
  const dispatch = useDispatch();
  const stageList: WelcomeAction = {
    label: "ステージ一覧へ",
    run: () => dispatch({ type: "home" }),
  };
  if (workflow.kind === "success" || workflow.kind === "partial")
    return {
      primary: {
        label: "画面を順に案内してもらう",
        run: () => dispatch({ type: "tour", active: true }),
      },
      secondary: stageList,
    };
  if (workflow.kind === "empty" && workflow.reason === "no-active-intent")
    return {
      primary: {
        label: "最初の作業を始める",
        run: () => {
          dispatch({ type: "home" });
          // The start form mounts once home is un-parked.
          requestAnimationFrame(() => document.getElementById("preflight-text")?.focus());
        },
      },
      secondary: null,
    };
  return { primary: stageList, secondary: null };
}

/** はじめに — what Andon shows, read on a real capture, then tried on real data. */
export default function WelcomePage(): ReactNode {
  const state = useAppState();
  const dispatch = useDispatch();
  const heading = useRef<HTMLHeadingElement>(null);
  const basicsHeading = useRef<HTMLHeadingElement>(null);
  const recorded = useRef(false);
  const [tipsBack, setTipsBack] = useState(false);
  const { primary, secondary } = useWelcomeActions();
  const inIde = inVsCodeWebview();
  const { record } = state.onboarding;
  const hasWorkflow = state.workflow.kind === "success" || state.workflow.kind === "partial";

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  // Having seen the page settles the automatic welcome, and a reader who
  // found it from the menu no longer needs the reminder on the home screen.
  useEffect(() => {
    if (recorded.current || record === null) return;
    recorded.current = true;
    if (record.welcome !== "done")
      emitOnboardingEvent(dispatch, { kind: "welcome", status: "done" });
  }, [record, dispatch]);

  const later = (): void => {
    emitOnboardingEvent(dispatch, { kind: "welcome", status: "deferred" });
    dispatch({ type: "home" });
  };

  const actions = (primaryAction: WelcomeAction, extra?: ReactNode): ReactNode => (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={primaryAction.run}>
        {primaryAction.label}
      </Button>
      {extra}
    </div>
  );

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-10 p-4 wrap-anywhere sm:py-8"
      aria-label="はじめに"
      data-testid="welcome-page"
    >
      <header className="flex flex-col gap-4">
        <p className="text-sm font-semibold text-primary-light-foreground">はじめに</p>
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-page-title font-bold text-balance outline-none"
        >
          AIと進める開発の、現在地と次の一手がわかる。
        </h1>
        <p className="max-w-2xl leading-relaxed text-muted-foreground">
          AIDLC
          Andonでは、AI-DLCの進捗・成果物・進め方をエディター内で確認できます。AIとのチャットで開発を進めながら、ここで状況や確認事項を把握できます。
        </p>
        {actions(
          primary,
          <>
            <Button type="button" variant="ghost" onClick={() => basicsHeading.current?.focus()}>
              画面の見方を見る
            </Button>
            <Button type="button" variant="ghost" onClick={later}>
              あとで読む
            </Button>
          </>,
        )}
      </header>

      <section aria-labelledby="welcome-basics-title" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2
            id="welcome-basics-title"
            ref={basicsHeading}
            tabIndex={-1}
            className="text-section-title font-bold outline-none"
          >
            まず押さえる3つのこと
          </h2>
          <p className="text-sm text-muted-foreground">
            画像は説明用の表示例です。画像の中のボタンは操作できません。
          </p>
        </div>
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          {BASICS.map((shot, index) => (
            <li key={shot.id} className="rounded-md border bg-card p-4 shadow-xs">
              <figure className="m-0 grid gap-4 md:grid-cols-5 md:items-start">
                <div className="md:col-span-3">
                  <Screenshot shot={shot} />
                </div>
                <figcaption className="flex flex-col gap-2 text-sm leading-relaxed md:col-span-2">
                  <h3 className="flex items-center gap-2 text-base font-bold">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
                    >
                      {index + 1}
                    </span>
                    {shot.title}
                  </h3>
                  <p>
                    <span className="font-bold">見る場所：</span>
                    {shot.where}
                  </p>
                  <p>
                    <span className="font-bold">できること：</span>
                    {shot.what}
                  </p>
                  {shot.note === undefined ? null : (
                    <p className="text-muted-foreground">{shot.note}</p>
                  )}
                </figcaption>
              </figure>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="welcome-more-title" className="flex flex-col gap-3">
        <h2 id="welcome-more-title" className="text-section-title font-bold">
          必要になったら使う機能
        </h2>
        <p className="text-sm text-muted-foreground">
          使うときに開けば十分です。項目を選ぶと、画面の例と開き方を表示します。
        </p>
        <div>
          <Accordion variant="contained" multiple>
            {MORE.map((feature) => (
              <AccordionItem key={feature.id} value={feature.id}>
                <AccordionTrigger>
                  <span className="flex min-w-0 flex-col gap-1 pr-2">
                    <span>{feature.title}</span>
                    <span className="font-normal text-muted-foreground">{feature.summary}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-3">
                    <figure className="m-0 flex flex-col gap-2">
                      <Screenshot shot={feature} />
                      <figcaption className="flex flex-col gap-1 text-sm leading-relaxed">
                        <span>
                          {feature.where}
                          {feature.what}
                        </span>
                        {feature.note === undefined ? null : (
                          <span className="text-muted-foreground">{feature.note}</span>
                        )}
                      </figcaption>
                    </figure>
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          for (const action of targetActions(feature.target, hasWorkflow))
                            dispatch(action);
                        }}
                      >
                        {feature.open}
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      <section
        aria-labelledby="welcome-start-title"
        className="flex flex-col gap-3 rounded-md bg-primary-light p-6"
      >
        <h2 id="welcome-start-title" className="text-section-title font-bold">
          自分のプロジェクトで開いてみましょう
        </h2>
        <p className="text-sm leading-relaxed">
          まずは「現在地を見る → 工程の説明を読む → 成果物を開く」を試してください。
        </p>
        {actions(
          primary,
          <>
            {secondary === null ? null : (
              <Button type="button" variant="outline" onClick={secondary.run}>
                {secondary.label}
              </Button>
            )}
            {inIde && !hasWorkflow ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => vsCodeApi()?.postMessage({ type: "open-workflows-setup" })}
              >
                セットアップを確認する
              </Button>
            ) : null}
          </>,
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            type="button"
            variant="link"
            onClick={() => dispatch({ type: "whats-new", open: true })}
          >
            更新情報を見る
          </Button>
          {inIde && record !== null ? (
            <Button
              type="button"
              variant="link"
              onClick={() => {
                emitOnboardingEvent(dispatch, { kind: "tips-reset" });
                setTipsBack(true);
              }}
            >
              画面ごとのヒントをもう一度表示する
            </Button>
          ) : null}
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {tipsBack ? "ヒントをもう一度表示します。各画面を開くと表示されます。" : ""}
        </p>
      </section>

      <footer className="text-xs leading-relaxed text-muted-foreground">
        画像は{CAPTURED_ON}
        時点の実際の画面です。現在の表示と一部異なる場合があります。配色は撮影時の環境のものです。
      </footer>
    </main>
  );
}
