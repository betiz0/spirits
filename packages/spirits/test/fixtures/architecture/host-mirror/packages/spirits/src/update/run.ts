import { CONFIG } from "../config.ts";
export function run(): string {
	return CONFIG.appName;
}
