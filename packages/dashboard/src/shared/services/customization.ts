import type {
  CustomizationCatalog,
  CustomizationDiagnostic,
  CustomizationEditRequest,
  CustomizationExport,
  CustomizationImportPlan,
  CustomizationImportSelection,
  CustomizationItem,
  CustomizationOperation,
  CustomizationRequestReceipt,
  CustomizationResult,
  CustomizationSaveRequest,
} from "@andon/shared-types";
import { getTransport } from "@/services/transport/index.ts";

const ROOT = "/api/customization";
export const customizationRequestId = () => `${Date.now()}-${crypto.randomUUID()}`;

export class CustomizationError extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly requestId?: string,
    readonly diagnostics?: CustomizationDiagnostic[],
  ) {
    super(message);
  }
}

function unwrap<T>(body: unknown): T {
  if (!body || typeof body !== "object")
    throw new CustomizationError("unavailable", "カスタマイズ機能に接続できませんでした。");
  const result = body as CustomizationResult<T>;
  if ("ok" in result && result.ok === true) return result.value;
  if ("reason" in result)
    throw new CustomizationError(
      result.reason,
      result.message || result.reason,
      undefined,
      result.diagnostics,
    );
  throw new CustomizationError(
    "unavailable",
    "カスタマイズ機能を利用できません。Andonを更新してください。",
  );
}

async function get<T>(route: string): Promise<T> {
  const response = await getTransport().getJson(`${ROOT}${route}`);
  if (!response.reached)
    throw new CustomizationError("unavailable", "接続できませんでした。入力は保持しています。");
  return unwrap<T>(response.body);
}

async function post<T>(route: string, body: object): Promise<T> {
  const response = await getTransport().postJson(`${ROOT}${route}`, body);
  if (response.status === 0)
    throw new CustomizationError(
      "response-unknown",
      "受付結果を確認できません。入力を保持して、同じ操作の結果を再確認してください。",
    );
  try {
    return unwrap<T>(response.body);
  } catch (error) {
    if (
      error instanceof CustomizationError &&
      "requestId" in body &&
      typeof body.requestId === "string"
    )
      throw new CustomizationError(error.reason, error.message, body.requestId, error.diagnostics);
    throw error;
  }
}

export const customizationApi = {
  catalog: (space?: string) =>
    get<CustomizationCatalog>(space ? `?space=${encodeURIComponent(space)}` : ""),
  save: (body: CustomizationSaveRequest) => post<CustomizationOperation>("/save", body),
  operation: (id: string) => get<CustomizationOperation>(`/operation?id=${encodeURIComponent(id)}`),
  pendingOperation: () => get<CustomizationOperation | null>("/operation"),
  importAnalyze: (body: CustomizationEditRequest & { package: unknown }) =>
    post<CustomizationImportPlan>("/import/analyze", body),
  importAdopt: (
    body: CustomizationEditRequest & { planId: string; selections: CustomizationImportSelection[] },
  ) => post<CustomizationItem[]>("/import/adopt", body),
  export: (
    body: CustomizationEditRequest & {
      format: "guide" | "plugin";
      itemIds: string[];
      name: string;
      version: string;
      excludeUnsupported?: boolean;
      harnesses?: string[];
    },
  ) =>
    post<CustomizationExport>("/export", {
      ...body,
      selectedItemIds: body.itemIds,
      confirmedOmissions: body.excludeUnsupported,
    }),
  request: (id: string) =>
    get<CustomizationRequestReceipt | null>(`/request?id=${encodeURIComponent(id)}`),
  recover: (operationId: string) => post<CustomizationOperation>("/recover", { operationId }),
};

export type CustomizationApi = typeof customizationApi;

export function downloadCustomization(file: CustomizationExport): void {
  const data =
    file.encoding === "base64"
      ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
      : file.content;
  const url = URL.createObjectURL(new Blob([data], { type: file.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
