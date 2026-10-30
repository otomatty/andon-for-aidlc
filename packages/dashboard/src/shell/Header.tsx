import { unseenNews, WHATS_NEW } from "@andon/shared-types";
import {
  BookOpenIcon,
  ChartNoAxesCombinedIcon,
  CompassIcon,
  GripIcon,
  HomeIcon,
  LinkIcon,
  MegaphoneIcon,
  PuzzleIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isExternal, safeHref, useProjectLinks } from "@/services/docs.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { viewValue } from "@/store/state.ts";
import { IntentPicker } from "./IntentPicker.tsx";
import { SpacePicker } from "./SpacePicker.tsx";
import { LiveStatus } from "./LiveStatus.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

/** Shared app shell — stays mounted on home, stage detail, and guides routes. */
export function Header(): ReactNode {
  const state = useAppState();
  const dispatch = useDispatch();
  useProjectLinks();
  const links = (viewValue(state.projectLinks) ?? []).flatMap((link) => {
    const href = safeHref(link.target);
    return href === null ? [] : [{ ...link, href }];
  });
  const onHome = state.route.name === "home";
  // Only the IDE keeps onboarding progress; the browser shows no unseen mark.
  const { record } = state.onboarding;
  const unseen = record === null ? 0 : unseenNews(WHATS_NEW, record).length;

  const destinations = [
    {
      id: "home",
      testId: "header-home",
      label: "ステージ一覧",
      icon: HomeIcon,
      active: onHome,
      onClick: () => dispatch({ type: "home" }),
    },
    {
      id: "effectiveness",
      testId: "effectiveness-open",
      label: "効果測定",
      icon: ChartNoAxesCombinedIcon,
      active: state.route.name === "effectiveness",
      onClick: () => dispatch({ type: "effectiveness", open: true }),
    },
    {
      id: "docs",
      testId: "official-docs-open",
      label: "ドキュメント",
      icon: BookOpenIcon,
      active: state.route.name === "docs",
      onClick: () => dispatch({ type: "docs-shell", open: true }),
    },
    {
      id: "plugins",
      testId: "plugins-open",
      label: "プラグイン",
      icon: PuzzleIcon,
      active: state.route.name === "plugins",
      onClick: () => dispatch({ type: "plugins", open: true }),
    },
    {
      id: "customization",
      testId: "customization-open",
      label: "カスタマイズ",
      icon: SlidersHorizontalIcon,
      active: state.route.name === "customization",
      onClick: () => dispatch({ type: "customization", open: true }),
    },
    {
      id: "settings",
      testId: "settings-open",
      label: "設定",
      icon: SettingsIcon,
      active: state.route.name === "settings",
      onClick: () => dispatch({ type: "settings", open: true }),
    },
  ];

  return (
    <header className="z-50 flex min-w-0 shrink-0 items-start gap-3 border-b bg-background px-4 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <SpacePicker />
        <div className="min-w-0 max-w-full flex-1">
          <IntentPicker />
        </div>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 wrap-anywhere">
          <LiveStatus live={state.live} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <DropdownMenu position="bottom-end" width={288}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                data-testid="header-menu-trigger"
                aria-label="メニュー"
                aria-describedby={unseen > 0 ? "header-menu-news" : undefined}
                className="relative"
              />
            }
          >
            <GripIcon />
            {unseen > 0 ? (
              <span
                aria-hidden="true"
                data-testid="header-menu-news-dot"
                className="absolute top-1 right-1 size-2 rounded-full bg-primary"
              />
            ) : null}
          </DropdownMenuTrigger>
          {unseen > 0 ? (
            <span id="header-menu-news" className="sr-only">
              {`新着の更新情報が${unseen}件あります`}
            </span>
          ) : null}
          <DropdownMenuContent className="p-2" aria-label="メニュー">
            <DropdownMenuGroup data-testid="header-nav-grid" className="grid grid-cols-3 gap-1">
              {destinations.map(({ id, testId, label, icon: Icon, active, onClick }) => (
                <DropdownMenuItem
                  key={id}
                  data-testid={testId}
                  data-header-nav={id}
                  aria-current={active ? "page" : undefined}
                  onClick={onClick}
                  variant="tile"
                >
                  <Icon className="size-7" />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>ヘルプ</DropdownMenuLabel>
              <DropdownMenuItem
                data-testid="welcome-open"
                aria-current={state.route.name === "welcome" ? "page" : undefined}
                onClick={() => dispatch({ type: "welcome", open: true })}
              >
                <CompassIcon />
                はじめに
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="whats-new-open"
                onClick={() => dispatch({ type: "whats-new", open: true })}
              >
                <MegaphoneIcon />
                更新情報
                {unseen > 0 ? (
                  <span className="ml-auto">
                    <Badge>{`新着 ${unseen}`}</Badge>
                  </span>
                ) : null}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {links.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>プロジェクトリンク</DropdownMenuLabel>
                  {links.map((link) => (
                    <DropdownMenuItem
                      key={`${link.label}:${link.href}`}
                      render={
                        <a
                          href={link.href}
                          rel="noopener noreferrer"
                          {...(isExternal(link.href) ? { target: "_blank" } : {})}
                        />
                      }
                    >
                      <LinkIcon />
                      <span className="min-w-0 wrap-anywhere">{link.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
