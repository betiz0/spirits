/**
 * Compiled entry point.
 *
 * Mirrors the upstream `packages/coding-agent/src/bun/cli.ts` initialization, then starts pi with
 * the spirits extension registered as a builtin. This file only knows how to load the extension;
 * it must not reference tools or later-phase features.
 */

import "./bootstrap.ts";
import "@earendil-works/pi-coding-agent/bun/sandbox-env-setup";
import "@earendil-works/pi-coding-agent/bun/runtime-setup";
import { main } from "@earendil-works/pi-coding-agent";
import { setupCli } from "@earendil-works/pi-coding-agent/cli/setup";
import spiritsExtension from "../src/index.ts";

setupCli();
await main(process.argv.slice(2), {
	extensionFactories: [{ name: "spirits", factory: spiritsExtension, builtin: true }],
});
