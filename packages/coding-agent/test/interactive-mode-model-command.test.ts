import type { Model } from "@earendil-works/pi-ai/compat";
import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type AnyModel = Model<any>;

function createModel(id: string, provider: string, options?: { reasoning?: boolean }): AnyModel {
	return {
		id,
		provider,
		name: id,
		reasoning: options?.reasoning ?? false,
	} as AnyModel;
}

const reasoningModel = createModel("claude-sonnet-4-5", "anthropic", { reasoning: true });
const plainModel = createModel("gpt-5.5", "openai", { reasoning: false });

const handleModelCommand = (InteractiveMode as any).prototype.handleModelCommand;
const handleThinkingCommand = (InteractiveMode as any).prototype.handleThinkingCommand;
const setupSaveKeyHook = (InteractiveMode as any).prototype.setupSaveKeyHook;
const setCustomEditorComponent = (InteractiveMode as any).prototype.setCustomEditorComponent;
const createBaseAutocompleteProvider = (InteractiveMode as any).prototype.createBaseAutocompleteProvider;

type SelectorCreate = (done: () => void) => { component: any; focus: any; dispose?: () => void };

/** A `pi.registerModelRoles()` registration, as an extension would hand it to pi. */
function createRoleRegistration() {
	return {
		onSelect: vi.fn(),
		roles: ["normal", "strong"],
		settingsKey: { field: "models", key: "role" },
	};
}

function createSession(models: AnyModel[], roleRegistration?: ReturnType<typeof createRoleRegistration>) {
	return {
		// The runner stands in for pi's dispatch: it records the role `/model` chose, and the test for
		// `registerModelRoles` covers the call reaching the extension's `onSelect`.
		extensionRunner: {
			getModelRoles: () => roleRegistration,
			selectModelRole: vi.fn(),
		},
		scopedModels: [] as Array<{ model: AnyModel }>,
		modelRuntime: {
			getAvailableSnapshot: () => models,
			getModel: (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id),
			refresh: () => Promise.resolve({ aborted: false, errors: new Map() }),
			getError: () => undefined as string | undefined,
		},
		setModel: vi.fn(async () => {}),
		setThinkingLevel: vi.fn(),
		thinkingLevel: "medium" as const,
		getAvailableThinkingLevels: () => ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
	};
}

function createFakeThis(
	models: AnyModel[],
	overrides: Record<string, any> = {},
	roleRegistration?: ReturnType<typeof createRoleRegistration>,
) {
	const fakeThis: any = Object.create(InteractiveMode.prototype);
	const session = createSession(models, roleRegistration);
	const settingsManager = {
		getDefaultProvider: () => undefined,
		getDefaultModel: () => undefined,
		getDefaultThinkingLevel: () => "medium",
		setExtensionNestedSetting: vi.fn(),
	};
	// session/sessionManager/settingsManager are private getters on the prototype;
	// define them as own data properties so the fakes take over.
	Object.defineProperties(fakeThis, {
		session: { value: session, configurable: true, writable: true },
		sessionManager: { value: session, configurable: true, writable: true },
		settingsManager: { value: settingsManager, configurable: true, writable: true },
	});
	Object.assign(fakeThis, {
		footer: { invalidate: vi.fn() },
		footerDataProvider: { setAvailableProviderCount: vi.fn() },
		ui: { requestRender: vi.fn(), setFocus: vi.fn() },
		editorContainer: { clear: vi.fn(), addChild: vi.fn() },
		updateEditorBorderColor: vi.fn(),
		showStatus: vi.fn(),
		showError: vi.fn(),
		maybeWarnAboutAnthropicSubscriptionAuth: vi.fn(async () => {}),
		showSelector: vi.fn(),
		...overrides,
	});
	return fakeThis;
}

/** Capture the selector create callback instead of mounting the selector. */
function createSelectorCapturingThis(models: AnyModel[], roleRegistration?: ReturnType<typeof createRoleRegistration>) {
	let capturedCreate: SelectorCreate | undefined;
	const fakeThis = createFakeThis(
		models,
		{
			showSelector: (create: SelectorCreate) => {
				capturedCreate = create;
			},
		},
		roleRegistration,
	);
	return {
		fakeThis,
		getCreate: () => {
			if (!capturedCreate) throw new Error("showSelector was not called");
			return capturedCreate;
		},
	};
}

