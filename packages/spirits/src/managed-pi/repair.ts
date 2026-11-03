/**
 * Repair a damaged managed set from its own manifest.
 *
 * Repair does not resolve a new release and does not touch `current` until the same set has been
 * downloaded and verified again.
 */

import type { FetchLike } from "../update/types.ts";
import type { ManagedIo, ManagedInstallResult } from "./install.ts";
import { runInstallManagedSet } from "./install.ts";
import { managedManifestPath } from "./layout.ts";
import { loadManagedManifest } from "./manifest.ts";

/** Options for repairing an installed set. */
export interface RepairManagedSetOptions {
	root: string;
	setId: string;
	fetch: FetchLike;
	timeoutMs: number;
	io?: ManagedIo;
}

/** Reinstall the manifest of an existing set. */
export async function repairManagedSet(options: RepairManagedSetOptions): Promise<ManagedInstallResult> {
	const manifest = await loadManagedManifest(managedManifestPath(options.root, options.setId));
	return await runInstallManagedSet({
		root: options.root,
		manifest,
		fetch: options.fetch,
		timeoutMs: options.timeoutMs,
		io: options.io,
	});
}
