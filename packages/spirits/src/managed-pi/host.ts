/**
 * The host boundary: everything spirits assumes about the Pi it launches.
 *
 * The launcher, the installer, the integrity verification, the layout, the overlay and the child
 * environment all read this descriptor instead of naming a host, a path inside a release set, or an
 * environment variable themselves. A second host adds another {@link HostDescriptor} and is selected
 * by the manifest host kind, so the difference stays in this file.
 *
 * Values that change with the pinned host version (version, artifact name, checksums, overlay
 * version) are `PINNED_PI` in `../constants.ts`. This file holds only the shape that survives a
 * version bump.
 */

import { join } from "node:path";
import {
	ENV_MANAGED_AGENT_DIR,
	ENV_MANAGED_SESSION_DIR,
	ENV_OLD_AGENT_DIR,
	ENV_OLD_APP_NAME,
	ENV_OLD_CONFIG_DIR,
	ENV_OLD_SESSION_DIR,
	ENV_PACKAGE_DIR,
	ENV_SKIP_VERSION_CHECK,
	ENV_TELEMETRY,
	SPIRITS_APP_NAME,
} from "../constants.ts";

/** Official package metadata, as far as a host identity needs it. */
export type HostPackageJson = Record<string, unknown>;

/** Environment variable names a host reads. */
export interface HostEnvNames {
	/** Directory the host stores settings, auth and sessions under. */
	readonly agentDir: string;
	/** Session directory the host reads. */
	readonly sessionDir: string;
	/** Directory the host reads its own package files from. */
	readonly packageDir: string;
	/** Variable that disables the host's own update check. */
	readonly skipVersionCheck: string;
	/** Variable that turns the host's telemetry on and off. */
	readonly telemetry: string;
	/** Names an older host build read. Removed from the child environment, never pinned. */
	readonly removed: readonly string[];
}

/**
 * How a host is given the spirits identity.
 *
 * `piConfig.name` is the official Pi's field: the host reads the app name, and derives the
 * agent-directory variable name from it, out of the `package.json` beside its executable. A host
 * without such a field needs no overlay, and {@link applyHostIdentity} leaves the artifact alone.
 */
export type HostIdentity =
	| {
			readonly kind: "piConfig.name";
			/** Package.json object that holds the identity fields. */
			readonly container: string;
			/** Key the host reads as the app name. */
			readonly nameKey: string;
			/** Key holding the config directory, kept from the official artifact. */
			readonly configDirKey: string;
			/** Package.json field the host reads as the app name, in dotted spelling. */
			readonly field: string;
			/** Config directory used when the artifact names none. */
			readonly defaultConfigDir: string;
			/** App name the overlay writes. */
			readonly appName: string;
	  }
	| {
			readonly kind: "none";
			/** A host with no overlay has no identity field. */
			readonly field: null;
	  };

/** One host spirits can run on top of. */
export interface HostDescriptor {
	/** Host id, which is also the manifest host kind a `schemaVersion: 1` manifest implies. */
	readonly id: string;
	/** Published package the host artifact comes from. */
	readonly packageName: string;
	/** Directory the host tarball contributes inside a release set. */
	readonly packageDirName: string;
	/** Host executable file name inside the package directory. */
	readonly executableName: string;
	/** How the host is given the spirits identity. */
	readonly identity: HostIdentity;
	/** Environment variable names the host reads. */
	readonly env: HostEnvNames;
	/** Arguments that load the spirits extension bundle into the host. */
	extensionArgs(bundlePath: string): readonly string[];
	/**
	 * Packages the host resolves for the extension at runtime, so a bundled extension leaves them
	 * external instead of carrying its own copy.
	 *
	 * The first entry is {@link packageName}: the host's own API, which must be the same instance the
	 * host loaded. The rest come from the host's dependency tree; a schema library among them has to
	 * stay shared, because a tool parameter is compared against the host's own schema objects.
	 */
	readonly extensionExternals: readonly string[];
}

/** Manifest host kind of the official Pi, the kind a `schemaVersion: 1` manifest leaves implicit. */
export const MANIFEST_HOST_KIND_PI = "pi";

/** Flag the official Pi reads to load one extension file. */
const PI_EXTENSION_FLAG = "-e";

/** Published package the official Pi artifact comes from. */
const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

