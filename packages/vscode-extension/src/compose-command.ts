import { PREFLIGHT_TEXT_MAX } from "@andon/shared-types";

/**
 * ターミナルへ送る 1 行コマンドの唯一の組み立て点。webview からはコマンドを
 * 受け取らない（生テキストのみ）— 信頼境界はここ。
 *
 * VS Code の既定シェルは PowerShell / bash / cmd のどれでもありうるので、
 * ネスト引用やシェル別エスケープはせず「シェルが特別扱いする文字を除去した
 * 自然文を一重の二重引用符で包む」に倒す。除去対象:
 *   " ' ` $ \  … bash/PowerShell の引用内展開・エスケープ
 *   %          … cmd の引用内でも効く環境変数展開
 *   !          … bash 対話シェルの履歴展開（引用内でも効く）
 * compose の引数は LLM が読む自然文なので、除去による意味の欠けは軽微。
 */
export function sanitizeComposeText(text: string): string {
  return text
    .replace(/["'`$\\%!]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PREFLIGHT_TEXT_MAX);
}

export function buildComposeCommand(text: string): string | null {
  const clean = sanitizeComposeText(text);
  if (clean === "") return null;
  return `claude "/aidlc compose ${clean}"`;
}
