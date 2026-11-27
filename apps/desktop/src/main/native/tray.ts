import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	app,
	Menu,
	type MenuItemConstructorOptions,
	nativeImage,
	Tray,
} from "electron";
import { type DesktopLocale, resolveDesktopLocale } from "./locale.js";
import {
	buildQuickNavigationItems,
	normalizeBadgeCount,
} from "./quick-navigation.js";

export interface TrayMenuActions {
	showWindow(): void;
	navigate(path: string): void;
	quit(): void;
}

const trayCopyByLocale: Record<DesktopLocale, { open: string; quit: string }> =
	{
		en: {
			open: "Open Anishelf",
			quit: "Quit Anishelf",
		},
		"zh-CN": {
			open: "打开 Anishelf",
			quit: "退出 Anishelf",
		},
	};

/** Build the system tray context menu template for the current locale. */
export function buildTrayMenuTemplate(options: {
	locale: string;
	actions: TrayMenuActions;
	pendingReviewCount?: number;
}): MenuItemConstructorOptions[] {
	const locale = resolveDesktopLocale(options.locale);
	const copy = trayCopyByLocale[locale];
	const pendingReviewCount = options.pendingReviewCount ?? 0;

	return [
		{
			label: copy.open,
			click: () => options.actions.showWindow(),
		},
		{ type: "separator" },
		...buildQuickNavigationItems({
			locale,
			navigate: (path) => options.actions.navigate(path),
			pendingReviewCount,
		}),
		{ type: "separator" },
		{
			label: copy.quit,
			click: () => options.actions.quit(),
		},
	];
}

export class DesktopTray {
	private readonly path: string;
	private locale: DesktopLocale;
	private pendingReviewCount = 0;
	private tray: Tray | undefined;

	constructor(
		private readonly actions: TrayMenuActions,
		private readonly iconPath: string,
		initialLocale = app.getLocale(),
	) {
		this.path = join(app.getPath("userData"), "tray.json");
		this.locale = resolveDesktopLocale(initialLocale);
		try {
			if (JSON.parse(readFileSync(this.path, "utf8")) === true)
				this.tray = this.createTray();
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				console.warn("desktop.tray_restore_failed", { error });
		}
	}

	get enabled(): boolean {
		return this.tray !== undefined;
	}

	setLanguage(language: string): void {
		const next = resolveDesktopLocale(language);
		if (next === this.locale) return;
		this.locale = next;
		if (!this.tray) return;
		this.tray.setContextMenu(this.buildContextMenu());
		console.debug("desktop.tray_language_updated", { locale: this.locale });
	}

	setPendingReviewCount(count: number): void {
		const next = normalizeBadgeCount(count);
		if (next === this.pendingReviewCount) return;
		this.pendingReviewCount = next;
		if (!this.tray) return;
		this.tray.setContextMenu(this.buildContextMenu());
		console.debug("desktop.tray_review_count_updated", { count: next });
	}

	setEnabled(value: unknown): void {
		if (typeof value !== "boolean")
			throw new Error("Expected a tray preference.");
		if (value === this.enabled) return;

		let next: Tray | undefined;
		try {
			if (value) next = this.createTray();
			this.save(value);
		} catch (error) {
			next?.destroy();
			console.warn("desktop.tray_preference_failed", { error });
			throw new Error("Could not save the desktop tray preference.");
		}
		this.dispose();
		this.tray = next;
		console.info("desktop.tray_preference_saved", { enabled: value });
	}

	dispose(): void {
		this.tray?.destroy();
		this.tray = undefined;
	}

	private createTray(): Tray {
		const appPath = app.getAppPath();
		let icon = nativeImage.createFromPath(this.iconPath);
		if (process.platform === "darwin")
			icon = nativeImage.createFromPath(
				join(appPath, "assets", "trayTemplate.png"),
			);
		if (process.platform === "win32")
			icon = nativeImage.createFromPath(join(appPath, "assets", "tray.ico"));
		if (icon.isEmpty())
			throw new Error("Desktop tray icon could not be loaded.");
		if (process.platform === "linux")
			icon = icon.resize({ width: 24, height: 24 });

		const tray = new Tray(icon);
		try {
			tray.setToolTip("Anishelf");
			tray.setContextMenu(this.buildContextMenu());
			tray.on("click", () => this.actions.showWindow());
			return tray;
		} catch (error) {
			tray.destroy();
			throw error;
		}
	}

	private buildContextMenu(): Menu {
		return Menu.buildFromTemplate(
			buildTrayMenuTemplate({
				locale: this.locale,
				actions: this.actions,
				pendingReviewCount: this.pendingReviewCount,
			}),
		);
	}

	private save(enabled: boolean): void {
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, `${JSON.stringify(enabled)}\n`, {
				mode: 0o600,
				flag: "wx",
			});
			renameSync(temporary, this.path);
		} finally {
			try {
				rmSync(temporary, { force: true });
			} catch {
				console.warn("desktop.tray_preference_cleanup_failed");
			}
		}
	}
}