beforeAll(() => {
	initTheme("dark");
});

beforeEach(() => {
	setKeybindings(new KeybindingsManager());
});

describe("InteractiveMode.handleModelCommand", () => {
	test("sets model and thinking level for an exact match without persisting", async () => {
		const fakeThis = createFakeThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, "anthropic/claude-sonnet-4-5 high");

		expect(fakeThis.session.setModel).toHaveBeenCalledWith(reasoningModel, { persist: false });
		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: false });
		expect(fakeThis.showError).not.toHaveBeenCalled();
	});

	test("persists model and global thinking default when requested", async () => {
		const fakeThis = createFakeThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, "anthropic/claude-sonnet-4-5 high", true);

		expect(fakeThis.session.setModel).toHaveBeenCalledWith(reasoningModel, { persist: true });
		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: true });
	});

	test("persists only the model when no level is given", async () => {
		const fakeThis = createFakeThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, "anthropic/claude-sonnet-4-5", true);

		expect(fakeThis.session.setModel).toHaveBeenCalledWith(reasoningModel, { persist: true });
		expect(fakeThis.session.setThinkingLevel).not.toHaveBeenCalled();
	});

	test("rejects an unsupported thinking level and changes nothing", async () => {
		const fakeThis = createFakeThis([plainModel]);

		await handleModelCommand.call(fakeThis, "openai/gpt-5.5 high");

		expect(fakeThis.session.setModel).not.toHaveBeenCalled();
		expect(fakeThis.session.setThinkingLevel).not.toHaveBeenCalled();
		expect(fakeThis.showError).toHaveBeenCalledTimes(1);
	});

	test("opens the selector with the model term when there is no exact match", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, "sonn high");

		const created = getCreate()(() => {});
		expect(created.component.getSearchInput().getValue()).toBe("sonn");
		expect(fakeThis.session.setModel).not.toHaveBeenCalled();
	});

	test("applies the pending thinking level after a selector choice", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, "sonn high");
		const created = getCreate()(() => {});

		created.component.handleInput("\r"); // Enter selects the first filtered model
		await Promise.resolve(); // let the async selectModel finish

		expect(fakeThis.session.setModel).toHaveBeenCalledWith(reasoningModel, { persist: false });
		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: false });
		expect(fakeThis.showError).not.toHaveBeenCalled();
	});

	test("carries the persist request into the selector", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, "sonn high", true);
		const created = getCreate()(() => {});

		created.component.handleInput("\r"); // Enter (not the save key) still persists
		await Promise.resolve(); // let the async selectModel finish

		expect(fakeThis.session.setModel).toHaveBeenCalledWith(reasoningModel, { persist: true });
		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: true });
	});

	test("rejects an unsupported level chosen through the selector and changes nothing", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([plainModel]);

		await handleModelCommand.call(fakeThis, "gpt-5 high");
		const created = getCreate()(() => {});

		created.component.handleInput("\r");
		await Promise.resolve(); // let the async selectModel finish

		expect(fakeThis.session.setModel).not.toHaveBeenCalled();
		expect(fakeThis.session.setThinkingLevel).not.toHaveBeenCalled();
		expect(fakeThis.showError).toHaveBeenCalledTimes(1);
	});

	test("changes nothing when the selector is cancelled", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, "sonn high");
		const created = getCreate()(() => {});

		created.component.handleInput("\x1b"); // Escape cancels

		expect(fakeThis.session.setModel).not.toHaveBeenCalled();
		expect(fakeThis.session.setThinkingLevel).not.toHaveBeenCalled();
		expect(fakeThis.showError).not.toHaveBeenCalled();
	});

	test("persists the model from a bare /model through the selector", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, undefined, true);
		const created = getCreate()(() => {});

		created.component.handleInput("\r"); // Enter selects the first model
		await Promise.resolve(); // let the async selectModel finish

		expect(fakeThis.session.setModel).toHaveBeenCalledWith(reasoningModel, { persist: true });
		expect(fakeThis.session.setThinkingLevel).not.toHaveBeenCalled();
	});

	test("shows the saved model and thinking level in the status", async () => {
		const fakeThis = createFakeThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, "anthropic/claude-sonnet-4-5 high", true);

		expect(fakeThis.showStatus).toHaveBeenCalledWith(
			"Default model: anthropic/claude-sonnet-4-5 · Default thinking level: high",
		);
	});

	test("keeps the selector save key when the command did not ask to persist", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel]);

		await handleModelCommand.call(fakeThis, "sonn high", false);
		const created = getCreate()(() => {});

		created.component.handleInput("\x13"); // Save key in the selector still persists
		await Promise.resolve(); // let the async selectModel finish

		expect(fakeThis.session.setModel).toHaveBeenCalledWith(reasoningModel, { persist: true });
		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: true });
	});

	// spec "model-commands / /model は末尾の語を thinking レベルとロールとして解釈する": モデルとロールの同時指定
	test("notifies the registered role after applying the model", async () => {
		const fakeThis = createFakeThis([reasoningModel], {}, createRoleRegistration());

		await handleModelCommand.call(fakeThis, "anthropic/claude-sonnet-4-5 strong");

		expect(fakeThis.session.setModel).toHaveBeenCalledWith(reasoningModel, { persist: false });
		expect(fakeThis.session.extensionRunner.selectModelRole).toHaveBeenCalledWith("strong");
		// Enter does not write the default role.
		expect(fakeThis.settingsManager.setExtensionNestedSetting).not.toHaveBeenCalled();
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Model: claude-sonnet-4-5");
	});

	// spec "model-commands / /model は完全一致しない場合に selector を経由する": selector で選んだモデルにロールを適用
	test("notifies the registered role of a selector choice", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel], createRoleRegistration());

		await handleModelCommand.call(fakeThis, "sonn strong");
		const created = getCreate()(() => {});
		created.component.handleInput("\r");
		await Promise.resolve(); // let the async selectModel finish

		expect(fakeThis.session.setModel).toHaveBeenCalledWith(reasoningModel, { persist: false });
		expect(fakeThis.session.extensionRunner.selectModelRole).toHaveBeenCalledWith("strong");
		expect(fakeThis.showError).not.toHaveBeenCalled();
	});

	// spec "model-commands / /model は完全一致しない場合に selector を経由する": selector のキャンセル
	test("does not notify the role when the selector is cancelled", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel], createRoleRegistration());

		await handleModelCommand.call(fakeThis, "sonn strong");
		const created = getCreate()(() => {});
		created.component.handleInput("\x1b"); // Escape cancels

		expect(fakeThis.session.setModel).not.toHaveBeenCalled();
		expect(fakeThis.session.extensionRunner.selectModelRole).not.toHaveBeenCalled();
		expect(fakeThis.settingsManager.setExtensionNestedSetting).not.toHaveBeenCalled();
	});

	// spec "model-commands / /model は保存キーで既定として保存する": モデルとロールを保存
	test("saves the role as the default and shows it", async () => {
		const fakeThis = createFakeThis([reasoningModel], {}, createRoleRegistration());

		await handleModelCommand.call(fakeThis, "anthropic/claude-sonnet-4-5 strong", true);

		expect(fakeThis.settingsManager.setExtensionNestedSetting).toHaveBeenCalledWith("models", "role", "strong");
		expect(fakeThis.session.extensionRunner.selectModelRole).toHaveBeenCalledWith("strong");
		expect(fakeThis.showStatus).toHaveBeenCalledWith(
			"Default model: anthropic/claude-sonnet-4-5 · Default role: strong",
		);
	});

	// spec "model-commands / /model は保存キーで既定として保存する": 大文字のロールは小文字で保存する
	test("saves an uppercase role in the registered spelling", async () => {
		const fakeThis = createFakeThis([reasoningModel], {}, createRoleRegistration());

		await handleModelCommand.call(fakeThis, "anthropic/claude-sonnet-4-5 STRONG", true);

		expect(fakeThis.settingsManager.setExtensionNestedSetting).toHaveBeenCalledWith("models", "role", "strong");
		expect(fakeThis.showStatus).toHaveBeenCalledWith(
			"Default model: anthropic/claude-sonnet-4-5 · Default role: strong",
		);
	});

	// spec "model-commands / /model は保存キーで既定として保存する": thinking レベルとロールを同時に保存
	test("saves the thinking level and the role together", async () => {
		const fakeThis = createFakeThis([reasoningModel], {}, createRoleRegistration());

		await handleModelCommand.call(fakeThis, "anthropic/claude-sonnet-4-5 high strong", true);

		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: true });
		expect(fakeThis.settingsManager.setExtensionNestedSetting).toHaveBeenCalledWith("models", "role", "strong");
		expect(fakeThis.showStatus).toHaveBeenCalledWith(
			"Default model: anthropic/claude-sonnet-4-5 · Default thinking level: high · Default role: strong",
		);
	});

	// spec "model-commands / /model は保存キーで既定として保存する": ロール指定なしで保存
	test("leaves the stored default role alone without a role argument", async () => {
		const fakeThis = createFakeThis([reasoningModel], {}, createRoleRegistration());

		await handleModelCommand.call(fakeThis, "anthropic/claude-sonnet-4-5", true);

		expect(fakeThis.settingsManager.setExtensionNestedSetting).not.toHaveBeenCalled();
		expect(fakeThis.session.extensionRunner.selectModelRole).not.toHaveBeenCalled();
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Default model: anthropic/claude-sonnet-4-5");
	});

	// spec "model-commands / /model は保存キーで既定として保存する": ロール付きの保存指定を selector に引き継ぐ
	test("carries the role into a save requested through the selector", async () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel], createRoleRegistration());

		await handleModelCommand.call(fakeThis, "sonn strong", true);
		const created = getCreate()(() => {});
		created.component.handleInput("\r");
		await Promise.resolve(); // let the async selectModel finish

		expect(fakeThis.settingsManager.setExtensionNestedSetting).toHaveBeenCalledWith("models", "role", "strong");
		expect(fakeThis.showStatus).toHaveBeenCalledWith(
			"Default model: anthropic/claude-sonnet-4-5 · Default role: strong",
		);
	});
});

