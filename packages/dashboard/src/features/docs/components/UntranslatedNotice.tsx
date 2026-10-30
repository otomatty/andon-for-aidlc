import type { OfficialDocsPageNotice } from "@andon/shared-types";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface UntranslatedNoticeProps {
  notice: OfficialDocsPageNotice | undefined;
}

/** Shown when ja was requested but the en body was served (US-04). */
export function UntranslatedNotice({ notice }: UntranslatedNoticeProps): ReactNode {
  if (notice !== "missing_ja") return null;
  return (
    <Alert role="status" data-testid="untranslated-notice" className="mb-4">
      <AlertTitle>日本語訳がありません</AlertTitle>
      <AlertDescription>
        このページはまだ日本語に翻訳されていないため、英語版を表示しています。
      </AlertDescription>
    </Alert>
  );
}
