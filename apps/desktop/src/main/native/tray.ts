import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";

export class DesktopTray {
	private readonly path: string;
	private tray: Tray | undefined;

	constructor(
		private readonly showWindow: () => void,
		private readonly iconPath: string,
	) {
		this.path = join(app.getPath("userData"), "tray.json");
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
			const chinese = app.getLocale().toLowerCase().startsWith("zh");
			tray.setToolTip("Anishelf");
			tray.setContextMenu(
				Menu.buildFromTemplate([
					{
						label: chinese ? "打开 Anishelf" : "Open Anishelf",
						click: () => this.showWindow(),
					},
					{
						label: chinese ? "退出 Anishelf" : "Quit Anishelf",
						click: () => app.quit(),
					},
				]),
			);
			tray.on("click", this.showWindow);
			return tray;
		} catch (error) {
			tray.destroy();
			throw error;
		}
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
