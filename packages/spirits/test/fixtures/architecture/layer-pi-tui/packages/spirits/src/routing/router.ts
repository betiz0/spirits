import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ROLE_KEY } from "../config.ts";

export function pickRoutingModel(ctx: ExtensionContext, role: string): string {
  return [ctx.cwd, ROLE_KEY, role].join(":");
}
