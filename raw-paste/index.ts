import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const PASTE_END_LEN = PASTE_END.length;

class RawPasteEditor extends CustomEditor {
	private rawPasteArmed = false;
	private rawPasteBuffer = "";
	private isInRawPaste = false;
	private onArm?: () => void;

	constructor(
		theme: ConstructorParameters<typeof CustomEditor>[0],
		keybindings: ConstructorParameters<typeof CustomEditor>[1],
		onArm?: () => void,
	) {
		super(theme, keybindings);
		this.onArm = onArm;
	}

	armRawPaste(): void {
		this.rawPasteArmed = true;
		this.onArm?.();
	}

	private flushRawPaste(content: string): void {
		const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		for (const char of normalized) {
			super.handleInput(char);
		}
	}

	private handleRawPasteInput(data: string): boolean {
		let handled = false;

		if (data.includes(PASTE_START)) {
			this.isInRawPaste = true;
			this.rawPasteBuffer = "";
			data = data.replace(PASTE_START, "");
			handled = true;
		}

		if (this.isInRawPaste) {
			this.rawPasteBuffer += data;
			const endIndex = this.rawPasteBuffer.indexOf(PASTE_END);
			if (endIndex !== -1) {
				const pasteContent = this.rawPasteBuffer.substring(0, endIndex);
				const remaining = this.rawPasteBuffer.substring(endIndex + PASTE_END_LEN);
				this.rawPasteBuffer = "";
				this.isInRawPaste = false;
				this.rawPasteArmed = false;

				if (pasteContent.length > 0) {
					this.flushRawPaste(pasteContent);
				}
				if (remaining.length > 0) {
					this.handleInput(remaining);
				}
			}
			return true;
		}

		return handled;
	}

	handleInput(data: string): void {
		if (
			matchesKey(data, "cmd+shift+v") ||
			matchesKey(data, "ctrl+alt+v") ||
			matchesKey(data, "ctrl+shift+v")
		) {
			this.armRawPaste();
			return;
		}

		if (this.rawPasteArmed || this.isInRawPaste) {
			if (this.handleRawPasteInput(data)) {
				return;
			}
		}

		super.handleInput(data);
	}
}

export default function (pi: ExtensionAPI) {
	let editor: RawPasteEditor | null = null;

	const notifyArmed = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		ctx.ui.notify("Raw paste armed. Paste now.", "info");
	};

	const armRawPaste = (ctx: ExtensionContext): void => {
		if (!editor) {
			if (ctx.hasUI) ctx.ui.notify("Raw paste editor not ready.", "warning");
			return;
		}

		editor.armRawPaste();
	};

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setEditorComponent((_tui, theme, keybindings) => {
			editor = new RawPasteEditor(theme, keybindings, () => notifyArmed(ctx));
			return editor;
		});
	});

	pi.registerCommand("rawpaste", {
		description: "Arm raw paste for the next paste operation",
		handler: async (_args, ctx) => {
			armRawPaste(ctx);
		},
	});

	pi.registerShortcut("ctrl+alt+v", {
		description: "Arm raw paste for the next paste operation",
		handler: async (ctx) => {
			armRawPaste(ctx);
		},
	});
}
