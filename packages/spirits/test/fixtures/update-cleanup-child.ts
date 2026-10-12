/**
 * Child harness for `test/update-cleanup.test.ts`.
 *
 * Creates the per-PID temp directory, guards it against SIGINT / SIGTERM, then downloads from the
 * given URLs. The test signals this process while the download is stalled and inspects the exit
 * code and leftovers.
 *
 * Usage: bun test/fixtures/update-cleanup-child.ts <install-dir> <binary-url> <checksum-url>
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { UPDATE_TEMP_DIR_PREFIX } from "../../src/constants.ts";
import { guardTempDir } from "../../src/update/cleanup.ts";
import { downloadVerifiedBinary } from "../../src/update/download.ts";

/** Long enough that only the signal ends the request; the fixture never completes it. */
const IDLE_TIMEOUT_MS = 600_000;

const [installDir, binaryUrl, checksumUrl] = process.argv.slice(2);
const tempDir = join(installDir, `${UPDATE_TEMP_DIR_PREFIX}${process.pid}`);
await mkdir(tempDir, { recursive: true });
const guard = guardTempDir(tempDir);

try {
	await downloadVerifiedBinary({
		fetch,
		binaryUrl,
		checksumUrl,
		destinationPath: join(tempDir, "spirits-linux-x64"),
		timeoutMs: IDLE_TIMEOUT_MS,
	});
} catch (error) {
	console.error(error);
	guard.dispose();
	process.exit(1);
}
guard.dispose();
process.exit(0);
