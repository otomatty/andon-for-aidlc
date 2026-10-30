import type { SwitchSpaceRequest } from "@andon/shared-types";
import { getTransport } from "./transport/index.ts";

export async function switchSpace(request: SwitchSpaceRequest) {
  return await getTransport().postJson("/api/switch-space", request);
}
