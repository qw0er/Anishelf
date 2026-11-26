import { offlineCachePath } from "@anishelf/contracts/offline-cache";
import { Menu, type MenuItemConstructorOptions } from "electron";
import { type DesktopLocale, resolveDesktopLocale } from "./locale.js";

const repositoryUrl = "https://github.com/qw0er/Anishelf";
const guideUrl = `${repositoryUrl}/tree/main/docs/guide`;
const issuesUrl = `${repositoryUrl}/issues`;
const releasesUrl = `${repositoryUrl}/releases`;

export interface MacMenuActions {
	showWindow(): void;
	navigate(path: string): void;
	checkForUpdates(): void;
	history(direction: "back" | "forward"): void;
	openExternal(url: string): Promise<void>;
}

export interface MacMenuOptions {
	appName: string;
	locale: string;
	packaged: boolean;
	actions: MacMenuActions;
}

interface MenuCopy {
	about: string;
	checkForUpdates: string;
	settings: string;
	services: string;
	hide: string;
	hideOthers: string;
	showAll: string;
	quit: string;
	file: string;
	closeWindow: string;
	edit: string;
	undo: string;
	redo: string;
	cut: string;
	copy: string;
	paste: string;
	pasteAndMatchStyle: string;
	delete: string;
	selectAll: string;
	go: string;
	back: string;
	forward: string;
	library: string;
	history: string;
	files: string;
	offlineCache: string;
	review: string;
	subscriptions: string;
	view: string;
	reload: string;
	actualSize: string;
	zoomIn: string;
	zoomOut: string;
	toggleFullScreen: string;
	forceReload: string;
	toggleDevTools: string;
	window: string;
	minimize: string;
	zoom: string;
	showMainWindow: string;
	bringAllToFront: string;
	help: string;
	guide: string;
	repository: string;
	reportIssue: string;
	releaseNotes: string;
}

const copyByLocale: Record<DesktopLocale, (appName: string) => MenuCopy> = {
	en: (appName) => ({
		about: `About ${appName}`,
		checkForUpdates: "Check for Updates…",
		settings: "Settings…",
		services: "Services",
		hide: `Hide ${appName}`,
		hideOthers: "Hide Others",
		showAll: "Show All",
		quit: `Quit ${appName}`,
		file: "File",
		closeWindow: "Close Window",
		edit: "Edit",
		undo: "Undo",
		redo: "Redo",
		cut: "Cut",
		copy: "Copy",
		paste: "Paste",
		pasteAndMatchStyle: "Paste and Match Style",
		delete: "Delete",
		selectAll: "Select All",
		go: "Go",
		back: "Back",
		forward: "Forward",
		library: "Library",
		history: "History",
		files: "Files",
		offlineCache: "Offline Cache",
		review: "Review",
		subscriptions: "Subscriptions",
		view: "View",
		reload: "Reload",
		actualSize: "Actual Size",
		zoomIn: "Zoom In",
		zoomOut: "Zoom Out",
		toggleFullScreen: "Toggle Full Screen",
		forceReload: "Force Reload",
		toggleDevTools: "Toggle Developer Tools",
		window: "Window",
		minimize: "Minimize",
		zoom: "Zoom",
		showMainWindow: "Show Main Window",
		bringAllToFront: "Bring All to Front",
		help: "Help",
		guide: `${appName} Guide`,
		repository: "GitHub Repository",
		reportIssue: "Report an Issue…",
		releaseNotes: "Release Notes",
	}),
	"zh-CN": (appName) => ({
		about: `关于 ${appName}`,
		checkForUpdates: "检查更新…",
		settings: "设置…",
		services: "服务",
		hide: `隐藏 ${appName}`,
		hideOthers: "隐藏其他",
		showAll: "全部显示",
		quit: `退出 ${appName}`,
		file: "文件",
		closeWindow: "关闭窗口",
		edit: "编辑",
		undo: "撤销",
		redo: "重做",
		cut: "剪切",
		copy: "复制",
		paste: "粘贴",
		pasteAndMatchStyle: "粘贴并匹配样式",
		delete: "删除",
		selectAll: "全选",
		go: "前往",
		back: "返回",
		forward: "前进",
		library: "媒体库",
		history: "播放记录",
		files: "文件",
		offlineCache: "离线缓存",
		review: "审核",
		subscriptions: "订阅",
		view: "视图",
		reload: "重新加载",
		actualSize: "实际大小",
		zoomIn: "放大",
		zoomOut: "缩小",
		toggleFullScreen: "切换全屏",
		forceReload: "强制重新加载",
		toggleDevTools: "切换开发者工具",
		window: "窗口",
		minimize: "最小化",
		zoom: "缩放",
		showMainWindow: "显示主窗口",
		bringAllToFront: "前置全部窗口",
		help: "帮助",
		guide: "使用文档",
		repository: "GitHub 仓库",
		reportIssue: "问题反馈…",
		releaseNotes: "发行版本",
	}),
};

function openMenuLink(actions: MacMenuActions, url: string) {
	void actions.openExternal(url).catch((error: unknown) => {
		console.warn("desktop.menu_link_failed", { error });
	});
}

