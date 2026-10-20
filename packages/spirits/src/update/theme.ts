/**
 * Built-in theme asset placement contract for self-update.
 *
 * pi reads `<executable dir>/theme/{dark,light}.json` for the `/settings` theme list. Both files
 * must be regular files: a missing file, or a directory at that path, counts as missing.
 */

import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { THEME_ASSET_NAMES, THEME_ASSETS_DIR_NAME } from "../constants.ts";

/** Directory pi reads built-in themes from: `<install dir>/theme`. */
export function themeDirFor(execPath: string): string {
	return join(dirname(execPath), THEME_ASSETS_DIR_NAME);
}

/** Path of one theme asset inside `themeDir`. */
export function themeAssetPath(themeDir: string, assetName: string): string {
	return join(themeDir, assetName);
}

async function isRegularFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/** Both built-in theme assets exist as regular files. */
export async function hasThemeAssets(themeDir: string): Promise<boolean> {
	for (const name of THEME_ASSET_NAMES) {
		if (!(await isRegularFile(themeAssetPath(themeDir, name)))) return false;
	}
	return true;
}
