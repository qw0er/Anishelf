import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import type {
	KeyboardEvent,
	MenuItem,
	MenuItemConstructorOptions,
} from "electron";
import { beforeEach, expect, test, vi } from "vitest";

const { buildFromTemplate } = vi.hoisted(() => ({
	buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({
		template,
	})),
}));

vi.mock("electron", () => ({
	Menu: { buildFromTemplate },
}));

import {
	buildDockMenuTemplate,
	DesktopDockMenu,
	type DockMenuTarget,
} from "../src/main/native/dock-menu.js";

function clickItem(item: MenuItemConstructorOptions | undefined) {
	if (!item?.click) throw new Error("Missing menu item click handler.");
	item.click({} as MenuItem, undefined, {} as KeyboardEvent);
}

beforeEach(() => {
	buildFromTemplate.mockClear();
});

test("buildDockMenuTemplate provides localized quick navigation and pending count", () => {
	const navigate = vi.fn();
	const template = buildDockMenuTemplate({
		locale: "en-US",
		navigate,
		pendingReviewCount: 2,
	});
	expect(template.map((item) => item.label)).toEqual([
		"Library",
		"History",
		"Offline Cache",
		"Review (2)",
		"Subscriptions",
	]);

	clickItem(template[0]);
	clickItem(template[1]);
	clickItem(template[2]);
	clickItem(template[3]);
	clickItem(template[4]);
	expect(navigate.mock.calls).toEqual([
		["/"],
		["/history"],
		[offlineCachePath],
		["/review"],
		["/subscriptions"],
	]);

	const zh = buildDockMenuTemplate({
		locale: "zh-CN",
		navigate,
		pendingReviewCount: 0,
	});
	expect(zh.map((item) => item.label)).toEqual([
		"媒体库",
		"播放记录",
		"离线缓存",
		"审核",
		"订阅",
	]);
});

test("DesktopDockMenu updates only when locale or normalized review count changes and handles failures", () => {
	const setMenu = vi.fn();
	const dock: DockMenuTarget = { setMenu };
	const navigate = vi.fn();
	const menu = new DesktopDockMenu({ dock, locale: "en-US", navigate });
	expect(setMenu).toHaveBeenCalledTimes(1);

	menu.setLanguage("en");
	expect(setMenu).toHaveBeenCalledTimes(1);

	menu.setPendingReviewCount(0);
	expect(setMenu).toHaveBeenCalledTimes(1);

	menu.setPendingReviewCount(5);
	expect(setMenu).toHaveBeenCalledTimes(2);
	expect(
		buildFromTemplate.mock.calls.at(-1)?.[0]?.map((entry) => entry.label),
	).toContain("Review (5)");

	menu.setLanguage("zh-CN");
	expect(setMenu).toHaveBeenCalledTimes(3);
	expect(
		buildFromTemplate.mock.calls.at(-1)?.[0]?.map((entry) => entry.label),
	).toContain("审核 (5)");

	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	setMenu.mockImplementationOnce(() => {
		throw new Error("dock unavailable");
	});
	menu.setPendingReviewCount(1);
	expect(warn).toHaveBeenCalledWith(
		"desktop.dock_menu_failed",
		expect.objectContaining({ error: expect.any(Error) }),
	);
	warn.mockRestore();

	menu.dispose();
	menu.setLanguage("en");
	menu.setPendingReviewCount(9);
	expect(setMenu).toHaveBeenCalledTimes(4);
});
