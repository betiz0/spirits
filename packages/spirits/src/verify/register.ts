/**
 * Wiring of the verification report saving: the tool, its active window, the target pin, and the
 * nudge that keeps an unsaved verification from reading as complete.
 *
 * The activation follows the running step, and this registration runs **after** the routing layer
 * registered its `input` handlers — the same ordering dependency the fit gate writes down (routing
 * design Decision D10): only after `phase.handleInput` can `phase.step()` and
 * `phase.stepStartedByInput()` say what this input did. Routing's `agent_settled` handler also runs
 * before this file's, so a step that does not continue (the deep verification) is already closed
 * here, aborted or not, and its tool goes back out of the active set.
 *
 * The obligation lives only in this runtime's memory (design Decision 10): a reload or a reopened
 * session has the step (the routing restores it) but never the nudge.
 *
 * Two routes end the window with nothing pinned and nothing saved, and no later answer can fix either:
 * the deep verification does not continue, so a run that settled while still asking which change closes
 * its step, and a session on a physical model ends a verification step whose run never resolved as soon
 * as the next input arrives. {@link announceUnpinnedClose} says so once on either route, because a report
 * that will never exist must not end in silence (design Decision 14).
 */

import type { ExtensionAPI, ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";
import {
	EXTENSION_MODE_RPC,
	EXTENSION_MODE_TUI,
	INPUT_SOURCE_EXTENSION,
	TOOL_NAME_VERIFY_REPORT_SAVE,
	VERIFY_NUDGE_CUSTOM_TYPE,
	VERIFY_REPORT_NUDGE_MESSAGE,
	VERIFY_REPORT_PREFIXES,
	VERIFY_REPORT_UNPINNED_NOTICE,
	VERIFY_REPORT_UNPINNED_STDERR_NOTICE,
	VERIFY_REPORT_UNSAVED_NOTICE,
	VERIFY_REPORT_UNSAVED_STDERR_NOTICE,
} from "../constants.ts";
import { parseCommandInput, type RoutingPhase } from "../routing/phase.ts";
import { createOpenspecChangeNameLister, createOpenspecChangeRootResolver, type ChangeNameLister } from "./change-root.ts";
import { createVerifyPin } from "./pin.ts";
import { createReportSaver } from "./save.ts";
import { createVerifyReportSaveTool } from "./tool.ts";

/** A save the nudge is waiting for, and how far the one-time nudge got. */
interface SaveObligation {
	saved: boolean;
	nudged: boolean;
}

export interface VerifyReportDeps {
	/** The routing phase, read-only: which step runs, and whether the input just opened it. */
	phase: Pick<RoutingPhase, "step" | "stepStartedByInput">;
	/**
	 * Exact change names, for pinning, read through the store the verification carries. Defaults to
	 * `openspec list --json` (d-verify3 C-1: the same store as the save's resolution).
	 */
	listChangeNames?: ChangeNameLister;
	/** Change name → directory. Defaults to `openspec status --change <name> --json`. */
	resolveChangeRoot?: ReturnType<typeof createOpenspecChangeRootResolver>;
	/** Where the non-interactive unsaved notice goes. Defaults to stderr; stdout keeps its shape. */
	writeStderr?: (line: string) => void;
}

/** The `--store <id>` / `--store=<id>` option in a command's argument text, if the line named one. */
function storeFlagFromArguments(argsText: string): string | undefined {
	return /(?:^|\s)--store(?:=|\s+)(\S+)/.exec(argsText)?.[1];
}

/** Register the save tool and the step window around it. */
export function registerVerifyReportSaving(pi: ExtensionAPI, deps: VerifyReportDeps): void {
	// One pin, one saver, and one store between them: the pin hands the store it holds to both the
	// name list and the save, so pinning and saving read the same change set (d-verify3 C-1).
	const pin = createVerifyPin({
		listChangeNames: deps.listChangeNames ?? createOpenspecChangeNameLister(),
	});
	const save = createReportSaver({
		resolveChangeRoot: deps.resolveChangeRoot ?? createOpenspecChangeRootResolver(),
	});
	const writeStderr =
		deps.writeStderr ??
		((line: string): void => {
			process.stderr.write(`${line}\n`);
		});

	let obligation: SaveObligation | undefined;
	// Set on the last line of this function. A host that refuses one of the subscriptions below
	// leaves the earlier handlers registered (only a throwing factory extension discards them), and
	// a half-wired layer must not touch the active set, the CLI, or the pin from those handlers.
	let wired = false;

	/** The report series the running step maps to; undefined when no verifying step is open. */
	const stepPrefix = (): string | undefined => {
		const step = deps.phase.step();
		return step === undefined ? undefined : VERIFY_REPORT_PREFIXES[step.name];
	};

	/**
	 * Tell the user that a verification whose target was never pinned ended without a report.
	 *
	 * The close consumes the obligation **before** deciding whether to speak (d-verify3 C-1): an obligation
	 * that outlived its window made the next unrelated input report an un-pinned close for a verification
	 * that did have a target, which is the opposite of what its notice says. So every close drops it, and
	 * only a verification that was un-pinned, unsaved, and not aborted is heard from.
	 *
	 * One notice per verification follows from the same consumption: the other route that notices the same
	 * close finds nothing left. A verification that saved, or that has a pinned target and therefore owns
	 * the continuation and its own unsaved notice, hears nothing here. An aborted run stays silent, matching
	 * the rule the continuation already follows: the user stopped that run themselves.
	 */
	const announceUnpinnedClose = (ctx: ExtensionContext, aborted: boolean): void => {
		const closing = obligation;
		const pinnedAtClose = pin.pinned() !== undefined;
		obligation = undefined;
		if (closing === undefined || closing.saved || pinnedAtClose || aborted) return;
		if (isInteractive(ctx)) ctx.ui.notify(VERIFY_REPORT_UNPINNED_NOTICE, "warning");
		else writeStderr(VERIFY_REPORT_UNPINNED_STDERR_NOTICE);
	};

	// Activation is the step's, never the save's: a successful save does not take the tool out, so
	// a continuing step can re-verify and save the next number (design Decision 6).
	const syncActive = (): void => {
		const active = pi.getActiveTools();
		const ours = active.includes(TOOL_NAME_VERIFY_REPORT_SAVE);
		if (stepPrefix() !== undefined) {
			if (!ours) pi.setActiveTools([...active, TOOL_NAME_VERIFY_REPORT_SAVE]);
		} else if (ours) {
			// Only this tool is ever removed; another extension's selection is left alone.
			pi.setActiveTools(active.filter((name) => name !== TOOL_NAME_VERIFY_REPORT_SAVE));
		}
	};

	pi.on("input", async (event: InputEvent, ctx: ExtensionContext) => {
		if (!wired) return undefined;
		// A steer or follow-up joins a run in progress; the step is already whatever it is, and the
		// line is nobody's answer to a clarification.
		if (event.streamingBehavior !== undefined) return undefined;
		if (stepPrefix() === undefined) {
			// The step ended (this input left the workflow) or never was a verifying one — or it closed
			// because its run never resolved, which is how a session on a physical model answers an
			// un-named verification (Decision 14). Either way an un-pinned close saved nothing, and that
			// is worth one sentence.
			announceUnpinnedClose(ctx, false);
			pin.clear();
			syncActive();
			return undefined;
		}
		if (deps.phase.stepStartedByInput()) {
			// A starter also closes any previous verification. Check its pin before clearing it.
			announceUnpinnedClose(ctx, false);
			pin.clear();
			obligation = { saved: false, nudged: false };
		}
		syncActive();
		// Pin candidates are user lines only — another extension's input has no person choosing a
		// change. A candidate with whitespace can never equal a listed name, so it is skipped
		// without consulting the CLI at all.
		if (event.source === INPUT_SOURCE_EXTENSION) return undefined;
		// One split of the line, the routing's: pi expands commands its own way, and the pin must
		// read the first argument exactly where pi cuts it (d-verify1 W-5).
		const line = deps.phase.stepStartedByInput() ? parseCommandInput(event.text) : undefined;
		if (line !== undefined) {
			// The store is held whether or not this line also names the change: `/opsx-verify --store
			// s1` clarifies, and only the answer names the change — the opening line's store must
			// survive to that resolution (design Decision 3, d-verify2 C-1).
			pin.rememberStore(storeFlagFromArguments(line.rest));
		}
		const candidate = line !== undefined ? line.firstArgument : event.text.trim();
		if (candidate === "" || /\s/.test(candidate)) return undefined;
		// `offer` is frozen once the target is pinned, so a later line naming another listed change
		// cannot move the save destination (Decision 12 (5), d-verify1 C-1). A store on the pinning
		// line wins; without one, `offer` keeps the store remembered from the opening line.
		await pin.offer(candidate, line === undefined ? undefined : storeFlagFromArguments(line.rest));
		return undefined;
	});

	pi.on("agent_settled", (event, ctx) => {
		if (!wired) return;
		// The routing's handler for the same event ran first, so a step that does not continue is
		// already closed and this sync takes the tool back out — the abort path included.
		if (stepPrefix() === undefined) {
			announceUnpinnedClose(ctx, event.aborted === true);
			pin.clear();
		}
		syncActive();
	});

	pi.on("session_start", () => {
		if (!wired) return;
		// The obligation and the pin are this runtime's facts about a run it watched. A reload keeps
		// the step (the command surface restores it on this same event, before this handler) but
		// never the nudge — a restored session was not asked to save anything.
		obligation = undefined;
		pin.clear();
		syncActive();
	});

	pi.on("session_tree", () => {
		if (!wired) return;
		// A tree move can swap the step the phase runs. Whatever it swapped to, the pin and the
		// obligation belonged to the branch the user left.
		obligation = undefined;
		pin.clear();
		syncActive();
	});

	pi.on("agent_before_settle", (_event, ctx) => {
		if (!wired) return undefined;
		if (obligation === undefined || obligation.saved) return undefined;
		if (pin.pinned() === undefined) {
			// Pending: the run ended waiting for the user to say which change. A save cannot be
			// demanded before a target exists, and this settle must not spend the one-time nudge
			// (design Decision 7).
			return undefined;
		}
		if (!isInteractive(ctx)) {
			obligation = undefined;
			writeStderr(VERIFY_REPORT_UNSAVED_STDERR_NOTICE);
			return undefined;
		}
		// `event.context.canContinue` describes the context **before** boundary drafts, so on a
		// normally completed run it is false by construction (its final message is the assistant's).
		// The nudge supplies the message that makes continuation runnable, so the decision belongs to
		// the host's own check after committing the drafts (measured on pi 1.6.0: the event-side flag
		// is false on every quiet settle). One attempt, always; a host that still refuses reports it
		// and the slot stays spent.
		if (!obligation.nudged) {
			obligation.nudged = true;
			return {
				entries: [
					{
						type: "custom_message" as const,
						customType: VERIFY_NUDGE_CUSTOM_TYPE,
						content: VERIFY_REPORT_NUDGE_MESSAGE,
						display: true,
					},
				],
				continue: true,
			};
		}
		// Either the nudge already came and went unsaved, or the host cannot continue this run. One
		// notice, then the fact is stated and never repeated.
		obligation = undefined;
		ctx.ui.notify(VERIFY_REPORT_UNSAVED_NOTICE, "warning");
		return undefined;
	});

	pi.registerTool(
		createVerifyReportSaveTool({
			activePrefix: stepPrefix,
			pinned: pin.pinned,
			storeId: pin.storeId,
			save,
			onSaved: () => {
				if (obligation) obligation.saved = true;
			},
		}),
	);

	// Everything the layer owns is in place: from here the handlers may act.
	wired = true;
	// A session that loads inside an open step (none today outside a reload) starts synced.
	syncActive();
}

/** Whether a person can answer this session: the terminal and the RPC client, not stdout modes. */
function isInteractive(ctx: ExtensionContext): boolean {
	return ctx.mode === EXTENSION_MODE_TUI || ctx.mode === EXTENSION_MODE_RPC;
}
