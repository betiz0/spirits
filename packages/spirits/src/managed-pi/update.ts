/**
 * Explicit update of the managed set.
 *
 * Update is the same verified install flow with a newly resolved manifest. The previous set stays
 * selected until the new set is complete, so a failed update leaves it startable.
 */

import type { ManagedIo, ManagedInstallResult } from "./install.ts";
import { runInstallManagedSet } from "./install.ts";
import type { ManagedManifest } from "./manifest.ts";
import type { EnvLike, FetchLike } from "../update/types.ts";

/** Options for an explicit managed update. */
export interface UpdateManagedSetOptions {
	root: string;
	manifest: ManagedManifest;
	fetch: FetchLike;
	env?: EnvLike;
	timeoutMs?: number;
	baseUrl?: string;
	io?: ManagedIo;
}

/** Install the newly resolved set. Returns the exit code without falling back anywhere. */
export async function updateManagedSet(options: UpdateManagedSetOptions): Promise<ManagedInstallResult> {
	return await runInstallManagedSet(options);
}
