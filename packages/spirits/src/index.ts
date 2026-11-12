/**
 * spirits extension entry point.
 *
 * M1 registers the persistent TypeScript REPL tool `tsrepl`. M3 adds the `rlm` host function,
 * which lets cells start child agent sessions through the same host function registry.
 * M4 adds the continual harness: `goal` / `note` host functions, the code-mode and memory
 * prompt sections, and the skill / prompt codemode tools. The branding module replaces pi's
 * startup header in TUI mode. The session TODO list adds the `manage_todos` tool and the panel that
 * shows the list between the editor and the footer, which the user collapses to a counts line and
 * expands again with a configurable key. Dual model routing registers the `spirits/auto` virtual model
 * that splits requests between two roles.
 *
 * pi initializes an extension by calling this factory, and a throw anywhere inside it discards
 * *every* registration the extension made (`core/extensions/loader.ts`: `load.discard()`). Only the
 * core — `tsrepl`, `rlm`, the continual harness, the bundled skills, and the session TODO list — may
 * fail the load. Each optional layer (the routing model, the managed commands, the startup header,
 * the footer badge) is started through {@link optional} or {@link attempt}, which keeps the failure,
 * names the layer once on the next session start, and hands back a working substitute.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installBrandingHeader } from "./branding/header.ts";
import { readSettingsFile, globalSettingsPath } from "./commands/settings-store.ts";
import { readRoutingSettings, resolveTodoConfig } from "./config.ts";
import { MODEL_ROLE_NORMAL } from "./constants.ts";
import { createRoleBadge } from "./commands/role.ts";
import { registerManagedCommands } from "./commands/register.ts";
import { registerBashGuard } from "./guard/register.ts";
import { registerBundledSkills } from "./harness/bundled-skills/index.ts";
import { registerContinualHarness } from "./harness/install.ts";
import { getAgentDir } from "./harness/paths.ts";
import { DEFAULT_MAX_DEPTH } from "./rlm/depth.ts";
import { createRlmHostFn } from "./rlm/hostfn.ts";
import { spawnChildSession } from "./rlm/spawn.ts";
import { createChildModelResolver } from "./routing/child.ts";
import type { RoutingPhase } from "./routing/phase.ts";
import { registerDualModelRouting } from "./routing/register.ts";
import { registerManageTodos } from "./todo/tool.ts";
import { createTodoPanelState, registerTodoPanel } from "./todo/widget.ts";
import { createShHostFn } from "./repl/hostfns.ts";
import { registerTsrepl } from "./tools.ts";

/** The notice a failed optional layer produces, once per runtime. */
const DEGRADED_NOTICE = "spirits: {feature} is unavailable in this runtime. tsrepl, rlm, memory, skills, and the session TODO list still work.";

/**
 * The role phase a session runs on when the routing layer did not register.
 *
 * It keeps the part the rest of the bundle reads — the current role, falling back to the saved
 * default — and drops the skill phase, which only the routing event handlers drive. `rlm` reads it
 * per child, and a parent on a physical model never reads it at all: the child gets the parent's
 * model either way.
 */
export function fallbackRoutingPhase(readDefaultRole: () => string | undefined): Pick<RoutingPhase, "current" | "setRole"> {
	let lock: string | undefined;
	return {
		current: () => lock ?? readDefaultRole() ?? MODEL_ROLE_NORMAL,
		setRole: (role: string) => {
			lock = role;
		},
	};
}

/**
 * The global settings file, read once per extension load.
 *
 * The read is the one pi itself does (`SettingsManager` reads the same path), and a file that is not
 * there, not JSON, or not an object is read as no settings at all. A broken settings file costs the
 * settings that live in it and nothing else: pi discards *every* registration when this factory
 * throws, and TODO, routing, and the commands would all go down with it.
 */
function readGlobalSettings(): Record<string, unknown> {
	try {
		return readSettingsFile(globalSettingsPath());
	} catch {
		return {};
	}
}

