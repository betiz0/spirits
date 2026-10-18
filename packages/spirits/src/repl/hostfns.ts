/**
 * Built-in host functions exposed to cells.
 *
 * `out` / `print` write to the current cell, `use` performs an allowlisted dynamic
 * import, and `tool` calls another tool through the host pipeline. All four are
 * registered through the same `HostFnRegistry` path that later phases use.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { formatValue } from "./format.ts";
import { isRecord } from "./guards.ts";
import { readExitCode, type ToolCallRecord } from "./metrics.ts";
import type { HostFnCallable, HostFnEntry, HostFnScope } from "./registry.ts";

export const BUILTIN_HOST_FN_NAMES = ["out", "print", "use", "tool"] as const;

export function createBuiltinHostFns(): HostFnEntry[] {
	return [outEntry(), printEntry(), useEntry(), toolEntry()];
}

function outEntry(): HostFnEntry {
	return {
		name: "out",
		description: "Set the cell value explicitly.",
		create(scope: HostFnScope): HostFnCallable {
			return (value: unknown): undefined => {
				scope.setValue(value);
				return undefined;
			};
		},
	};
}

function printEntry(): HostFnEntry {
	return {
		name: "print",
		description: "Append one line to the cell output.",
		create(scope: HostFnScope): HostFnCallable {
			return (...args: unknown[]): undefined => {
				scope.print(args.map(formatPrintArg).join(" "));
				return undefined;
			};
		},
	};
}

function useEntry(): HostFnEntry {
	return {
		name: "use",
		description: "Import a node:/bun: builtin or a cwd-relative module.",
		create(scope: HostFnScope): HostFnCallable {
			return async (specifier: unknown): Promise<unknown> => {
				const spec = String(specifier);
				const target = resolveImportTarget(spec, scope.toolContext.cwd);
				try {
					return await import(target);
				} catch (error) {
					throw new Error(`use("${spec}") failed: ${errorMessage(error)}`);
				}
			};
		},
	};
}

function toolEntry(): HostFnEntry {
	return {
		name: "tool",
		description: "Call another tool through the host tool pipeline.",
		create(scope: HostFnScope): HostFnCallable {
			return async (name: unknown, args: unknown): Promise<unknown> => {
				const toolName = String(name);
				// The record is written as the call is decided, so a cell cut off mid-call still shows
				// the call it started. Arguments and tool output never enter it.
				const record: ToolCallRecord = {
					name: toolName,
					isError: false,
					structured: false,
					exitCode: null,
					threw: false,
				};
				scope.recordToolCall(record);
				try {
					return await runTool(scope, toolName, args, record);
				} catch (error) {
					record.threw = true;
					throw error;
				}
			};
		},
	};
}

/**
 * One `tool()` call through the host pipeline, filling `record` on the way out.
 *
 * An error result is data when the tool declared an outputSchema and produced a structured result
 * (a non-zero bash exit, a failed test run). Same rule as pi codemode's `toScriptValue`. Every other
 * failure stays an exception the cell can catch.
 */
async function runTool(
	scope: HostFnScope,
	toolName: string,
	args: unknown,
	record: ToolCallRecord,
): Promise<unknown> {
	if (toolName === "tsrepl") {
		throw new Error('tool("tsrepl") is not allowed: tsrepl cannot call itself');
	}
	const outcome = await scope.toolContext.executeTool(toolName, args, { signal: scope.signal });
	const structured = outcome.result.structuredContent;
	record.isError = outcome.isError;
	record.structured = structured !== undefined;
	record.exitCode = readExitCode(structured);
	if (outcome.isError) {
		if (structured !== undefined && declaresOutputSchema(scope, toolName)) {
			return structured;
		}
		const text = collectText(outcome.result);
		throw new Error(text !== "" ? text : `tool("${toolName}") failed`);
	}
	if (structured !== undefined) {
		return structured;
	}
	return collectText(outcome.result);
}

/** Whether the named callable tool declares an `outputSchema`. Unknown tools declare nothing. */
function declaresOutputSchema(scope: HostFnScope, name: string): boolean {
	return scope.toolContext.tools.some((tool) => tool.name === name && tool.outputSchema !== undefined);
}

/** Decide what `use(spec)` may import. See design Decision 9. */
export function resolveImportTarget(spec: string, cwd: string): string {
	if (spec.startsWith("node:") || spec.startsWith("bun:")) {
		return spec;
	}
	if (spec.startsWith("./") || spec.startsWith("../")) {
		const resolved = path.resolve(cwd, spec);
		const relative = path.relative(cwd, resolved);
		// `relative === ".."` means the parent directory itself; `startsWith(".." + sep)`
		// means an ancestor. Checking bare `startsWith("..")` would wrongly reject a
		// sibling named `..cache`. An absolute `relative` means a different drive/root.
		const outside =
			relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
		if (!outside) {
			return pathToFileURL(resolved).href;
		}
		throw new Error(`use() cannot import "${spec}": the path is outside the session cwd (${cwd})`);
	}
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec)) {
		throw new Error(`use() cannot import "${spec}": remote and URL imports are not supported in M1`);
	}
	throw new Error(
		`use() cannot import "${spec}": M1 only allows node:/bun: builtins and cwd-relative paths (bundled dependencies are not available yet)`,
	);
}

function formatPrintArg(arg: unknown): string {
	return typeof arg === "string" ? arg : formatValue(arg);
}

function collectText(result: { content: readonly unknown[] }): string {
	return result.content
		.map((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text : ""))
		.filter((text) => text !== "")
		.join("\n");
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
