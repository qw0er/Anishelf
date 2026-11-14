import { fileURLToPath } from "node:url";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import {
	app,
	BrowserWindow,
	clipboard,
	session,
	type WebContents,
} from "electron";
import { registerDesktopIpc } from "./ipc.js";
import { downloadMedia } from "./native/download.js";
import { createExternalPlayerService } from "./native/external-players.js";
import { openExternal } from "./native/links.js";
import { registerRendererProtocol } from "./protocol.js";
import {
	attachDeviceCredentials,
	signInDevice,
} from "./server/device-authentication.js";
import { openDeviceTokenStore } from "./server/device-tokens.js";

const rendererUrl = `${desktopOrigin}/`;
const preload = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

export class DesktopApplication {
	private readonly windows = new Set<WebContents>();
	private readonly cleanup: Array<() => void> = [];
	private openingWindow = false;

	constructor(private readonly onFailure: (error: unknown) => void) {}

	async start(origin: string): Promise<void> {
		const tokens = await openDeviceTokenStore(origin, app.getPath("userData"));
		const externalPlayers = createExternalPlayerService(
			app.getPath("userData"),
		);
		this.cleanup.push(
			attachDeviceCredentials(
				session.defaultSession,
				origin,
				() => tokens.authorization(),
				this.windows,
			),
		);
		this.cleanup.push(
			registerDesktopIpc(
				{
					getServerOrigin: async () => origin,
					signIn: (password) =>
						signInDevice(origin, password, (token) => tokens.set(token)),
					clearDeviceToken: () => tokens.set(null),
					copyText: async (text) => {
						if (typeof text !== "string")
							throw new Error("Expected clipboard text.");
						clipboard.writeText(text);
					},
					openExternal,
					downloadFile: async (sender, url, filename) => {
						downloadMedia(sender, origin, url, filename);
					},
					listExternalPlayers: () => externalPlayers.list(),
					addExternalPlayer: (draft) => externalPlayers.add(draft),
					removeExternalPlayer: (id) => externalPlayers.remove(id),
					choosePlayerExecutable: (sender) =>
						externalPlayers.chooseExecutable(
							BrowserWindow.fromWebContents(sender),
						),
					launchExternalPlayer: (sender, id, mediaUrl, mimeType) =>
						externalPlayers.launch(
							BrowserWindow.fromWebContents(sender),
							id,
							mediaUrl,
							mimeType,
						),
				},
				this.windows,
			),
		);
		this.cleanup.push(registerRendererProtocol(origin));
		await this.createWindow();
		app.on("activate", this.onActivate);
		this.cleanup.push(() => app.off("activate", this.onActivate));
	}

	dispose(): void {
		for (const cleanup of this.cleanup.splice(0).reverse()) cleanup();
	}

	showWindow(): void {
		const contents = this.windows.values().next().value;
		const window = contents && BrowserWindow.fromWebContents(contents);
		if (window) {
			if (window.isMinimized()) window.restore();
			window.show();
			window.focus();
			return;
		}
		if (this.openingWindow) return;
		this.openingWindow = true;
		void this.createWindow()
			.catch(this.onFailure)
			.finally(() => {
				this.openingWindow = false;
			});
	}

	private readonly onActivate = () => {
		if (this.windows.size === 0) this.showWindow();
	};

	private async createWindow() {
		const window = new BrowserWindow({
			width: 1280,
			height: 800,
			webPreferences: {
				preload,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		if (process.platform !== "darwin") window.removeMenu();
		const contents = window.webContents;
		this.windows.add(contents);
		contents.once("destroyed", () => this.windows.delete(contents));
		contents.on("will-navigate", (event, url) => {
			// Session changes reload the same local document with a new hash route.
			if (url.split("#", 1)[0] !== rendererUrl) event.preventDefault();
		});
		contents.setWindowOpenHandler(() => ({ action: "deny" }));
		try {
			await window.loadURL(rendererUrl);
		} catch (error) {
			if (!window.isDestroyed()) window.destroy();
			throw error;
		}
		console.info("desktop.window_opened");
	}
}