/** Build the macOS application menu template for the current locale. */
export function buildMacMenuTemplate(
	options: MacMenuOptions,
): MenuItemConstructorOptions[] {
	const locale = resolveDesktopLocale(options.locale);
	const copy = copyByLocale[locale](options.appName);
	const { actions, appName, packaged } = options;

	const viewSubmenu: MenuItemConstructorOptions[] = [
		{ label: copy.reload, role: "reload" },
		{ type: "separator" },
		{ label: copy.actualSize, role: "resetZoom" },
		{ label: copy.zoomIn, role: "zoomIn" },
		{ label: copy.zoomOut, role: "zoomOut" },
		{ type: "separator" },
		{ label: copy.toggleFullScreen, role: "togglefullscreen" },
		...(packaged
			? []
			: [
					{ type: "separator" } as const,
					{ label: copy.forceReload, role: "forceReload" } as const,
					{ label: copy.toggleDevTools, role: "toggleDevTools" } as const,
				]),
	];

	return [
		{
			label: appName,
			submenu: [
				{
					label: copy.about,
					click: () => actions.navigate("/settings?section=about"),
				},
				{
					label: copy.checkForUpdates,
					click: () => actions.checkForUpdates(),
				},
				{ type: "separator" },
				{
					label: copy.settings,
					accelerator: "CommandOrControl+,",
					click: () => actions.navigate("/settings"),
				},
				{ type: "separator" },
				{ label: copy.services, role: "services" },
				{ type: "separator" },
				{ label: copy.hide, role: "hide" },
				{ label: copy.hideOthers, role: "hideOthers" },
				{ label: copy.showAll, role: "unhide" },
				{ type: "separator" },
				{ label: copy.quit, role: "quit" },
			],
		},
		{
			label: copy.file,
			submenu: [{ label: copy.closeWindow, role: "close" }],
		},
		{
			label: copy.edit,
			submenu: [
				{ label: copy.undo, role: "undo" },
				{ label: copy.redo, role: "redo" },
				{ type: "separator" },
				{ label: copy.cut, role: "cut" },
				{ label: copy.copy, role: "copy" },
				{ label: copy.paste, role: "paste" },
				{ label: copy.pasteAndMatchStyle, role: "pasteAndMatchStyle" },
				{ label: copy.delete, role: "delete" },
				{ label: copy.selectAll, role: "selectAll" },
			],
		},
		{
			label: copy.go,
			submenu: [
				{
					label: copy.back,
					accelerator: "CommandOrControl+[",
					click: () => actions.history("back"),
				},
				{
					label: copy.forward,
					accelerator: "CommandOrControl+]",
					click: () => actions.history("forward"),
				},
				{ type: "separator" },
				{
					label: copy.library,
					accelerator: "CommandOrControl+1",
					click: () => actions.navigate("/"),
				},
				{
					label: copy.history,
					accelerator: "CommandOrControl+2",
					click: () => actions.navigate("/history"),
				},
				{
					label: copy.files,
					accelerator: "CommandOrControl+3",
					click: () => actions.navigate("/directories/root"),
				},
				{
					label: copy.offlineCache,
					accelerator: "CommandOrControl+4",
					click: () => actions.navigate(offlineCachePath),
				},
				{
					label: copy.review,
					accelerator: "CommandOrControl+5",
					click: () => actions.navigate("/review"),
				},
				{
					label: copy.subscriptions,
					accelerator: "CommandOrControl+6",
					click: () => actions.navigate("/subscriptions"),
				},
			],
		},
		{
			label: copy.view,
			submenu: viewSubmenu,
		},
		{
			label: copy.window,
			role: "window",
			submenu: [
				{ label: copy.minimize, role: "minimize" },
				{ label: copy.zoom, role: "zoom" },
				{ type: "separator" },
				{
					label: copy.showMainWindow,
					click: () => actions.showWindow(),
				},
				{ type: "separator" },
				{ label: copy.bringAllToFront, role: "front" },
			],
		},
		{
			label: copy.help,
			role: "help",
			submenu: [
				{
					label: copy.guide,
					click: () => openMenuLink(actions, guideUrl),
				},
				{
					label: copy.repository,
					click: () => openMenuLink(actions, repositoryUrl),
				},
				{
					label: copy.reportIssue,
					click: () => openMenuLink(actions, issuesUrl),
				},
				{ type: "separator" },
				{
					label: copy.releaseNotes,
					click: () => openMenuLink(actions, releasesUrl),
				},
			],
		},
	];
}

/** Manages the native macOS application menu bar and updates it on language change. */
export class DesktopMenu {
	private locale: DesktopLocale;
	private disposed = false;
	private readonly options: Omit<MacMenuOptions, "locale">;

	constructor(options: MacMenuOptions) {
		const { locale, ...rest } = options;
		this.options = rest;
		this.locale = resolveDesktopLocale(locale);
		this.apply();
		console.info("desktop.menu_configured", {
			locale: this.locale,
			packaged: this.options.packaged,
		});
	}

	setLanguage(language: string): void {
		if (this.disposed) return;
		const next = resolveDesktopLocale(language);
		if (next === this.locale) return;
		this.locale = next;
		this.apply();
		console.debug("desktop.menu_language_updated", { locale: this.locale });
	}

	dispose(): void {
		this.disposed = true;
	}

	private apply(): void {
		Menu.setApplicationMenu(
			Menu.buildFromTemplate(
				buildMacMenuTemplate({ ...this.options, locale: this.locale }),
			),
		);
	}
}
