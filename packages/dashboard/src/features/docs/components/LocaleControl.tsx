import type { OfficialDocsLocale } from "@andon/shared-types";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface LocaleControlProps {
  locale: OfficialDocsLocale;
  onChange: (locale: OfficialDocsLocale) => void;
}

function otherLocale(locale: OfficialDocsLocale): OfficialDocsLocale {
  switch (locale) {
    case "ja":
      return "en";
    case "en":
      return "ja";
    default: {
      const _exhaustive: never = locale;
      return _exhaustive;
    }
  }
}

/** Single toggle: visible current locale (NFR-7); aria-label is the switch action. */
export function LocaleControl({ locale, onChange }: LocaleControlProps): ReactNode {
  const next = otherLocale(locale);
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      data-testid="locale-control"
      data-locale={locale}
      aria-label={next === "en" ? "英語に切り替え" : "日本語に切り替え"}
      onClick={() => {
        onChange(next);
      }}
    >
      {locale.toUpperCase()}
    </Button>
  );
}
