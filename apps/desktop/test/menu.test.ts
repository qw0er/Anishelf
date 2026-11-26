import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import type {
	KeyboardEvent,
	Menu,
	MenuItem,
	MenuItemConstructorOptions,
} from "electron";
import { beforeEach, expect, test, vi } from "vitest";

const { buildFromTemplate, setApplicationMenu } = vi.hoisted(() => ({
	buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({
		template,
	})),
	setApplicationMenu: vi.fn(),
}));

vi.mock("electron", () => ({
	Menu: { buildFromTemplate, setApplicationMenu },
}));

import { resolveDesktopLocale } from "../src/main/native/locale.js";
import {
	buildMacMenuTemplate,
	DesktopMenu,
	type MacMenuActions,
} from "../src/main/native/menu.js";

function createActions() {
	return {
		showWindow: vi.fn(),
		navigate: vi.fn(),
		checkForUpdates: vi.fn(),
		history: vi.fn(),
		openExternal: vi.fn(async () => {}),
	} satisfies MacMenuActions;
}

function submenuOf(
	template: MenuItemConstructorOptions[],
	label: string,
): MenuItemConstructorOptions[] {
	const item = template.find((entry) => entry.label === label);
	if (!item || !Array.isArray(item.submenu))
		throw new Error(`Missing submenu: ${label}`);
	return item.submenu;
}

function clickItem(item: MenuItemConstructorOptions | undefined) {
	if (!item?.click) throw new Error("Missing menu item click handler.");
	item.click({} as MenuItem, undefined, {} as KeyboardEvent);
}

beforeEach(() => {
	buildFromTemplate.mockClear();
	setApplicationMenu.mockClear();
});

test("resolves desktop locales to supported menu languages", () => {
	expect(resolveDesktopLocale("zh")).toBe("zh-CN");
	expect(resolveDesktopLocale("zh-CN")).toBe("zh-CN");
	expect(resolveDesktopLocale("zh-Hans")).toBe("zh-CN");
	expect(resolveDesktopLocale("en")).toBe("en");
	expect(resolveDesktopLocale("en-US")).toBe("en");
	expect(resolveDesktopLocale("ja")).toBe("en");
});

test("builds the macOS menu structure and omits dev tools when packaged", () => {
	const actions = createActions();
	const template = buildMacMenuTemplate({
		appName: "Anishelf",
		locale: "en-US",
		packaged: true,
		actions,
	});

	expect(template.map((entry) => entry.label)).toEqual([
		"Anishelf",
		"File",
		"Edit",
		"Go",
		"View",
		"Window",
		"Help",
	]);
	expect(template[5]?.role).toBe("window");
	expect(template[6]?.role).toBe("help");

	const appMenu = submenuOf(template, "Anishelf");
	expect(appMenu.find((item) => item.label === "Settings…")?.accelerator).toBe(
		"CommandOrControl+,",
	);

	const goMenu = submenuOf(template, "Go");
	expect(
		goMenu
			.filter((item) => item.type !== "separator")
			.map((item) => [item.label, item.accelerator]),
	).toEqual([
		["Back", "CommandOrControl+["],
		["Forward", "CommandOrControl+]"],
		["Library", "CommandOrControl+1"],
		["History", "CommandOrControl+2"],
		["Files", "CommandOrControl+3"],
		["Offline Cache", "CommandOrControl+4"],
		["Review", "CommandOrControl+5"],
		["Subscriptions", "CommandOrControl+6"],
	]);

	const viewMenu = submenuOf(template, "View");
	expect(viewMenu.some((item) => item.role === "forceReload")).toBe(false);
	expect(viewMenu.some((item) => item.role === "toggleDevTools")).toBe(false);
});

