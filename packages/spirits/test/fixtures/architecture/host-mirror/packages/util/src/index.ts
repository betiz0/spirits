import { Session } from "@earendil-works/pi-core";
import { Type } from "typebox";
export function use(session: Session): string {
	return Type.String();
}
