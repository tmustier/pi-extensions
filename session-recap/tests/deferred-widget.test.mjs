// In pi's RPC mode `setWidget` stores the factory and the TUI calls it on the
// next render, so the recap is drawn before any TUI exists. Reading the TUI at
// that point used to throw inside the turn timer and take the pi process down.
import assert from "node:assert/strict";
import test from "node:test";
import { showRecap } from "../index.ts";

test("showRecap survives a widget factory that has not been called yet", () => {
	const widgets = [];
	const deferred = [];
	const ctx = {
		hasUI: true,
		ui: {
			setStatus() {},
			setWidget(_key, content) {
				if (typeof content === "function") {
					deferred.push(content);
					return;
				}
				if (content !== undefined) widgets.push(content);
			},
			theme: { fg: (_n, t) => t, bold: (t) => t },
		},
	};

	assert.doesNotThrow(() => showRecap(ctx, "Fixing the bridge integration."));
	assert.equal(deferred.length, 1, "the fullscreen widget is still offered");
	assert.equal(widgets.length, 1, "the recap falls back to the editor widget");
});
