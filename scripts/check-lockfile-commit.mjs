#!/usr/bin/env node
/**
 * Lockfile gate for the pre-commit hook.
 *
 * `bun.lock` is the only lockfile this repository has: `package-lock.json` and the per-package
 * `bun.lock` went with the Pi tree, so one gate watching one file replaced the npm-specific check.
 * A resolution change is a dependency change, so it needs an explicit decision:
 * `PI_ALLOW_LOCKFILE_CHANGE=1`. A commit that only moves the workspace package's own entry (a version
 * bump) is not a dependency change and passes.
 */

import { execFileSync } from "node:child_process";

const LOCKFILE = "bun.lock";
const allowValue = process.env.PI_ALLOW_LOCKFILE_CHANGE;
const allowed = allowValue === "1" || allowValue === "true" || allowValue === "yes";

function git(args) {
	return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function readFromGit(ref) {
	try {
		return git(["show", ref]);
	} catch {
		return undefined;
	}
}

/**
 * Package name to resolved versions, read out of the `packages` section.
 *
 * bun.lock carries trailing commas, so it is not JSON. The entry form is stable:
 * `"key": ["name@version", "", { ... }, "integrity"]`.
 */
function resolvedVersions(text) {
	const start = text.indexOf('"packages": {');
	const body = start === -1 ? text : text.slice(start);
	const out = new Map();
	const pattern = /"([^"]+)":\s*\["([^"]+)"/g;
	let match;
	while ((match = pattern.exec(body)) !== null) {
		const spec = match[2];
		const at = spec.lastIndexOf("@");
		if (at <= 0) continue;
		const name = spec.slice(0, at);
		const version = spec.slice(at + 1).replace(/\(.*\)$/, "");
		if (!out.has(name)) out.set(name, new Set());
		out.get(name).add(version);
	}
	return out;
}

/** Package names this repository owns, read from the lockfile's own workspaces section. */
function workspaceNames(text) {
	const workspacesStart = text.indexOf('"workspaces": {');
	const packagesStart = text.indexOf('"packages": {');
	if (workspacesStart === -1) return new Set();
	const body = text.slice(workspacesStart, packagesStart === -1 ? undefined : packagesStart);
	const names = new Set();
	const pattern = /"name":\s*"([^"]+)"/g;
	let match;
	while ((match = pattern.exec(body)) !== null) names.add(match[1]);
	return names;
}

function diffLockfiles(beforeText, afterText) {
	const own = workspaceNames(afterText);
	const changes = [];
	const before = beforeText === undefined ? new Map() : resolvedVersions(beforeText);
	const after = resolvedVersions(afterText);
	for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
		if (own.has(name)) continue;
		const oldVersions = before.get(name);
		const newVersions = after.get(name);
		if (!oldVersions && newVersions) {
			changes.push(`added ${name}@${[...newVersions].join(", ")}`);
		} else if (oldVersions && !newVersions) {
			changes.push(`removed ${name}@${[...oldVersions].join(", ")}`);
		} else if (oldVersions && newVersions) {
			const moved = [...newVersions].filter((version) => !oldVersions.has(version));
			const gone = [...oldVersions].filter((version) => !newVersions.has(version));
			if (moved.length > 0 || gone.length > 0) {
				changes.push(`changed ${name} ${[...oldVersions].join(", ")} -> ${[...newVersions].join(", ")}`);
			}
		}
	}
	return changes;
}

const stagedFiles = git(["diff", "--cached", "--name-only"])
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);

if (!stagedFiles.includes(LOCKFILE)) {
	process.exit(0);
}

const before = readFromGit("HEAD:bun.lock");
const after = readFromGit(":bun.lock");
const changes = after === undefined ? [] : diffLockfiles(before, after ?? "");

if (allowed) {
	console.error(`bun.lock is staged; PI_ALLOW_LOCKFILE_CHANGE is set, allowing commit.`);
	if (changes.length > 0) {
		console.error("");
		console.error("Resolved versions moving:");
		for (const line of changes.slice(0, 40)) console.error(`  - ${line}`);
		if (changes.length > 40) console.error(`  ... ${changes.length - 40} more`);
	}
	process.exit(0);
}

console.error("bun.lock is staged.");
console.error("");
console.error("Review lockfile changes before committing:");
console.error("  - confirm every added package is intentional and pinned where this repo declares it");
console.error("  - confirm the host packages stay at the versions pinned in packages/spirits");
console.error("  - review any new lifecycle scripts in the dependency tree");

if (changes.length > 0) {
	console.error("");
	console.error("Resolved versions moving:");
	for (const line of changes.slice(0, 40)) console.error(`  - ${line}`);
	if (changes.length > 40) console.error(`  ... ${changes.length - 40} more`);
}

console.error("");
console.error("If this lockfile change is intentional, commit with:");
console.error("  PI_ALLOW_LOCKFILE_CHANGE=1 git commit ...");
process.exit(1);
