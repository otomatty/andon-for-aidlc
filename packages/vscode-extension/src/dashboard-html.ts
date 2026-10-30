import { readFile } from "node:fs/promises";
import path from "node:path";
import { type ExtensionContext, Uri, type Webview } from "vscode";

export async function loadDashboardHtml(
  webview: Webview,
  context: ExtensionContext,
): Promise<string> {
  const media = path.join(context.extensionPath, "media", "dashboard");
  let html = await readFile(path.join(media, "index.html"), "utf8");

  html = html.replace(/(?:href|src)="(\.?\/[^"]+)"/g, (match, assetPath: string) => {
    const file = path.join(media, assetPath.replace(/^\.\//, ""));
    const uri = webview.asWebviewUri(Uri.file(file));
    const attr = match.startsWith("href") ? "href" : "src";
    return `${attr}="${uri}"`;
  });

  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
  ].join("; ");

  if (!html.includes("Content-Security-Policy")) {
    html = html.replace(
      "<head>",
      `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    );
  }
  return html;
}
