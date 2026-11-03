import { CONFIG } from "./config.ts";
import { Cell } from "./repl/cell.ts";
export function describe(cell: Cell): string {
	return CONFIG.appName;
}
