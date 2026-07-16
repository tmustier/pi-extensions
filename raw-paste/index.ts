import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const PASTE_END_LEN = PASTE_END.length;
const EDITOR_FEATURES = Symbol.for("@tmustier/pi-editor-features");
const RAW_PASTE_FEATURE = "raw-paste";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
type ComposedEditorFactory = EditorFactory & { [EDITOR_FEATURES]?: ReadonlySet<string> };

function editorFeatures(factory: EditorFactory | undefined): ReadonlySet<string> {
	return (factory as ComposedEditorFactory | undefined)?.[EDITOR_FEATURES] ?? new Set();
}

class RawPasteController {
	private rawPasteArmed = false;
	private rawPasteBuffer = "";
	private isInRawPaste = false;

	constructor(
		private readonly sendInput: (data: string) => void,
		private readonly insertText?: (text: string) => void,
		private readonly onArm?: () => void,
	) {}

	arm(): void {
		this.rawPasteArmed = true;
		this.onArm?.();
	}

	private flush(content: string): void {
		const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		if (this.insertText) {
			this.insertText(normalized);
			return;
		}
		for (const char of normalized) this.sendInput(char);
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

				if (pasteContent.length > 0) this.flush(pasteContent);
				if (remaining.length > 0 && !this.handleInput(remaining)) this.sendInput(remaining);
			}
			return true;
		}

		return handled;
	}

	handleInput(data: string): boolean {
		return (this.rawPasteArmed || this.isInRawPaste) && this.handleRawPasteInput(data);
	}
}

export default function (pi: ExtensionAPI) {
	let controller: RawPasteController | undefined;

	const notifyArmed = (ctx: ExtensionContext): void => {
		if (ctx.hasUI) ctx.ui.notify("Raw paste armed. Paste now.", "info");
	};

	const installEditor = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;

		const previousFactory = ctx.ui.getEditorComponent();
		const features = editorFeatures(previousFactory);
		if (features.has(RAW_PASTE_FEATURE)) return;

		const factory = ((tui, theme, keybindings) => {
			const editor = previousFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
			const handleInput = editor.handleInput.bind(editor);
			controller = new RawPasteController(
				handleInput,
				editor.insertTextAtCursor?.bind(editor),
				() => notifyArmed(ctx),
			);
			editor.handleInput = (data: string): void => {
				if (!controller?.handleInput(data)) handleInput(data);
			};
			return editor;
		}) as ComposedEditorFactory;
		factory[EDITOR_FEATURES] = new Set([...features, RAW_PASTE_FEATURE]);
		ctx.ui.setEditorComponent(factory);
	};

	const armRawPaste = (ctx: ExtensionContext): void => {
		installEditor(ctx);
		if (!controller) {
			if (ctx.hasUI) ctx.ui.notify("Raw paste editor not ready.", "warning");
			return;
		}
		controller.arm();
	};

	pi.on("session_start", (_event, ctx) => {
		installEditor(ctx);
	});

	// Recompose after late-installed editor chrome, such as pi-session-hud.
	pi.on("agent_start", (_event, ctx) => {
		installEditor(ctx);
	});

	pi.on("session_shutdown", () => {
		controller = undefined;
	});

	pi.registerCommand("paste", {
		description: "Arm raw paste for the next paste operation",
		handler: async (_args, ctx) => {
			armRawPaste(ctx);
		},
	});
}
