# Proposal

## Why

The interactive coding agent lacks two session-management capabilities that hinder task continuity and context control: (1) a session-bound TODO list visible at the bottom of the screen that the LLM can update via tool calls, and (2) a `/clear` command that resets conversation context while preserving model selection, thinking level, and session-specific state such as TODO items.

Currently, `/new` starts a different session: a session-only model selection, the thinking level, and every state entry the extensions saved in the session (goals, memory records, TODO items) are left behind in the old session. Users who want to start a fresh conversation while keeping their task list and model settings have no recourse.

Why now: M4 (continual harness) made spirits store goal and memory state in the session, so a long task now accumulates session state worth keeping. Without `/clear`, the only way to drop a bloated context is `/new`, which discards that state.

## What Changes

- Add a `manage_todos` tool that lets the LLM add, update, complete, and delete TODO items in one batched call. The system assigns sequential numeric IDs that are never reused. An invalid batch applies nothing and returns an error. The tool is available in every run mode (interactive, print, RPC).
- Add a TODO panel rendered between the editor and the footer in the interactive TUI. It lists pending items first up to a configurable line limit (default 5, `SPIRITS_TODO_MAX_LINES`), summarizes the rest as counts, and shows a single "all done" line when every item is complete. The panel follows the current session and branch (`/resume`, `/tree`, fork, `/reload`).
- Add a `/clear` slash command to the interactive TUI. It starts a new branch from the root of the current session file, carrying over the current model, thinking level, and all extension state entries of the current branch. The previous conversation stays in the file and remains reachable through `/tree`. `/clear` is refused while a response or compaction is running. Extension runtime state (for example tsrepl variables) is kept.

## Capabilities

### New Capabilities

- `session-todo`: Session-bound TODO list managed by an LLM tool and shown in a panel at the bottom of the interactive screen
- `session-clear`: Non-destructive conversation reset that keeps the session file, model, thinking level, and extension state

### Modified Capabilities

None

## Impact

- **Pi upstream core diff**: Yes. Additive changes in five files, isolated in `[spirits]`-prefixed commits:
  - `packages/coding-agent/src/core/agent-session-runtime.ts`: add a method that clears the conversation. It uses only the existing `SessionManager.resetLeaf()` and append APIs; `session-manager.ts` is not changed.
  - `packages/coding-agent/src/core/sdk.ts`: treat a branch that only carries `model_change` / `thinking_level_change` entries as an existing session so a `/clear`ed session restores its model and thinking level on reopen. `session-manager.ts` is not changed.
  - `packages/coding-agent/src/main.ts`: use the same existing-session check for scoped model selection, so scoped models do not override the restored model of a `/clear`ed session.
  - `packages/coding-agent/src/modes/interactive/interactive-mode.ts`: add the `/clear` handler and its input branch. The TODO panel needs no layout change because the existing `belowEditor` widget slot already sits between the editor and the footer.
  - `packages/coding-agent/src/core/slash-commands.ts`: add `clear` to the autocomplete list.
- **Spirits extension**:
  - New `packages/spirits/src/todo/` (state resolution and updates, the `manage_todos` tool, panel rendering)
  - Registration in `src/index.ts`
  - Line-limit setting in `src/constants.ts` and `src/config.ts`
  - Type mirror `src/types/pi-coding-agent.d.ts`: add `setWidget`, the `session_tree` event, and related types
  - Environment variable table in `README.md`
- **API/Tool**: New LLM tool `manage_todos`, exposed in every run mode
- **Dependencies**: None added
- **Affected systems**:
  - The TODO panel and `/clear` exist only in the interactive TUI.
  - `manage_todos` is also exposed in print and RPC modes; calling it saves TODO state in the session.
  - `/new` behavior is unchanged.