describe("InteractiveMode.handleThinkingCommand", () => {
	test("persists the thinking level as the global default when requested", () => {
		const fakeThis = createFakeThis([reasoningModel]);

		handleThinkingCommand.call(fakeThis, "high", true);

		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: true });
	});

	test("does not persist an invalid thinking level", () => {
		const fakeThis = createFakeThis([reasoningModel]);

		handleThinkingCommand.call(fakeThis, "foo", true);

		expect(fakeThis.session.setThinkingLevel).not.toHaveBeenCalled();
		expect(fakeThis.showError).toHaveBeenCalledTimes(1);
	});

	test("carries the persist request into the thinking selector", () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel]);

		handleThinkingCommand.call(fakeThis, undefined, true);
		const created = getCreate()(() => {});

		// Preselected level is the session's current "medium"; move down to "high".
		created.component.handleInput("\x1b[B"); // Arrow down
		created.component.handleInput("\r"); // Enter (not the save key) still persists

		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: true });
	});

	test("keeps the thinking selector save key when the command did not ask to persist", () => {
		const { fakeThis, getCreate } = createSelectorCapturingThis([reasoningModel]);

		handleThinkingCommand.call(fakeThis, undefined, false);
		const created = getCreate()(() => {});

		// Preselected level is the session's current "medium"; move down to "high".
		created.component.handleInput("\x1b[B"); // Arrow down
		created.component.handleInput("\x13"); // Save key still persists

		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: true });
	});
});

