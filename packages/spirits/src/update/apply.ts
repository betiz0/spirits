/**
 * Atomic placement of verified update artifacts.
 *
 * Each verified file is chmodded and renamed onto its installed path. rename is atomic within a
 * filesystem, so each installed path is always either the old file or the complete new file.
 */

import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { themeAssetPath } from "./theme.ts";

/** Executable permission bits for the installed binary. */
const EXECUTABLE_MODE = 0o755;

/** Permission bits for the installed theme assets. */
const THEME_ASSET_MODE = 0o644;

/** Options accepted by `applyVerifiedBinary`. */
export interface ApplyVerifiedBinaryOptions {
	/** Temporary directory created for this update; removed on success and failure. */
	tempDir: string;
	/** Verified file inside `tempDir`. */
	downloadedPath: string;
	/** Installed executable path. */
	targetPath: string;
}

/** One verified theme file inside the temporary directory. */
export interface ThemeAssetPlacement {
	/** Verified file inside `tempDir`. */
	downloadedPath: string;
	/** File name inside the theme directory, e.g. `dark.json`. */
	assetName: string;
}

/** Options accepted by `applyVerifiedThemeAssets`. */
export interface ApplyVerifiedThemeAssetsOptions {
	/** Installed theme directory (`<install dir>/theme`). */
	themeDir: string;
	/** Verified theme files to place; the caller owns the temporary directory. */
	assets: readonly ThemeAssetPlacement[];
}

/**
 * Place verified theme assets, creating the theme directory when needed.
 *
 * The caller owns the temporary directory and places the binary after this succeeds, so a theme
 * failure leaves the installed executable untouched.
 */
export async function applyVerifiedThemeAssets(options: ApplyVerifiedThemeAssetsOptions): Promise<void> {
	await mkdir(options.themeDir, { recursive: true });
	for (const asset of options.assets) {
		await chmod(asset.downloadedPath, THEME_ASSET_MODE);
		await rename(asset.downloadedPath, themeAssetPath(options.themeDir, asset.assetName));
	}
}

/** Move the verified file onto the installed path and remove the temporary directory. */
export async function applyVerifiedBinary(options: ApplyVerifiedBinaryOptions): Promise<void> {
	try {
		await chmod(options.downloadedPath, EXECUTABLE_MODE);
		await rename(options.downloadedPath, options.targetPath);
	} catch (error) {
		await rm(options.tempDir, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
	await rm(options.tempDir, { recursive: true, force: true }).catch(() => {});
}
