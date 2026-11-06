/**
 * External extension standing in for a user's own extension in an existing agent dir.
 *
 * The compatibility runner copies this tree into the isolated agent dir and then checks whether the
 * dedicated Pi reports the command below. Registering a command is the smallest observable effect
 * that proves the runtime read the extension; nothing here touches the filesystem or the network.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function redactedExtension(pi: ExtensionAPI): void {
	pi.registerCommand("compat-redacted-command", {
		description: "Marker registered by the external extension copied into the agent dir",
		handler: () => {},
	});
}