describe("InteractiveMode.setupSaveKeyHook", () => {
	function createEditorMock(text = ""): {
		getText: ReturnType<typeof vi.fn>;
		setText: ReturnType<typeof vi.fn>;
		getExpandedText: ReturnType<typeof vi.fn>;
		actionHandlers: Map<string, () => void>;
		onSaveKey?: (data: string) => boolean;
	} {
		let value = text;
		return {
			getText: vi.fn(() => value),
			setText: vi.fn((next: string) => {
				value = next;
			}),
			getExpandedText: vi.fn(() => value),
			actionHandlers: new Map<string, () => void>(),
		};
	}

	test("save key submits /model with persistence and clears the editor", () => {
		const editor = createEditorMock("/model anthropic/claude-sonnet-4-5 high");
		const keybindings = new KeybindingsManager();
		const handleModelCommand = vi.fn(async () => {});
		const fakeThis: any = Object.create(InteractiveMode.prototype);
		Object.assign(fakeThis, { defaultEditor: editor, editor, keybindings, handleModelCommand });

		setupSaveKeyHook.call(fakeThis);

		const consumed = editor.onSaveKey?.("\x13"); // Ctrl+S
		expect(consumed).toBe(true);
		expect(editor.setText).toHaveBeenCalledWith("");
		expect(handleModelCommand).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5 high", true);
	});

	test("save key submits a bare /model with persistence", () => {
		const editor = createEditorMock("/model");
		const keybindings = new KeybindingsManager();
		const handleModelCommand = vi.fn(async () => {});
		const fakeThis: any = Object.create(InteractiveMode.prototype);
		Object.assign(fakeThis, { defaultEditor: editor, editor, keybindings, handleModelCommand });

		setupSaveKeyHook.call(fakeThis);

		const consumed = editor.onSaveKey?.("\x13"); // Ctrl+S
		expect(consumed).toBe(true);
		expect(editor.setText).toHaveBeenCalledWith("");
		expect(handleModelCommand).toHaveBeenCalledWith(undefined, true);
	});

	test("save key submits /thinking with persistence", () => {
		const editor = createEditorMock("/thinking high");
		const keybindings = new KeybindingsManager();
		const handleThinkingCommand = vi.fn();
		const fakeThis: any = Object.create(InteractiveMode.prototype);
		Object.assign(fakeThis, { defaultEditor: editor, editor, keybindings, handleThinkingCommand });

		setupSaveKeyHook.call(fakeThis);

		const consumed = editor.onSaveKey?.("\x13"); // Ctrl+S
		expect(consumed).toBe(true);
		expect(editor.setText).toHaveBeenCalledWith("");
		expect(handleThinkingCommand).toHaveBeenCalledWith("high", true);
	});

	test("save key follows a rebound app.models.save", () => {
		const editor = createEditorMock("/model high");
		const keybindings = new KeybindingsManager({ "app.models.save": "ctrl+y" });
		const handleModelCommand = vi.fn(async () => {});
		const fakeThis: any = Object.create(InteractiveMode.prototype);
		Object.assign(fakeThis, { defaultEditor: editor, editor, keybindings, handleModelCommand });

		setupSaveKeyHook.call(fakeThis);

		expect(editor.onSaveKey?.("\x13")).toBe(false); // Ctrl+S no longer matches
		const consumed = editor.onSaveKey?.("\x19"); // Ctrl+Y
		expect(consumed).toBe(true);
		expect(handleModelCommand).toHaveBeenCalledWith("high", true);
	});

	test("save key ignores non-command input and keeps the text", () => {
		const editor = createEditorMock("hello");
		const keybindings = new KeybindingsManager();
		const handleModelCommand = vi.fn(async () => {});
		const fakeThis: any = Object.create(InteractiveMode.prototype);
		Object.assign(fakeThis, { defaultEditor: editor, editor, keybindings, handleModelCommand });

		setupSaveKeyHook.call(fakeThis);

		const consumed = editor.onSaveKey?.("\x13");
		expect(consumed).toBe(false);
		expect(editor.setText).not.toHaveBeenCalled();
		expect(handleModelCommand).not.toHaveBeenCalled();
	});

	test("save key ignores /models", () => {
		const editor = createEditorMock("/models");
		const keybindings = new KeybindingsManager();
		const handleModelCommand = vi.fn(async () => {});
		const fakeThis: any = Object.create(InteractiveMode.prototype);
		Object.assign(fakeThis, { defaultEditor: editor, editor, keybindings, handleModelCommand });

		setupSaveKeyHook.call(fakeThis);

		const consumed = editor.onSaveKey?.("\x13");
		expect(consumed).toBe(false);
		expect(editor.setText).not.toHaveBeenCalled();
		expect(handleModelCommand).not.toHaveBeenCalled();
	});

	test("copies the save key hook to an extension editor", () => {
		const defaultEditor = createEditorMock();
		const keybindings = new KeybindingsManager();
		const handleModelCommand = vi.fn(async () => {});
		const fakeThis: any = Object.create(InteractiveMode.prototype);
		Object.assign(fakeThis, {
			defaultEditor,
			editor: { getText: () => "" },
			editorContainer: { clear: vi.fn(), addChild: vi.fn() },
			disposeActiveSelector: vi.fn(),
			ui: { setFocus: vi.fn(), requestRender: vi.fn() },
			autocompleteProvider: undefined,
			activeStatusIndicator: undefined,
			keybindings,
			handleModelCommand,
		});

		setupSaveKeyHook.call(fakeThis);

		const extensionEditor = createEditorMock();
		const factory = vi.fn(() => extensionEditor);
		setCustomEditorComponent.call(fakeThis, factory);

		expect(extensionEditor.onSaveKey).toBeDefined();
		// The copied hook delegates to the default editor's hook.
		const saveKeySpy = vi.fn(() => true);
		defaultEditor.onSaveKey = saveKeySpy;
		extensionEditor.onSaveKey?.("\x13");
		expect(saveKeySpy).toHaveBeenCalledWith("\x13");
	});
});

