/**
 * Environment and failure messages for self-update.
 *
 * The messages are the user-visible contract for refused updates: every refusal except the
 * offline case tells the operator how to repair the installation with the installer.
 */

import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import {
	ENV_OFFLINE,
	HOST_COMMAND_PASSTHROUGH_NOTE,
	HOST_UPDATE_PASSTHROUGH_WARNING,
	INSTALL_COMMAND,
	MANAGED_PI_UPDATE_COMMAND,
	SUPPORTED_ARCH,
	SUPPORTED_PLATFORM,
} from "../constants.ts";
import type { EnvLike } from "./types.ts";

/** Result of a single guard check. */
export type GuardResult = { ok: true } | { ok: false; message: string };

/** Inputs needed to decide whether the running binary can update itself. */
export interface RuntimeSupportInput {
	compiled: boolean;
	platform: string;
	arch: string;
}

/** Line telling the operator how to run the installer. */
export function formatInstallerGuidance(): string {
	return `Re-run the installer to repair or update:\n  ${INSTALL_COMMAND}`;
}

/** Refusal for an uncompiled (source) run. */
export function formatUncompiledMessage(): string {
	return `spirits is running from source; only the compiled binary can update itself.\n${formatInstallerGuidance()}`;
}

/**
 * Refusal for `update` arguments that are not a self-update form.
 *
 * The launcher updates the executable and nothing else, so the message names what does cover the
 * rest. The second command is the host executable's own `update`: measured on the pinned host, the
 * host only dispatches `update` when it is its own first argument, and the launcher always loads the
 * spirits bundle before the caller's arguments, so the pass-through spelling would hand `update` to
 * the model as a prompt. The caller hands in the resolved host command; this layer does not know the
 * managed layout.
 */
export function formatUpdateRefusalMessage(args: readonly string[], hostUpdateCommand: string): string {
	const shown = args.length > 0 ? args.join(" ") : "<arguments>";
	return [
		`spirits update only replaces the spirits executable; it does not take ${shown}.`,
		`Update the host and the spirits extension bundle with:\n  ${MANAGED_PI_UPDATE_COMMAND}`,
		`Update installed host packages and model catalogs with the host's own command:\n  ${hostUpdateCommand} ${shown}`,
		HOST_UPDATE_PASSTHROUGH_WARNING,
	].join("\n");
}

/**
 * Refusal for a command the host dispatches only from its own first argument.
 *
 * Forwarding such a word starts a model turn that answers with the model's own guess, so the launcher names
 * the host executable the operator has to run instead.
 */
export function formatHostCommandRefusalMessage(word: string, args: readonly string[], hostCommand: string): string {
	const shown = args.length > 0 ? ` ${args.join(" ")}` : "";
	return [
		`spirits does not run ${word}: the host dispatches a command only from its own first argument.`,
		`Run it on the host this install uses:\n  ${hostCommand} ${word}${shown}`,
		HOST_COMMAND_PASSTHROUGH_NOTE,
	].join("\n");
}

/** Refusal for an unsupported platform or architecture. */
export function formatUnsupportedPlatformMessage(platform: string, arch: string): string {
	return `Self-update supports ${SUPPORTED_PLATFORM}/${SUPPORTED_ARCH} only (detected ${platform}/${arch}).\n${formatInstallerGuidance()}`;
}

/** Refusal for an install directory that cannot be written. */
export function formatNotWritableMessage(installDir: string): string {
	return `The install directory is not writable: ${installDir}\n${formatInstallerGuidance()}`;
}

/** Refusal while `PI_OFFLINE` is enabled; no network request is made. */
export function formatOfflineMessage(): string {
	return "PI_OFFLINE is enabled, so the update is skipped without any network access. Unset PI_OFFLINE and run the command again to update.";
}

/** Failure message for release resolution, download, and idle-timeout errors. */
export function formatFailureMessage(reason: string): string {
	return `${reason}\n${formatInstallerGuidance()}`;
}

/** Check whether the runtime can self-update at all. */
export function checkRuntimeSupport(input: RuntimeSupportInput): GuardResult {
	if (!input.compiled) {
		return { ok: false, message: formatUncompiledMessage() };
	}
	if (input.platform !== SUPPORTED_PLATFORM || input.arch !== SUPPORTED_ARCH) {
		return { ok: false, message: formatUnsupportedPlatformMessage(input.platform, input.arch) };
	}
	return { ok: true };
}

/** `PI_OFFLINE` rule shared with pi: `1`, or case-insensitive `true` / `yes`. */
export function isOfflineEnv(env: EnvLike): boolean {
	const value = env[ENV_OFFLINE];
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

/** True when the process may create files in `dir`. */
export async function isDirectoryWritable(dir: string): Promise<boolean> {
	try {
		await access(dir, fsConstants.W_OK);
		return true;
	} catch {
		return false;
	}
}
