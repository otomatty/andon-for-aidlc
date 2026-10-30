/** Customization transport. Content is source text, including unsaved editor text. */
export type CustomizationKind =
  | "rule-section"
  | "rule-file-metadata"
  | "artifact-template"
  | "knowledge"
  | "stage"
  | "scope"
  | "agent"
  | "sensor"
  | "tool"
  | "plugin";

export type CustomizationTarget = {
  layer?: "org" | "team" | "project" | "phase";
  phase?: string;
  heading?: string;
  knowledgeType?: "team-markdown" | "plugin-markdown" | "document-source" | "document-reference";
  audience?: "all" | string[];
  filename?: string;
  /** Additive standard-plugin contribution; its content uses target/adds/fragments. */
  contributionTo?: string;
};

export type CustomizationItem = {
  id: string;
  kind: CustomizationKind;
  title: string;
  owner: "core" | "plugin" | "project";
  pluginId?: string;
  runtimeId?: string;
  spaceId?: string;
  content: string;
  /** Baseline supplied by the engine; replacing with it removes a core override. */
  originalContent?: string;
  target?: CustomizationTarget;
  binary?: { base64: string; bytes: number; sha256: string; mimeType: string };
  /** Read-only provenance. Incoming edits cannot choose a filesystem path. */
  source?: { relativePath: string; hash: string };
  editable?: boolean;
};

export type CustomizationDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  itemId?: string;
  field?: string;
};

export type CustomizationCapabilities = {
  available: boolean;
  engineVersion: string;
  protocolVersion: number;
  canApply: boolean;
  canExportPlugin: boolean;
  canRecover: boolean;
  reason?: string;
};

export type CustomizationCatalog = {
  workspaceName: string;
  spaceId: string;
  spaces: string[];
  engineVersion: string;
  configurationRevision: string;
  capabilities: CustomizationCapabilities;
  items: CustomizationItem[];
  diagnostics: CustomizationDiagnostic[];
};

export type CustomizationChange =
  | { operation: "create" | "replace"; item: CustomizationItem }
  | { operation: "remove"; itemId: string };

/** Unsaved edits sent explicitly by the current editor; never persisted as a draft. */
export type CustomizationEditRequest = {
  spaceId: string;
  expectedConfigurationRevision: string;
  changes: CustomizationChange[];
};
export type CustomizationSaveRequest = CustomizationEditRequest & { requestId: string };

export type CustomizationFileChange = {
  relativePath: string;
  beforeHash: string | null;
  afterHash: string | null;
  before?: string;
  after?: string;
  itemIds: string[];
  generated?: boolean;
};

export type CustomizationValidation = {
  valid: boolean;
  diagnostics: CustomizationDiagnostic[];
};

export type CustomizationGuidePackage = {
  schemaVersion: 1;
  format: "andon";
  packageId: string;
  name: string;
  version: string;
  engineVersion: string;
  items: CustomizationItem[];
  contentHash: string;
};

export type CustomizationImportEntry = {
  sourceId: string;
  item: CustomizationItem;
  matchId: string | null;
  action: "add" | "replace" | "choose-target";
  candidates: string[];
};

export type CustomizationImportPlan = {
  id: string;
  configurationRevision: string;
  inputHash: string;
  entries: CustomizationImportEntry[];
  diagnostics: CustomizationDiagnostic[];
};

export type CustomizationImportSelection = {
  sourceId: string;
  /** Existing item to replace; null explicitly chooses addition. */
  targetId: string | null;
};

export type CustomizationExport = {
  id: string;
  filename: string;
  mimeType: string;
  encoding: "utf8" | "base64";
  content: string;
  diagnostics: CustomizationDiagnostic[];
};

export type CustomizationOperation = {
  id: string;
  requestId: string;
  status: "running" | "completed" | "failed";
  kind: "apply" | "export" | "recover";
  message?: string;
  configurationRevision?: string;
  transactionId?: string;
  recoveryRequired?: boolean;
  error?: { code: string; message: string };
};

/** Original outcome coordinates remain available after later edits or disposal. */
export type CustomizationRequestReceipt = {
  requestId: string;
  kind: string;
  status: "running" | "completed" | "failed";
  operation?: CustomizationOperation;
};

export type CustomizationResult<T> =
  | { ok: true; value: T }
  | { error: true; reason: string; message: string; diagnostics?: CustomizationDiagnostic[] };
