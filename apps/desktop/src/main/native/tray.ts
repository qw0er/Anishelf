import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";
import { type DesktopLocale, resolveDesktopLocale } from "./locale.js";

export class DesktopTray {
	private readonly path: string;
	private locale: DesktopLocale;
	private tray: Tray | undefined;

	constructor(
		private readonly showWindow: () => void,
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
			tray.on("click", this.showWindow);
			return tray;
		} catch (error) {
			tray.destroy();
			throw error;
		}
	}

	private buildContextMenu(): Menu {
		const chinese = this.locale === "zh-CN";
		return Menu.buildFromTemplate([
			{
				label: chinese ? "打开 Anishelf" : "Open Anishelf",
				click: () => this.showWindow(),
			},
			{
				label: chinese ? "退出 Anishelf" : "Quit Anishelf",
				click: () => app.quit(),
			},
		]);
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
