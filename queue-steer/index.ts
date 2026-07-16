import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
	CustomEditor,
	keyText,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { FollowUpQueue, type QueuedFollowUp } from "./queue-state";

const WIDGET_ID = "queue-steer.follow-ups";
const EDITOR_FEATURES = Symbol.for("@tmustier/pi-editor-features");
const QUEUE_STEER_FEATURE = "queue-steer";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
type ComposedEditorFactory = EditorFactory & { [EDITOR_FEATURES]?: ReadonlySet<string> };

function editorFeatures(factory: EditorFactory | undefined): ReadonlySet<string> {
	return (factory as ComposedEditorFactory | undefined)?.[EDITOR_FEATURES] ?? new Set();
}

function compactText(item: QueuedFollowUp<ImageContent>): string {
	const text = item.text.replace(/\s+/g, " ").trim();
	const imageNote = item.images.length > 0 ? ` [${item.images.length} image${item.images.length === 1 ? "" : "s"}]` : "";
	return `${text || "[image follow-up]"}${imageNote}`;
}

function fitCell(content: string, width: number): string {
	const clipped = truncateToWidth(content, Math.max(0, width), "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

class FollowUpWidget implements Component {
	constructor(
		private readonly items: QueuedFollowUp<ImageContent>[],
		private readonly editingId: string | undefined,
		private readonly theme: Theme,
	) {}

	render(width: number): string[] {
		if (width < 12) {
			return [truncateToWidth(this.theme.fg("warning", `follow-ups (${this.items.length})`), width, "")];
		}

		const border = (text: string) => this.theme.fg("warning", text);
		const title = ` follow-ups (${this.items.length}) `;
		const topFill = "─".repeat(Math.max(0, width - title.length - 2));
		const lines = [border(`┌${title}${topFill}┐`)];
		const cellWidth = width - 4;

		for (const item of this.items) {
			const selected = item.id === this.editingId;
			const prefix = selected ? "› " : "○ ";
			const raw = `${prefix}${compactText(item)}`;
			const styled = selected ? this.theme.fg("accent", raw) : this.theme.fg("muted", raw);
			lines.push(`${border("│")} ${fitCell(styled, cellWidth)} ${border("│")}`);
		}

		const dequeue = keyText("app.message.dequeue");
		const followUp = keyText("app.message.followUp");
		const submit = keyText("tui.input.submit");
		const help = this.editingId
			? `${dequeue} previous · ${followUp} save · ${submit} steer now`
			: `${submit} send next now · ${dequeue} select/edit · ${followUp} queue`;
		lines.push(`${border("│")} ${fitCell(this.theme.fg("dim", help), cellWidth)} ${border("│")}`);
		lines.push(border(`└${"─".repeat(width - 2)}┘`));
		return lines;
	}

	invalidate(): void {}
}

function userContent(item: QueuedFollowUp<ImageContent>): string | (TextContent | ImageContent)[] {
	if (item.images.length === 0) return item.text;
	return [{ type: "text", text: item.text }, ...item.images];
}

export default function queueSteerExtension(pi: ExtensionAPI) {
	const queue = new FollowUpQueue<ImageContent>();
	let editingId: string | undefined;
	let activeContext: ExtensionContext | undefined;

	const renderQueue = (ctx: ExtensionContext): void => {
		activeContext = ctx;
		if (ctx.mode !== "tui" || queue.length === 0) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}

		const items = queue.snapshot();
		const selected = editingId;
		ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => new FollowUpWidget(items, selected, theme));
	};

	const syncEditingDraft = (ctx: ExtensionContext): void => {
		if (!editingId) return;
		queue.update(editingId, ctx.ui.getEditorText());
	};

	const selectPreviousFollowUp = (ctx: ExtensionContext): void => {
		activeContext = ctx;
		if (queue.length === 0) {
			ctx.ui.notify("No queued follow-ups to edit", "info");
			return;
		}

		if (!editingId && ctx.ui.getEditorText().trim()) {
			ctx.ui.notify("Send or clear the current draft before editing queued follow-ups", "warning");
			return;
		}

		syncEditingDraft(ctx);
		editingId = queue.previousId(editingId);
		const selected = editingId ? queue.get(editingId) : undefined;
		if (!selected) return;
		ctx.ui.setEditorText(selected.text);
		renderQueue(ctx);
	};

	const sendNextNow = (ctx: ExtensionContext): void => {
		activeContext = ctx;
		syncEditingDraft(ctx);
		const next = queue.shift();
		if (!next) return;

		if (editingId === next.id) {
			editingId = undefined;
			ctx.ui.setEditorText("");
		}
		renderQueue(ctx);

		try {
			if (ctx.isIdle()) {
				pi.sendUserMessage(userContent(next));
			} else {
				pi.sendUserMessage(userContent(next), { deliverAs: "steer" });
			}
		} catch (error) {
			queue.prepend(next);
			renderQueue(ctx);
			ctx.ui.notify(
				`Could not send queued follow-up: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	};

	const installEditor = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;

		const previousFactory = ctx.ui.getEditorComponent();
		const features = editorFeatures(previousFactory);
		if (features.has(QUEUE_STEER_FEATURE)) return;

		const factory = ((tui, theme, keybindings) => {
			const editor = previousFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
			const handleInput = editor.handleInput.bind(editor);
			editor.handleInput = (data: string): void => {
				if (queue.length > 0 && keybindings.matches(data, "app.message.dequeue")) {
					selectPreviousFollowUp(ctx);
					return;
				}
				if (
					queue.length > 0 &&
					!editingId &&
					!editor.getText().trim() &&
					keybindings.matches(data, "tui.input.submit")
				) {
					sendNextNow(ctx);
					return;
				}
				handleInput(data);
			};
			return editor;
		}) as ComposedEditorFactory;
		factory[EDITOR_FEATURES] = new Set([...features, QUEUE_STEER_FEATURE]);
		ctx.ui.setEditorComponent(factory);
	};

	pi.on("session_start", (_event, ctx) => {
		activeContext = ctx;
		renderQueue(ctx);
		installEditor(ctx);
	});

	// Recompose after late-installed editor chrome, such as pi-session-hud.
	pi.on("agent_start", (_event, ctx) => {
		installEditor(ctx);
	});

	pi.on("input", (event, ctx) => {
		if (event.source !== "interactive") return { action: "continue" };
		activeContext = ctx;

		if (editingId) {
			const selectedId = editingId;
			queue.update(selectedId, event.text, event.images);
			editingId = undefined;

			if (event.streamingBehavior === "followUp") {
				renderQueue(ctx);
				return { action: "handled" };
			}

			queue.remove(selectedId);
			renderQueue(ctx);
			return { action: "continue" };
		}

		if (event.streamingBehavior === "followUp") {
			queue.enqueue(event.text, event.images);
			renderQueue(ctx);
			return { action: "handled" };
		}

		return { action: "continue" };
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!ctx.isIdle() || queue.length === 0) return;
		activeContext = ctx;
		syncEditingDraft(ctx);

		const next = queue.shift();
		if (!next) return;
		if (editingId === next.id) {
			editingId = undefined;
			ctx.ui.setEditorText("");
		}
		renderQueue(ctx);

		try {
			pi.sendUserMessage(userContent(next));
		} catch (error) {
			queue.prepend(next);
			renderQueue(ctx);
			ctx.ui.notify(
				`Could not send queued follow-up: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	});

	pi.on("session_shutdown", () => {
		if (activeContext?.hasUI) activeContext.ui.setWidget(WIDGET_ID, undefined);
		activeContext = undefined;
		editingId = undefined;
		queue.clear();
	});
}
