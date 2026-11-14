import type { Component } from "@earendil-works/pi-tui";

export function leakedRender(component: Component): string {
  return component.render(1).join("");
}
