export type Secret = { id: string; name: string; environmentId: string };
export type Draft = {
  name: string;
  slug: string;
  description: string;
  code: string;
  inputSchema: string;
  outputSchema: string;
  timeoutMs: number;
  enabled: boolean;
  riskLevel: "read" | "write" | "destructive";
  permissions: string[];
  secretGrantIds: string[];
};

export const blank: Draft = {
  name: "",
  slug: "",
  description: "",
  code: 'export default async function handler(ctx: RuntimeContext, input: FunctionInput) {\n  ctx.logger.info("Function invoked", { requestId: ctx.invocation.requestId });\n  return { ok: true };\n}\n',
  inputSchema:
    '{\n  "type": "object",\n  "properties": {},\n  "additionalProperties": false\n}',
  outputSchema:
    '{\n  "type": "object",\n  "properties": { "ok": { "type": "boolean" } },\n  "required": ["ok"]\n}',
  timeoutMs: 30000,
  enabled: true,
  riskLevel: "read",
  permissions: [],
  secretGrantIds: [],
};

export type InspectorTab = "settings" | "schemas" | "bindings";
export type TestConsoleTab = "setup" | "output" | "logs" | "error";
export type TestInputMode = "form" | "json";
export type StoredTestValues = {
  endpointId: string;
  input: string;
  inputMode: TestInputMode;
  permissions: string[];
  source: "test" | "mcp" | "http" | "cron";
  cronBindingId?: string;
  subject: string;
};
export type WorkbenchPanel = "left" | "right" | "bottom";
export type WorkbenchLayout = { left: number; right: number; bottom: number };
export const defaultWorkbenchLayout: WorkbenchLayout = {
  left: 250,
  right: 360,
  bottom: 250,
};
