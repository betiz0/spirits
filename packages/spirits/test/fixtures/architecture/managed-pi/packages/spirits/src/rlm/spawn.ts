import { Cell } from "../repl/cell.ts";
import { CONFIG } from "../config.ts";
export function spawn(cell: Cell): string {
	return CONFIG.appName;
}
