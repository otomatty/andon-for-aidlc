import { LoadingSequence } from "@/shared/loading/LoadingSequence.tsx";
import { MenuIcon } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { useFetchView } from "@/hooks/useFetchView.ts";
import { fetchGuide, fetchGuides } from "@/services/api.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { viewValue } from "@/store/state.ts";
import { MarkdownSurface } from "@/viewer/lazy-markdown.ts";
import { AreaError } from "@/shared/atoms.tsx";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import { NavigationSkeleton } from "@/shared/loading/NavigationSkeleton.tsx";
import { NavList, NavListButton } from "@/shared/NavList.tsx";
import { PanelShell } from "@/shell/PanelShell.tsx";
import { resolveGuideHref } from "./utils/resolve-guide-href.ts";

export function GuidesPanel(): ReactNode {
  const open = useAppState().route.name === "guides";
  const dispatch = useDispatch();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const listView = useFetchView(open ? fetchGuides : null, [open]);
  const list = listView === null ? null : viewValue(listView);
  const bodyView = useFetchView(open && selected !== null ? () => fetchGuide(selected) : null, [
    open,
    selected,
  ]);
  const doc = bodyView === null ? null : viewValue(bodyView);

  const onClose = (): void => {
    dispatch({ type: "guides", open: false });
  };

  useEffect(() => {
    if (!open) {
      setDrawerOpen(false);
      return;
    }
    // Default to the first guide once the catalogue lands.
    const first = list?.[0]?.name ?? null;
    if (first !== null) setSelected((current) => current ?? first);
  }, [open, list]);

  // The last successfully-loaded title survives while the next guide loads.
  const [title, setTitle] = useState<string>("使い方ガイド");
  useEffect(() => {
    if (doc !== null) setTitle(doc.title);
  }, [doc]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!open || el === null) return;
    const onClick = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (anchor === null) return;
      const href = anchor.getAttribute("href");
      if (href === null || list === null) return;
      const name = resolveGuideHref(href);
      if (name === null) return;
      const match = list.find((guide) => guide.name.toLowerCase() === name.toLowerCase());
      if (match === undefined) return;
      event.preventDefault();
      setSelected(match.name);
    };
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("click", onClick);
    };
  }, [open, list]);

  if (!open) return null;

  const pickGuide = (name: string): void => {
    setSelected(name);
    setDrawerOpen(false);
  };

  return (
    <PanelShell
      headingId="guides-heading"
      testId="guides-panel"
      title={title}
      closeTestId="guides-close"
      onClose={onClose}
      leading={
        <Tooltip label="ガイド一覧">
          <Button
            type="button"
            variant="outline"
            size="icon"
            data-testid="guides-menu"
            aria-label="ガイド一覧"
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setDrawerOpen(true);
            }}
          >
            <MenuIcon />
          </Button>
        </Tooltip>
      }
    >
      {/* Sizes to content so the panel above is what scrolls; the guide list
          lives in the left Sheet, so the page body is markdown only. */}
      <LoadingSequence>
        <div className="min-w-0 flex-none" data-testid="guides-body" ref={bodyRef}>
          {bodyView?.kind === "error" ? (
            <AreaError detail={bodyView.detail} />
          ) : doc === null ? (
            <DocumentSkeleton label="ガイド本文" />
          ) : (
            <Suspense fallback={<DocumentSkeleton label="ガイド本文" />}>
              <MarkdownSurface markdown={doc.markdown} editable={null} />
            </Suspense>
          )}
        </div>
      </LoadingSequence>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" data-testid="guides-drawer" size="min(100%, 20rem)">
          <SheetHeader>
            <SheetTitle>使い方ガイド</SheetTitle>
            <SheetDescription>読みたいガイドを選んでください。</SheetDescription>
          </SheetHeader>
          <nav className="min-h-0 overflow-y-auto px-4 pb-4" aria-label="使い方ガイド一覧">
            {listView?.kind === "error" ? (
              <AreaError detail={listView.detail} />
            ) : list === null ? (
              <NavigationSkeleton label="ガイド一覧" />
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">ガイドがありません。</p>
            ) : (
              <NavList>
                {list.map((guide) => (
                  <li key={guide.name}>
                    <NavListButton
                      data-active={guide.name === selected}
                      data-testid={`guide-item-${guide.name}`}
                      onClick={() => {
                        pickGuide(guide.name);
                      }}
                    >
                      {guide.title}
                    </NavListButton>
                  </li>
                ))}
              </NavList>
            )}
          </nav>
        </SheetContent>
      </Sheet>
    </PanelShell>
  );
}
