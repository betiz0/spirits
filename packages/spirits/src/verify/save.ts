/**
 * The save step: resolve → number → create, with the change-root resolver injected.
 *
 * Everything the guarantee is made of sits in one narrow function: an empty body never reaches the
 * disk, a change that cannot be resolved never produces a file, and two saves of the same change
 * produce two files (`verify1.md`, `verify2.md`), never one rewrite. The resolver arrives as a
 * function argument (design Decision 13); `verify/register.ts` wires the openspec CLI one.
 */

import { VERIFY_REPORT_EMPTY_BODY_REASON } from "../constants.ts";
import { createReportFile } from "./report-name.ts";
import type { ChangeRootResolver } from "./change-root.ts";

/** Where the report landed, or why it did not. */
export type SaveReportResult = { kind: "ok"; path: string } | { kind: "error"; reason: string };

/** Saves one verification report for `changeName` under the `prefix` series. */
export type ReportSaver = (body: string, changeName: string, prefix: string, storeId?: string) => Promise<SaveReportResult>;

/** Compose resolution, numbering, and exclusive creation into the saver the tool calls. */
export function createReportSaver(deps: { resolveChangeRoot: ChangeRootResolver }): ReportSaver {
	return async (body, changeName, prefix, storeId) => {
		if (body.trim() === "") return { kind: "error", reason: VERIFY_REPORT_EMPTY_BODY_REASON };
		const root = await deps.resolveChangeRoot(changeName, storeId);
		if (root.kind === "error") return { kind: "error", reason: root.reason };
		// `createReportFile` already turns its own I/O failures into reasons; the guard keeps the
		// contract whole against anything else the file system reports (d-verify3 C-2).
		try {
			return await createReportFile(root.changeRoot, prefix, body);
		} catch (error) {
			return { kind: "error", reason: `could not save the report: ${error instanceof Error ? error.message : String(error)}` };
		}
	};
}
