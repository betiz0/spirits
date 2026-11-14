import { ROLE_KEY } from "./config.ts";
import { pickRoutingModel } from "./routing/router.ts";
import { openRolePanel } from "./commands/panel.ts";

export const ENTRY = { ROLE_KEY, pickRoutingModel, openRolePanel };