/** Package.json object and keys the official Pi reads for its identity. */
const PI_IDENTITY_CONTAINER = "piConfig";
const PI_IDENTITY_NAME_KEY = "name";
const PI_IDENTITY_CONFIG_DIR_KEY = "configDir";

/** Config directory the official Pi uses when its package.json names none. */
const PI_DEFAULT_CONFIG_DIR = ".pi";

/** Terminal UI package the official Pi hands to an extension that draws its own screens. */
const PI_TUI_PACKAGE_NAME = "@earendil-works/pi-tui";

/** Schema library the official Pi and the extension share, so parameter schemas compare by identity. */
const TYPEBOX_PACKAGE_NAME = "typebox";

/** Environment variables a fork-era install may have left behind, dropped from the child. */
const PI_REMOVED_ENV_NAMES: readonly string[] = [
	ENV_OLD_AGENT_DIR,
	ENV_OLD_SESSION_DIR,
	ENV_OLD_APP_NAME,
	ENV_OLD_CONFIG_DIR,
];

/** The official Pi artifact, the only host spirits ships against today. */
export const OFFICIAL_PI_HOST: HostDescriptor = {
	id: MANIFEST_HOST_KIND_PI,
	packageName: PI_PACKAGE_NAME,
	packageDirName: "pi",
	executableName: "pi",
	identity: {
		kind: "piConfig.name",
		container: PI_IDENTITY_CONTAINER,
		nameKey: PI_IDENTITY_NAME_KEY,
		configDirKey: PI_IDENTITY_CONFIG_DIR_KEY,
		field: `${PI_IDENTITY_CONTAINER}.${PI_IDENTITY_NAME_KEY}`,
		defaultConfigDir: PI_DEFAULT_CONFIG_DIR,
		appName: SPIRITS_APP_NAME,
	},
	env: {
		agentDir: ENV_MANAGED_AGENT_DIR,
		sessionDir: ENV_MANAGED_SESSION_DIR,
		packageDir: ENV_PACKAGE_DIR,
		skipVersionCheck: ENV_SKIP_VERSION_CHECK,
		telemetry: ENV_TELEMETRY,
		removed: PI_REMOVED_ENV_NAMES,
	},
	extensionArgs(bundlePath: string): readonly string[] {
		return [PI_EXTENSION_FLAG, bundlePath];
	},
	extensionExternals: [PI_PACKAGE_NAME, PI_TUI_PACKAGE_NAME, TYPEBOX_PACKAGE_NAME],
};

/** Hosts spirits can run, keyed by manifest host kind. */
const HOSTS: Readonly<Record<string, HostDescriptor>> = {
	[OFFICIAL_PI_HOST.id]: OFFICIAL_PI_HOST,
};

/**
 * Descriptor for one manifest host kind.
 *
 * A `schemaVersion: 1` manifest carries no host field, so the kind defaults to {@link
 * MANIFEST_HOST_KIND_PI}. An unknown kind is a manifest this build cannot run and is reported as
 * such, rather than quietly launched as Pi.
 */
export function hostDescriptor(kind: string = MANIFEST_HOST_KIND_PI): HostDescriptor {
	const host = HOSTS[kind];
	if (host === undefined) {
		throw new Error(`Unsupported managed host kind: ${kind}`);
	}
	return host;
}

/** Directory the host package occupies inside a release set directory. */
export function hostPackageDir(setDir: string, host: HostDescriptor = OFFICIAL_PI_HOST): string {
	return join(setDir, host.packageDirName);
}

/** Host executable inside a release set directory. */
export function hostExecutablePath(setDir: string, host: HostDescriptor = OFFICIAL_PI_HOST): string {
	return join(hostPackageDir(setDir, host), host.executableName);
}

function asRecord(value: unknown): HostPackageJson {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as HostPackageJson)
		: {};
}

function readString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Write the host identity into a copy of the official package metadata.
 *
 * The official `name` and `version` are carried along, so the installed set still names the
 * upstream package it came from. A host whose identity kind is `none` is returned unchanged.
 */
export function applyHostIdentity(official: HostPackageJson, identity: HostIdentity): HostPackageJson {
	if (identity.kind === "none") return official;
	const container = asRecord(official[identity.container]);
	return {
		...official,
		[identity.container]: {
			...container,
			[identity.configDirKey]: readString(container[identity.configDirKey], identity.defaultConfigDir),
			[identity.nameKey]: identity.appName,
		},
	};
}
