import assert from "node:assert/strict";
import test from "node:test";
import { mountFullscreenRecap } from "../index.ts";

function container(children = []) {
	return {
		children: [...children],
		addChild(component) {
			this.children.push(component);
		},
		removeChild(component) {
			const index = this.children.indexOf(component);
			if (index >= 0) this.children.splice(index, 1);
		},
		render(width) {
			return this.children.flatMap((child) => child.render(width));
		},
		invalidate() {
			for (const child of this.children) child.invalidate();
		},
	};
}

const emptyContainer = () => container();
const textComponent = (text) => ({
	render: () => [text],
	invalidate() {},
});

test("mounts a temporary recap after the fullscreen transcript and removes it on dispose", () => {
	const document = container([emptyContainer(), emptyContainer(), emptyContainer()]);
	let renders = 0;
	const tui = {
		mode: "fullscreen",
		children: [document],
		requestRender() {
			renders++;
		},
	};

	const bridge = mountFullscreenRecap(tui, textComponent("recap text"));
	assert.ok(bridge);
	assert.equal(document.children.length, 4);
	assert.deepEqual(document.children[3].render(80), ["recap text"]);
	assert.deepEqual(bridge.render(80), [], "the bridge must consume no fixed dock rows");
	assert.equal(renders, 1);

	tui.mode = "regular";
	assert.deepEqual(document.children[3].render(80), [], "the recap must not leak into regular scrollback");

	bridge.dispose();
	bridge.dispose();
	assert.equal(document.children.length, 3);
	assert.equal(renders, 2, "disposal should be idempotent and request one repaint");
});

test("fails closed when Pi's transcript layout is not recognised", () => {
	const document = container([emptyContainer(), emptyContainer()]);
	const tui = {
		mode: "fullscreen",
		children: [document],
		requestRender() {
			throw new Error("should not render");
		},
	};

	assert.equal(mountFullscreenRecap(tui, textComponent("recap text")), undefined);
	assert.equal(document.children.length, 2);
});

test("does not mount transcript content in regular mode", () => {
	const document = container([emptyContainer(), emptyContainer(), emptyContainer()]);
	const tui = {
		mode: "regular",
		children: [document],
		requestRender() {
			throw new Error("should not render");
		},
	};

	assert.equal(mountFullscreenRecap(tui, textComponent("recap text")), undefined);
	assert.equal(document.children.length, 3);
});
