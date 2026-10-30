import type { MarkdownItem, OfficialDocsToc } from "@aidlc-guide/shared-types";
import { type ReactNode, useMemo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import { type ViewState, viewValue } from "@/store/state.ts";
import { AreaError } from "@/shared/atoms.tsx";
import { NavigationSkeleton } from "@/shared/loading/NavigationSkeleton.tsx";
import { NavList, NavListButton } from "@/shared/NavList.tsx";
import { DocsToc } from "./DocsToc.tsx";
import { DocsGuideList } from "./DocsGuideList.tsx";
import {
  type DocsCategory,
  guideCategory,
  isReleaseDoc,
  officialToc,
  releaseEntries,
  releaseTitle,
} from "@/features/docs/utils/docs-navigation.ts";

interface DocsNavigationProps {
  category: DocsCategory;
  onCategoryChange: (category: DocsCategory) => void;
  tocView: ViewState<OfficialDocsToc> | null;
  guidesView: ViewState<MarkdownItem[]> | null;
  selectedPath: string | null;
  selectedGuide: string | null;
  onSelectPath: (path: string) => void;
  onSelectGuide: (name: string) => void;
}

export function DocsNavigation({
  category,
  onCategoryChange,
  tocView,
  guidesView,
  selectedPath,
  selectedGuide,
  onSelectPath,
  onSelectGuide,
}: DocsNavigationProps): ReactNode {
  const toc = tocView === null ? null : viewValue(tocView);
  const official = useMemo(() => (toc === null ? null : officialToc(toc)), [toc]);
  const releases = useMemo(() => (toc === null ? [] : releaseEntries(toc)), [toc]);
  const workflowSection =
    selectedGuide !== null && guideCategory(selectedGuide) === "workflow"
      ? "tips"
      : isReleaseDoc(selectedPath ?? "")
        ? "releases"
        : "official";

  return (
    <Tabs
      variant="segmented"
      value={category}
      onValueChange={(value) => {
        if (value === "workflow" || value === "extension") {
          onCategoryChange(value);
        }
      }}
      className="min-h-0 flex-1 gap-4"
    >
      <div className="px-4">
        <TabsList aria-label="ドキュメントの種類" className="grid w-full grid-cols-2">
          <TabsTrigger value="workflow" className="h-auto min-h-10 min-w-0 whitespace-normal">
            ワークフロー
          </TabsTrigger>
          <TabsTrigger value="extension" className="h-auto min-h-10 min-w-0 whitespace-normal">
            拡張機能
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsPanel value="workflow" className="min-h-0 overflow-y-auto pb-4">
        <p className="mb-3 px-4 text-sm text-muted-foreground">
          aidlc-workflows の公式ドキュメント、更新履歴、運用Tipsを調べる。
        </p>
        <Accordion
          key={workflowSection}
          variant="contained"
          defaultValue={[workflowSection]}
          className="px-4"
        >
          <AccordionItem value="official">
            <AccordionTrigger>公式ドキュメント</AccordionTrigger>
            <AccordionContent>
              {tocView?.kind === "error" ? (
                <AreaError detail={tocView.detail} />
              ) : official === null ? (
                <NavigationSkeleton label="公式ドキュメント一覧" />
              ) : (
                <DocsToc tree={official} selectedPath={selectedPath} onSelect={onSelectPath} />
              )}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="releases">
            <AccordionTrigger>更新履歴</AccordionTrigger>
            <AccordionContent>
              <nav aria-label="更新履歴一覧">
                {tocView?.kind === "error" ? (
                  <AreaError detail={tocView.detail} />
                ) : toc === null ? (
                  <NavigationSkeleton label="更新履歴一覧" />
                ) : releases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">更新履歴がありません。</p>
                ) : (
                  <NavList>
                    {releases.map((entry) => (
                      <li key={entry.id}>
                        <NavListButton
                          data-active={selectedPath === entry.path}
                          aria-current={selectedPath === entry.path ? "page" : undefined}
                          data-testid={`docs-toc-${entry.path}`}
                          onClick={() => onSelectPath(entry.path)}
                        >
                          {releaseTitle(entry.path) ?? entry.title}
                        </NavListButton>
                      </li>
                    ))}
                  </NavList>
                )}
              </nav>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="tips">
            <AccordionTrigger>運用Tips</AccordionTrigger>
            <AccordionContent>
              <DocsGuideList
                view={guidesView}
                category="workflow"
                selectedGuide={selectedGuide}
                onSelectGuide={onSelectGuide}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </TabsPanel>
      <TabsPanel value="extension" className="min-h-0 overflow-y-auto px-4 pb-4">
        <p className="mb-3 text-sm text-muted-foreground">
          Andon 拡張機能の導入と操作方法を調べる。
        </p>
        <DocsGuideList
          view={guidesView}
          category="extension"
          selectedGuide={selectedGuide}
          onSelectGuide={onSelectGuide}
        />
      </TabsPanel>
    </Tabs>
  );
}