describe("InteractiveMode.createBaseAutocompleteProvider /model completions", () => {
	function createProviderThis(models: AnyModel[], roleRegistration?: ReturnType<typeof createRoleRegistration>) {
		const fakeThis: any = Object.create(InteractiveMode.prototype);
		const session = {
			scopedModels: [],
			modelRuntime: { getAvailableSnapshot: () => models },
			promptTemplates: [],
			extensionRunner: {
				getRegisteredCommands: () => [],
				getModelRoles: () => roleRegistration,
				selectModelRole: vi.fn(),
			},
			resourceLoader: { getSkills: () => ({ skills: [] }) },
		};
		// session/sessionManager/settingsManager are private getters on the prototype;
		// define writable own properties so they can be faked.
		Object.defineProperties(fakeThis, {
			session: { value: session, configurable: true, writable: true },
			sessionManager: { value: { getCwd: () => "/tmp" }, configurable: true, writable: true },
			settingsManager: { value: { getEnableSkillCommands: () => false }, configurable: true, writable: true },
		});
		Object.assign(fakeThis, {
			skillCommands: new Map(),
			fdPath: null,
		});
		return fakeThis;
	}

	test("completes thinking levels as the second /model argument", async () => {
		const provider = createBaseAutocompleteProvider.call(createProviderThis([reasoningModel]));
		const line = "/model anthropic/claude-sonnet-4-5 h";
		const suggestions = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});

		expect(suggestions?.items).toEqual([{ value: "anthropic/claude-sonnet-4-5 high", label: "high" }]);
	});

	test("keeps the model reference when a level completion is applied", async () => {
		const provider = createBaseAutocompleteProvider.call(createProviderThis([reasoningModel]));
		const line = "/model anthropic/claude-sonnet-4-5 h";
		const suggestions = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});
		const item = suggestions?.items.find((item: any) => item.value === "anthropic/claude-sonnet-4-5 high");
		expect(item).toBeDefined();

		// The editor passes the whole argument text as the completion prefix.
		const result = provider.applyCompletion([line], 0, line.length, item!, "anthropic/claude-sonnet-4-5 h");
		expect(result.lines[0]).toBe("/model anthropic/claude-sonnet-4-5 high");
	});

	test("keeps fuzzy model completion for multi-word terms", async () => {
		const provider = createBaseAutocompleteProvider.call(createProviderThis([reasoningModel]));
		const line = "/model claude son";
		const suggestions = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});

		expect(suggestions?.items.map((item: any) => item.value)).toEqual(["anthropic/claude-sonnet-4-5"]);
	});

	test("shows the level and the role in the /model argument hint", async () => {
		const provider = createBaseAutocompleteProvider.call(createProviderThis([reasoningModel]));
		const line = "/mo";
		const suggestions = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});

		const modelItem = suggestions?.items.find((item: any) => item.value === "model");
		expect(modelItem?.description).toContain("<provider/model> [level] [role]");
	});

	// spec "model-commands / /model の引数補完は 2 語目に thinking レベルとロールを出す": ロールの候補
	test("completes the registered roles as the second /model argument", async () => {
		const provider = createBaseAutocompleteProvider.call(
			createProviderThis([reasoningModel], createRoleRegistration()),
		);
		const line = "/model anthropic/claude-sonnet-4-5 s";
		const suggestions = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});

		expect(suggestions?.items).toEqual([{ value: "anthropic/claude-sonnet-4-5 strong", label: "strong" }]);
	});
});
