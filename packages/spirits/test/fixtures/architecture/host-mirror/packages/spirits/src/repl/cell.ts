import { Session } from "@earendil-works/pi-core";
import type { Session as SessionType } from "@earendil-works/pi-core";
export class Cell {
	session: Session | null = null;
	type: SessionType | null = null;
}
