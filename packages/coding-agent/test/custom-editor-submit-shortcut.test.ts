import { setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultEditorTheme } from "../../tui/test/test-themes.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";

afterEach(() => {
	setKeybindings(new KeybindingsManager());
});

describe("CustomEditor save key hook", () => {
	it("consumes the key when the hook returns true", () => {
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, keybindings);
		editor.onSaveKey = () => true;
		editor.setText("/model high");

		editor.handleInput("\x13"); // Ctrl+S
		expect(editor.getText()).toBe("/model high");
	});

	it("passes the key to the editor when the hook returns false", () => {
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, keybindings);
		editor.onSaveKey = () => false;
		editor.setText("draft");

		editor.handleInput("x");
		expect(editor.getText()).toBe("draftx");
	});

	it("checks extension shortcuts before the hook", () => {
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, keybindings);
		const saveKey = vi.fn(() => true);
		editor.onSaveKey = saveKey;
		editor.onExtensionShortcut = () => true;

		editor.handleInput("\x13"); // Ctrl+S
		expect(saveKey).not.toHaveBeenCalled();
	});

	it("runs the hook before registered app actions", () => {
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, keybindings);
		const saveKey = vi.fn(() => true);
		editor.onSaveKey = saveKey;
		let actionCalls = 0;
		editor.onAction("app.models.save", () => {
			actionCalls++;
		});

		editor.handleInput("\x13"); // Ctrl+S
		expect(saveKey).toHaveBeenCalledWith("\x13");
		expect(actionCalls).toBe(0);
	});
});
