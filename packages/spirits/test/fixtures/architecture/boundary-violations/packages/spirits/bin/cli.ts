import { main } from "@earendil-works/pi-core";
import { setup } from "@earendil-works/pi-core/cli/setup";
import { env } from "@earendil-works/pi-core/runtime/env";
export function cli(): void {
	main();
	setup();
	env();
}
