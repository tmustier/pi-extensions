import assert from "node:assert/strict";
import test from "node:test";
import { Container } from "@earendil-works/pi-tui";
import { showRecap } from "../index.ts";

function createUi(mode) {
	const document = new Container();
	for (let i = 0; i < 3; i++) document.addChild(new Container());
	const tui = { mode, children: [document] };
	const theme = { fg: (_name, text) => text, bold: (text) => text };
	const widgets = new Map();
	const ui = {
		theme,
		setWidget(key, content, options) {
			widgets.get(key)?.component?.dispose?.();
			widgets.delete(key);
			if (content === undefined) return;
			const component = typeof content === "function" ? content(tui, theme) : undefined;
			widgets.set(key, { content, component, options });
		},
	};
	return { ctx: { ui }, document, widgets };
}

test("fullscreen recap is temporary transcript content", () => {
	const { ctx, document, widgets } = createUi("fullscreen");
	showRecap(ctx, "Temporary recap text.");

	assert.equal(document.children.length, 4);
	assert.match(document.children[3].render(80).join("\n"), /Temporary recap text/);
	assert.equal(widgets.get("session-recap").options.placement, "belowEditor");
	assert.deepEqual(widgets.get("session-recap").component.render(80), []);

	ctx.ui.setWidget("session-recap", undefined);
	assert.equal(document.children.length, 3);
});

test("regular mode keeps the above-editor recap", () => {
	const { ctx, document, widgets } = createUi("regular");
	showRecap(ctx, "Temporary recap text.");

	assert.equal(document.children.length, 3);
	assert.equal(widgets.get("session-recap").options.placement, "aboveEditor");
	assert.deepEqual(widgets.get("session-recap").content, ["✦ recap", "Temporary recap text."]);
});
