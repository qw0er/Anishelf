import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
	screen: {
		getAllDisplays: () => [
			{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
		],
	},
}));

import { WindowStateStore } from "../src/main/window-state.js";

const directories: string[] = [];
function setup() {
	const directory = mkdtempSync(join(tmpdir(), "anishelf-window-test-"));
	directories.push(directory);
	return {
		store: new WindowStateStore(directory),
		path: join(directory, "window-state.json"),
	};
}
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

test("saves and restores normal bounds and window modes", () => {
	const { store, path } = setup();
	const window = Object.assign(new EventEmitter(), {
		maximize: vi.fn(),
		setFullScreen: vi.fn(),
		getNormalBounds: () => ({ x: 30, y: 40, width: 1200, height: 700 }),
		isMaximized: () => true,
		isFullScreen: () => false,
	});
	store.manage(window as unknown as BrowserWindow, null);
	window.emit("close");
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
		bounds: { x: 30, y: 40, width: 1200, height: 700 },
		maximized: true,
		fullscreen: false,
	});
	const restored = store.read();
	expect(store.windowOptions(restored)).toEqual({
		x: 30,
		y: 40,
		width: 1200,
		height: 700,
	});
	store.manage(window as unknown as BrowserWindow, restored);
	expect(window.maximize).toHaveBeenCalledOnce();
});

test("centers an offscreen window and ignores malformed state", () => {
	const { store, path } = setup();
	writeFileSync(
		path,
		JSON.stringify({
			bounds: { x: 3000, y: 0, width: 1000, height: 600 },
			maximized: false,
			fullscreen: true,
		}),
	);
	const state = store.read();
	expect(store.windowOptions(state)).toEqual({ width: 1000, height: 600 });
	const window = Object.assign(new EventEmitter(), {
		maximize: vi.fn(),
		setFullScreen: vi.fn(),
	});
	store.manage(window as unknown as BrowserWindow, state);
	expect(window.setFullScreen).toHaveBeenCalledWith(true);
	writeFileSync(
		path,
		JSON.stringify({
			bounds: { x: 0, y: 0, width: -1, height: 600 },
			maximized: false,
			fullscreen: false,
		}),
	);
	expect(store.read()).toBeNull();
	expect(store.windowOptions(null)).toEqual({ width: 1280, height: 800 });
});
