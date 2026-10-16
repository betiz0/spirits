import { main } from "@earendil-works/pi-core";
import { setup } from "@earendil-works/pi-core/cli/setup";
import { run } from "../src/update/run.ts";
export function cli(): void {
	main();
	setup();
	run();
}
