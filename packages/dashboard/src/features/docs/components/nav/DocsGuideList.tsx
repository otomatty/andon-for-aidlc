import type { MarkdownItem } from "@andon/shared-types";
import type { ReactNode } from "react";
import { type ViewState, viewValue } from "@/store/state.ts";
import { AreaError } from "@/shared/atoms.tsx";
import { NavigationSkeleton } from "@/shared/loading/NavigationSkeleton.tsx";
import { NavList, NavListButton } from "@/shared/NavList.tsx";
import {
  type DocsCategory,
  guideCategory,
  WORKFLOW_TIPS_INDEX,
} from "@/features/docs/utils/docs-navigation.ts";

export function DocsGuideList({
  view,
  category,
  selectedGuide,
  onSelectGuide,
}: {
  view: ViewState<MarkdownItem[]> | null;
  category: DocsCategory;
  selectedGuide: string | null;
  onSelectGuide: (name: string) => void;
}): ReactNode {
  const guides = view === null ? null : viewValue(view);
  const entries = guides
    ?.filter((guide) => guideCategory(guide.name) === category)
    .sort(
      (a, b) => Number(b.name === WORKFLOW_TIPS_INDEX) - Number(a.name === WORKFLOW_TIPS_INDEX),
    );
  const label = category === "workflow" ? "運用Tips一覧" : "使い方ガイド一覧";
  return (
    <nav aria-label={label}>
      {view?.kind === "error" ? (
        <AreaError detail={view.detail} />
      ) : entries === undefined ? (
        <NavigationSkeleton label={label} />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {category === "workflow" ? "Tipsがありません。" : "ガイドがありません。"}
        </p>
      ) : (
        <NavList>
          {entries.map((guide) => (
            <li key={guide.name}>
              <NavListButton
                data-active={selectedGuide === guide.name}
                aria-current={selectedGuide === guide.name ? "page" : undefined}
                data-testid={`docs-guide-${guide.name}`}
                onClick={() => onSelectGuide(guide.name)}
              >
                {guide.title}
              </NavListButton>
            </li>
          ))}
        </NavList>
      )}
    </nav>
  );
}