export default function spiritsExtension(pi: ExtensionAPI): void {
	// Layers that failed and have not been reported yet, and the ones already reported. A layer that
	// cannot start is a fact about this runtime, so the user hears it once, not once per request.
	const pending: string[] = [];
	const reported = new Set<string>();
	const degrade = (feature: string): void => {
		pending.push(feature);
	};

	/** Start an optional layer. Its failure costs that layer and nothing else. */
	function optional<T>(feature: string, register: () => T, substitute: () => T): T {
		try {
			return register();
		} catch {
			degrade(feature);
			return substitute();
		}
	}

	/** Run an optional action, per session or per request. Its failure costs that action only. */
	function attempt(feature: string, action: () => void): void {
		try {
			action();
		} catch {
			degrade(feature);
		}
	}

	pi.on("session_start", (_event, ctx) => {
		attempt("the startup header", () => installBrandingHeader(ctx, () => pi.getSettings()));
	});
	// Last, so a start that loses the header reports it on that same start, together with whatever the
	// load itself could not register.
	pi.on("session_start", (_event, ctx) => {
		for (const feature of pending.splice(0)) {
			if (reported.has(feature)) continue;
			reported.add(feature);
			ctx.ui.notify(DEGRADED_NOTICE.replace("{feature}", feature), "warning");
		}
	});

	// Routing registers before the REPL tool: `rlm` and `routing` are sibling layers, so the entry
	// point is the only place that can join them. The resolver reads the phase and the settings when a
	// child starts, which is what makes a settings edit take effect on the next child.
	// The badge shows the role that answered the last request, which the route reports through this
	// hook on either route. On the fork route pi draws its own badge next to the model name as well;
	// this line is the extension status line, not that one.
	// A badge that cannot draw is contained inside the routing layer: the hook runs on the way to the
	// user's answer, and a host that refuses a status write loses the footer line and nothing else.
	const badge = createRoleBadge();
	const routing = optional(
		"model routing",
		() => registerDualModelRouting(pi, { onRole: (role, ctx) => badge.update(role, ctx) }),
		() => ({
			roleApi: false,
			phase: fallbackRoutingPhase(() => readRoutingSettings(pi.getSettings()).defaultRole),
		}),
	);

	// One bundle, two routes. `registerModelRoles` is the fork's role patch: where it is missing the
	// host is an official Pi, and the commands that reach the same state through documented API —
	// `/spirits-model`, `/spirits-role`, `/spirits-clear` — are what fills the gap. Where it exists,
	// pi's `/model` already takes a role and these commands would only compete with it.
	if (!routing.roleApi) {
		attempt("/spirits-model, /spirits-role, and /spirits-clear", () =>
			registerManagedCommands(pi, { phase: routing.phase, badge }),
		);
	}

	const rlm = createRlmHostFn({
		pi,
		depth: 0,
		maxDepth: DEFAULT_MAX_DEPTH,
		spawn: spawnChildSession,
		resolveChildModel: createChildModelResolver({
			phase: routing.phase,
			readSettings: () => readRoutingSettings(pi.getSettings()),
		}),
	});
	const harnessHostFns = registerContinualHarness(pi, { agentDir: getAgentDir() });
	registerBundledSkills(pi, { agentDir: getAgentDir() });
	// `sh` goes to the root tsrepl only. A built-in host function reaches the `rlm` child too, and a
	// child has no bash to run.
	registerTsrepl(pi, { hostFns: [createShHostFn(), rlm, ...harnessHostFns] });
	// One resolved TODO config and one open/closed state feed both registrations: the tool and the panel
	// handlers then cannot disagree on the line limit or on what the user last chose. The settings file is
	// read here and only here, so the toggle key is fixed for the load, which is what pi's shortcut
	// registration needs, and an edit lands on the next `/reload`.
	const todo = resolveTodoConfig(process.env, readGlobalSettings());
	const todoPanel = createTodoPanelState(todo.startCollapsed);
	registerManageTodos(pi, todo, todoPanel);
	registerTodoPanel(pi, todo, todoPanel);
	// The bash guard is a sibling layer and the last registration. It runs on the way to every bash
	// call, so a guard that cannot start is a degraded layer rather than a failed load, and a guard
	// that cannot answer leaves the call alone (the handler swallows what it cannot decide).
	optional("the bash action guard", () => registerBashGuard(pi), () => {});
}