test("includes developer view items in unpackaged builds and localizes zh-CN", () => {
	const actions = createActions();
	const template = buildMacMenuTemplate({
		appName: "Anishelf",
		locale: "zh-CN",
		packaged: false,
		actions,
	});

	expect(template.map((entry) => entry.label)).toEqual([
		"Anishelf",
		"文件",
		"编辑",
		"前往",
		"视图",
		"窗口",
		"帮助",
	]);

	const viewMenu = submenuOf(template, "视图");
	expect(viewMenu.some((item) => item.role === "forceReload")).toBe(true);
	expect(viewMenu.some((item) => item.role === "toggleDevTools")).toBe(true);
});

test("dispatches menu item actions and logs failed external links without throwing", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const actions = createActions();
	actions.openExternal.mockRejectedValueOnce(new Error("failed"));

	const template = buildMacMenuTemplate({
		appName: "Anishelf",
		locale: "en",
		packaged: true,
		actions,
	});

	const appMenu = submenuOf(template, "Anishelf");
	clickItem(appMenu[0]);
	clickItem(appMenu[1]);
	clickItem(appMenu[3]);
	expect(actions.navigate).toHaveBeenNthCalledWith(
		1,
		"/settings?section=about",
	);
	expect(actions.checkForUpdates).toHaveBeenCalledTimes(1);
	expect(actions.navigate).toHaveBeenNthCalledWith(2, "/settings");

	const goMenu = submenuOf(template, "Go");
	clickItem(goMenu[0]);
	clickItem(goMenu[1]);
	clickItem(goMenu[3]);
	clickItem(goMenu[4]);
	clickItem(goMenu[5]);
	clickItem(goMenu[6]);
	clickItem(goMenu[7]);
	clickItem(goMenu[8]);
	expect(actions.history).toHaveBeenNthCalledWith(1, "back");
	expect(actions.history).toHaveBeenNthCalledWith(2, "forward");
	expect(actions.navigate).toHaveBeenCalledWith("/");
	expect(actions.navigate).toHaveBeenCalledWith("/history");
	expect(actions.navigate).toHaveBeenCalledWith("/directories/root");
	expect(actions.navigate).toHaveBeenCalledWith(offlineCachePath);
	expect(actions.navigate).toHaveBeenCalledWith("/review");
	expect(actions.navigate).toHaveBeenCalledWith("/subscriptions");

	const windowMenu = submenuOf(template, "Window");
	clickItem(windowMenu[3]);
	expect(actions.showWindow).toHaveBeenCalledTimes(1);

	const helpMenu = submenuOf(template, "Help");
	clickItem(helpMenu[0]);
	clickItem(helpMenu[1]);
	clickItem(helpMenu[2]);
	clickItem(helpMenu[4]);
	expect(actions.openExternal).toHaveBeenCalledWith(
		"https://github.com/qw0er/Anishelf/tree/main/docs/guide",
	);
	expect(actions.openExternal).toHaveBeenCalledWith(
		"https://github.com/qw0er/Anishelf",
	);
	expect(actions.openExternal).toHaveBeenCalledWith(
		"https://github.com/qw0er/Anishelf/issues",
	);
	expect(actions.openExternal).toHaveBeenCalledWith(
		"https://github.com/qw0er/Anishelf/releases",
	);

	await Promise.resolve();
	expect(warn).toHaveBeenCalledWith("desktop.menu_link_failed", {
		error: expect.any(Error),
	});
	warn.mockRestore();
});

test("rebuilds the application menu only when the resolved locale changes", () => {
	const actions = createActions();
	const menu = new DesktopMenu({
		appName: "Anishelf",
		locale: "en-US",
		packaged: true,
		actions,
	});
	expect(setApplicationMenu).toHaveBeenCalledTimes(1);

	menu.setLanguage("en");
	expect(setApplicationMenu).toHaveBeenCalledTimes(1);

	menu.setLanguage("zh-CN");
	expect(setApplicationMenu).toHaveBeenCalledTimes(2);
	const latestCall = buildFromTemplate.mock.calls.at(-1)?.[0];
	expect(latestCall?.[1]?.label).toBe("文件");

	menu.dispose();
	menu.setLanguage("en");
	expect(setApplicationMenu).toHaveBeenCalledTimes(2);
	void ({} as Menu);
});
