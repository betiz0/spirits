import { type Component, Container } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type ClearCommandContext = {
	runtimeHost: {
		clearConversation(): { cleared: boolean; reason?: "streaming" | "compacting" };
	};
	chatContainer: { clear(): void; addChild(child: Component): void };
	showWarning: (message: string) => void;
	ui: { requestRender: () => void };
};

type InteractiveModePrototype = {
	handleClearContextCommand(this: ClearCommandContext): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("InteractiveMode /clear", () => {
	it("clears the chat and shows a confirmation", () => {
		initTheme("dark");
		const chatContainer = new Container();
		chatContainer.addChild({ render: () => ["old conversation"], invalidate: () => {} });
		const showWarning = vi.fn();
		const requestRender = vi.fn();
		const context: ClearCommandContext = {
			runtimeHost: { clearConversation: () => ({ cleared: true }) },
			chatContainer,
			showWarning,
			ui: { requestRender },
		};

		interactiveModePrototype.handleClearContextCommand.call(context);

		const output = stripAnsi(chatContainer.render(200).join("\n"));
		expect(output).toContain("Conversation cleared");
		expect(output).not.toContain("old conversation");
		expect(showWarning).not.toHaveBeenCalled();
		expect(requestRender).toHaveBeenCalledTimes(1);
	});

	it("shows the streaming warning and keeps the chat", () => {
		const chatContainer = { clear: vi.fn(), addChild: vi.fn() };
		const showWarning = vi.fn();
		const requestRender = vi.fn();
		const context: ClearCommandContext = {
			runtimeHost: { clearConversation: () => ({ cleared: false, reason: "streaming" }) },
			chatContainer,
			showWarning,
			ui: { requestRender },
		};

		interactiveModePrototype.handleClearContextCommand.call(context);

		expect(chatContainer.clear).not.toHaveBeenCalled();
		expect(chatContainer.addChild).not.toHaveBeenCalled();
		expect(showWarning).toHaveBeenCalledWith("Wait for the current response to finish before clearing.");
		expect(requestRender).not.toHaveBeenCalled();
	});

	it("shows the compaction warning and keeps the chat", () => {
		const chatContainer = { clear: vi.fn(), addChild: vi.fn() };
		const showWarning = vi.fn();
		const requestRender = vi.fn();
		const context: ClearCommandContext = {
			runtimeHost: { clearConversation: () => ({ cleared: false, reason: "compacting" }) },
			chatContainer,
			showWarning,
			ui: { requestRender },
		};

		interactiveModePrototype.handleClearContextCommand.call(context);

		expect(chatContainer.clear).not.toHaveBeenCalled();
		expect(chatContainer.addChild).not.toHaveBeenCalled();
		expect(showWarning).toHaveBeenCalledWith("Wait for compaction to finish before clearing.");
		expect(requestRender).not.toHaveBeenCalled();
	});

	it("lists clear in BUILTIN_SLASH_COMMANDS", () => {
		const clear = BUILTIN_SLASH_COMMANDS.find((command) => command.name === "clear");
		expect(clear?.description).toBe(
			"Clear the conversation context (keeps model, thinking level, and extension state)",
		);
	});
});
