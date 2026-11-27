import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import type {
	KeyboardEvent,
	MenuItem,
	MenuItemConstructorOptions,
} from "electron";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
	userDataDir: "",
	trayInstances: [] as Array<{
		icon: unknown;
		setToolTip: ReturnType<typeof vi.fn>;
		setContextMenu: ReturnType<typeof vi.fn>;
		on: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
		handlers: Map<string, () => void>;
	}>,
	buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({
		template,
	})),
	createFromPath: vi.fn((filePath: string) => ({
		filePath,
		isEmpty: () => false,
		resize: vi.fn(() => ({ filePath, resized: true, isEmpty: () => false })),
	})),
}));

vi.mock("electron", () => {
	class MockTray {
		icon: unknown;
		setToolTip = vi.fn();
		setContextMenu = vi.fn();
		handlers = new Map<string, () => void>();
		on = vi.fn((event: string, handler: () => void) => {
			this.handlers.set(event, handler);
			return this;
		});
		destroy = vi.fn();

		constructor(icon: unknown) {
			this.icon = icon;
			state.trayInstances.push(this);
		}
	}

	return {
		app: {
			getPath: vi.fn(() => state.userDataDir),
			getAppPath: vi.fn(() => "/app"),
			getLocale: vi.fn(() => "en-US"),
		},
		Menu: { buildFromTemplate: state.buildFromTemplate },
		nativeImage: { createFromPath: state.createFromPath },
		Tray: MockTray,
	};
});

import {
	buildTrayMenuTemplate,
	DesktopTray,
	type TrayMenuActions,
} from "../src/main/native/tray.js";

function createActions() {
	return {
		showWindow: vi.fn(),
		navigate: vi.fn(),
		quit: vi.fn(),
	} satisfies TrayMenuActions;
}

function clickItem(item: MenuItemConstructorOptions | undefined) {
	if (!item?.click) throw new Error("Missing menu item click handler.");
	item.click({} as MenuItem, undefined, {} as KeyboardEvent);
}

beforeEach(() => {
	state.userDataDir = mkdtempSync(join(tmpdir(), "anishelf-tray-test-"));
	state.trayInstances.length = 0;
	state.buildFromTemplate.mockClear();
	state.createFromPath.mockClear();
});

afterEach(() => {
	rmSync(state.userDataDir, { recursive: true, force: true });
});

test("buildTrayMenuTemplate includes static quick navigation and pending review count", () => {
	const actions = createActions();
	const en = buildTrayMenuTemplate({
		locale: "en-US",
		actions,
		pendingReviewCount: 0,
	});
	expect(en.map((item) => item.label ?? item.type)).toEqual([
		"Open Anishelf",
		"separator",
		"Library",
		"History",
		"Offline Cache",
		"Review",
		"Subscriptions",
		"separator",
		"Quit Anishelf",
	]);

	clickItem(en[0]);
	clickItem(en[2]);
	clickItem(en[3]);
	clickItem(en[4]);
	clickItem(en[5]);
	clickItem(en[6]);
	clickItem(en[8]);

	expect(actions.showWindow).toHaveBeenCalledTimes(1);
	expect(actions.navigate).toHaveBeenNthCalledWith(1, "/");
	expect(actions.navigate).toHaveBeenNthCalledWith(2, "/history");
	expect(actions.navigate).toHaveBeenNthCalledWith(3, offlineCachePath);
	expect(actions.navigate).toHaveBeenNthCalledWith(4, "/review");
	expect(actions.navigate).toHaveBeenNthCalledWith(5, "/subscriptions");
	expect(actions.quit).toHaveBeenCalledTimes(1);

	const zh = buildTrayMenuTemplate({
		locale: "zh-CN",
		actions,
		pendingReviewCount: 4,
	});
	expect(zh.map((item) => item.label ?? item.type)).toEqual([
		"打开 Anishelf",
		"separator",
		"媒体库",
		"播放记录",
		"离线缓存",
		"审核 (4)",
		"订阅",
		"separator",
		"退出 Anishelf",
	]);
});

test("DesktopTray updates language and pending review count cleanly and preserves count when enabled", () => {
	const actions = createActions();
	const tray = new DesktopTray(actions, "/icon.png", "en-US");
	expect(tray.enabled).toBe(false);

	// Updating before tray is enabled retains pendingReviewCount for later enablement.
	tray.setPendingReviewCount(3.8);
	tray.setPendingReviewCount(3);
	expect(state.buildFromTemplate).not.toHaveBeenCalled();

	tray.setEnabled(true);
	expect(tray.enabled).toBe(true);
	expect(state.trayInstances).toHaveLength(1);
	expect(state.buildFromTemplate).toHaveBeenCalledTimes(1);
	expect(
		state.buildFromTemplate.mock.calls[0]?.[0]?.map((entry) => entry.label),
	).toContain("Review (3)");

	const instance = state.trayInstances[0];
	instance?.handlers.get("click")?.();
	expect(actions.showWindow).toHaveBeenCalledTimes(1);

	tray.setPendingReviewCount(3);
	expect(instance?.setContextMenu).toHaveBeenCalledTimes(1);

	tray.setPendingReviewCount(-2);
	expect(instance?.setContextMenu).toHaveBeenCalledTimes(2);
	expect(
		state.buildFromTemplate.mock.calls.at(-1)?.[0]?.map((entry) => entry.label),
	).toContain("Review");

	tray.setLanguage("en");
	expect(instance?.setContextMenu).toHaveBeenCalledTimes(2);

	tray.setLanguage("zh-Hans");
	expect(instance?.setContextMenu).toHaveBeenCalledTimes(3);
	expect(
		state.buildFromTemplate.mock.calls.at(-1)?.[0]?.map((entry) => entry.label),
	).toContain("打开 Anishelf");

	tray.dispose();
	expect(tray.enabled).toBe(false);
	expect(instance?.destroy).toHaveBeenCalledTimes(1);
});
