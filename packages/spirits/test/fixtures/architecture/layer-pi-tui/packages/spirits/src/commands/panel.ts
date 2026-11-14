import type { Component } from "@earendil-works/pi-tui";
import { pickRoutingModel } from "../routing/router.ts";

export function openRolePanel(component: Component, cwd: string): string {
  return [component.render(1).join(""), pickRoutingModel({ cwd }, "normal")].join("|");
}
