import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import {
	app,
	BrowserWindow,
	clipboard,
	net,
	session,
	type WebContents,
} from "electron";
import type { ServerSignInResult } from "../ipc/desktop.js";
import { registerDesktopIpc } from "./ipc.js";
import { downloadMedia } from "./native/download.js";
import { createExternalPlayerService } from "./native/external-players.js";
import { openExternal } from "./native/links.js";
import { DesktopUpdateChecker } from "./native/updates.js";
import { registerRendererProtocol } from "./protocol.js";
import {
	attachDeviceCredentials,
	signInDevice,
} from "./server/device-authentication.js";
import { openDeviceTokenStore } from "./server/device-tokens.js";
import { parseServerOrigin } from "./server-address.js";
import {
	checkServerConnection,
	writeServerOrigin,
} from "./server-connection.js";
import { WindowStateStore } from "./window-state.js";

const rendererUrl = `${desktopOrigin}/`;
const preload = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

type DeviceTokenStore = Awaited<ReturnType<typeof openDeviceTokenStore>>;

async function createUpdateChecker() {
	const version = app.getVersion();
	let stable = false;
	if (app.isPackaged) {
		try {
			const manifest: unknown = JSON.parse(
				await readFile(new URL("../build-info.json", import.meta.url), "utf8"),
			);
			stable =
				!!manifest &&
				typeof manifest === "object" &&
				"version" in manifest &&
				manifest.version === version &&
				"channel" in manifest &&
				manifest.channel === "stable";
		} catch (error) {
			console.warn("desktop.update_build_info_unavailable", { error });
		}
	}
	return new DesktopUpdateChecker(
		{ version, stable, platform: process.platform, arch: process.arch },
		(url, options) => net.fetch(url, options),
	);
}

interface ConnectedServer {
	origin: string;
	tokens: DeviceTokenStore;
}

export class DesktopApplication {
	private readonly windows = new Set<WebContents>();
	private readonly cleanup: Array<() => void> = [];
	private openingWindow = false;
	private signingIn = false;
	private server!: ConnectedServer;
	private readonly tokenStores = new Map<string, DeviceTokenStore>();
	private detachCredentials?: () => void;

	constructor(private readonly onFailure: (error: unknown) => void) {}

	async start(origin: string): Promise<void> {
		this.activateServer(await this.openServer(origin));
		this.cleanup.push(() => this.detachCredentials?.());
		const externalPlayers = createExternalPlayerService(
			app.getPath("userData"),
		);
		const updates = await createUpdateChecker();
		this.cleanup.push(
			registerDesktopIpc(
				{
					checkForUpdates: () => updates.check(),
					getServerOrigin: async () => this.server.origin,
					signIn: (origin, password) => this.signIn(origin, password),
					clearDeviceToken: async (origin) => {
						const server = this.server;
						if (origin === server.origin) await server.tokens.set(null);
					},
					copyText: async (text) => {
						if (typeof text !== "string")
							throw new Error("Expected clipboard text.");
						clipboard.writeText(text);
					},
					openExternal,
					downloadFile: async (sender, url, filename) => {
						downloadMedia(sender, this.server.origin, url, filename);
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
		this.cleanup.push(registerRendererProtocol(() => this.server.origin));
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

	private async openServer(origin: string): Promise<ConnectedServer> {
		let tokens = this.tokenStores.get(origin);
		if (!tokens) {
			tokens = await openDeviceTokenStore(origin, app.getPath("userData"));
			this.tokenStores.set(origin, tokens);
		}
		return { origin, tokens };
	}

	private activateServer(server: ConnectedServer) {
		this.detachCredentials?.();
		this.detachCredentials = attachDeviceCredentials(
			session.defaultSession,
			server.origin,
			() => server.tokens.authorization(),
			this.windows,
		);
		this.server = server;
		console.info("desktop.server_configured", { origin: server.origin });
	}

	private async signIn(
		target: unknown,
		password: unknown,
	): Promise<ServerSignInResult> {
		if (this.signingIn) return { status: "busy" };
		const origin = parseServerOrigin(target);
		if (!origin) return { status: "invalidAddress" };
		this.signingIn = true;
		try {
			const health = await checkServerConnection(origin);
			if (health !== "ok") return { status: health };

			const login = await signInDevice(origin, password);
			if ("status" in login) {
				if (login.status === 0) return { status: "unreachable" };
				return { status: "rejected", httpStatus: login.status };
			}

			const server =
				origin === this.server.origin
					? this.server
					: await this.openServer(origin);
			await writeServerOrigin(app.getPath("userData"), origin);
			await server.tokens.set(login.token);
			if (server !== this.server) this.activateServer(server);
			console.info("desktop.device_signed_in", { origin });
			return { status: "ok", origin };
		} catch {
			console.error("desktop.server_sign_in_failed");
			return { status: "saveFailed" };
		} finally {
			this.signingIn = false;
		}
	}

	private async createWindow() {
		const windowState = new WindowStateStore(app.getPath("userData"));
		const savedState = windowState.read();
		const window = new BrowserWindow({
			...windowState.windowOptions(savedState),
			...(process.platform === "linux"
				? {
						icon: fileURLToPath(
							new URL(
								app.isPackaged
									? "../icon.png"
									: "../../../web/public/icon-512.png",
								import.meta.url,
							),
						),
					}
				: {}),
			webPreferences: {
				preload,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		windowState.manage(window, savedState);
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
