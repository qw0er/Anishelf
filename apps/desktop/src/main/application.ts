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
import {
	createDesktopLoginItem,
	LAUNCH_AT_LOGIN_FLAG,
} from "./native/login-item.js";
import { DesktopTray } from "./native/tray.js";
import { DesktopUpdateChecker } from "./native/updates.js";
import { registerRendererProtocol } from "./protocol.js";
import {
	attachDeviceCredentials,
	signInDevice,
} from "./server/device-authentication.js";
import { isDeviceToken, openDeviceTokenStore } from "./server/device-tokens.js";
import { parseServerOrigin } from "./server-address.js";
import {
	checkServerConnection,
	writeServerOrigin,
} from "./server-connection.js";
import { WindowStateStore } from "./window-state.js";

const rendererUrl = `${desktopOrigin}/`;
const iconPath = () =>
	fileURLToPath(
		new URL(
			app.isPackaged ? "../icon.png" : "../../../web/public/icon-512.png",
			import.meta.url,
		),
	);
const preload = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

type DeviceTokenStore = Awaited<ReturnType<typeof openDeviceTokenStore>>;

function createLoginItem() {
	return createDesktopLoginItem({
		platform: process.platform,
		packaged: app.isPackaged,
		appDataDir: app.getPath("appData"),
		executablePath: process.execPath,
		appImagePath: process.env.APPIMAGE,
		native:
			process.platform === "darwin"
				? {
						getOpenAtLogin: () => app.getLoginItemSettings().openAtLogin,
						setOpenAtLogin: (openAtLogin) =>
							app.setLoginItemSettings({ openAtLogin }),
					}
				: {
						getOpenAtLogin: () =>
							app.getLoginItemSettings({ args: [LAUNCH_AT_LOGIN_FLAG] })
								.openAtLogin,
						setOpenAtLogin: (openAtLogin) =>
							app.setLoginItemSettings({
								openAtLogin,
								args: [LAUNCH_AT_LOGIN_FLAG],
							}),
					},
	});
}

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

type ConnectedServer =
	| { kind: "external"; origin: string; tokens: DeviceTokenStore }
	| { kind: "local"; origin: string; deviceToken: string };

function connectLocalBackend(backend: { origin: string; deviceToken: string }) {
	const address = URL.parse(backend.origin);
	if (
		address?.protocol !== "http:" ||
		address.hostname !== "127.0.0.1" ||
		!address.port ||
		address.origin !== backend.origin ||
		!isDeviceToken(backend.deviceToken)
	)
		throw new Error("Invalid local backend connection.");
	return {
		kind: "local",
		origin: backend.origin,
		deviceToken: backend.deviceToken,
	} as const;
}

function logLocalShutdownFailure(error: unknown) {
	console.warn("desktop.backend_shutdown_failed", { error });
}

export class DesktopApplication {
	private readonly windows = new Set<WebContents>();
	private readonly cleanup: Array<() => void> = [];
	private tray: DesktopTray | undefined;
	private openingWindow = false;
	private switching = false;
	private disposed = false;
	private startHidden = false;
	private hiddenWindowMode:
		| { maximized: boolean; fullscreen: boolean }
		| undefined;
	private server!: ConnectedServer;
	private readonly tokenStores = new Map<string, DeviceTokenStore>();
	private detachCredentials?: () => void;

	constructor(
		private readonly onFailure: (error: unknown) => void,
		private readonly startLocalBackend: () => Promise<{
			origin: string;
			deviceToken: string;
		}>,
		private readonly stopLocalBackend: () => Promise<void>,
	) {}

	async start(
		connection: string | { origin: string; deviceToken: string },
		options: { startHidden?: boolean } = {},
	): Promise<void> {
		this.startHidden = options.startHidden ?? false;
		const server =
			typeof connection === "string"
				? await this.openExternalServer(connection)
				: connectLocalBackend(connection);
		this.activateServer(server);
		this.tray = new DesktopTray(() => this.showWindow(), iconPath());
		this.cleanup.push(() => this.tray?.dispose());
		this.cleanup.push(() => this.detachCredentials?.());
		const externalPlayers = createExternalPlayerService(
			app.getPath("userData"),
		);
		const updates = await createUpdateChecker();
		const loginItem = createLoginItem();
		try {
			console.info("desktop.login_item_loaded", loginItem.state());
		} catch (error) {
			console.warn("desktop.login_item_state_failed", { error });
		}
		this.cleanup.push(
			registerDesktopIpc(
				{
					checkForUpdates: () => updates.check(),
					getLaunchAtLogin: async () => {
						try {
							return loginItem.state();
						} catch (error) {
							console.warn("desktop.login_item_state_failed", { error });
							return { supported: false, enabled: false };
						}
					},
					setLaunchAtLogin: async (enabled) => {
						if (this.disposed)
							throw new Error("Desktop application is shutting down.");
						try {
							loginItem.setEnabled(enabled);
						} catch (error) {
							console.warn("desktop.login_item_save_failed", { error });
							throw error;
						}
					},
					getCloseToTray: async () => this.tray?.enabled ?? false,
					setCloseToTray: async (enabled) => {
						if (this.disposed || !this.tray)
							throw new Error("Desktop tray unavailable.");
						this.tray.setEnabled(enabled);
					},
					getServerConnection: async () => ({
						kind: this.server.kind,
						origin: this.server.origin,
					}),
					useLocalBackend: () => this.useLocalBackend(),
					signIn: (origin, password) => this.signIn(origin, password),
					clearDeviceToken: async (origin) => {
						const server = this.server;
						if (server.kind === "external" && origin === server.origin)
							await server.tokens.set(null);
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
		this.disposed = true;
		for (const cleanup of this.cleanup.splice(0).reverse()) cleanup();
	}

	showWindow(): void {
		if (this.disposed) return;
		const contents = this.windows.values().next().value;
		const window = contents && BrowserWindow.fromWebContents(contents);
		if (window) {
			if (window.isMinimized()) window.restore();
			const mode = this.hiddenWindowMode;
			this.hiddenWindowMode = undefined;
			if (mode?.maximized) window.maximize();
			if (mode?.fullscreen) window.setFullScreen(true);
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
		this.showWindow();
	};

	private async openExternalServer(origin: string) {
		let tokens = this.tokenStores.get(origin);
		if (!tokens) {
			tokens = await openDeviceTokenStore(origin, app.getPath("userData"));
			this.tokenStores.set(origin, tokens);
		}
		return { kind: "external", origin, tokens } as const;
	}

	private activateServer(server: ConnectedServer) {
		this.detachCredentials?.();
		this.detachCredentials = attachDeviceCredentials(
			session.defaultSession,
			server.origin,
			() =>
				server.kind === "local"
					? `Bearer ${server.deviceToken}`
					: server.tokens.authorization(),
			this.windows,
		);
		this.server = server;
		console.info("desktop.server_configured", { origin: server.origin });
	}

	private async signIn(
		target: unknown,
		password: unknown,
	): Promise<ServerSignInResult> {
		if (this.switching || this.disposed) return { status: "busy" };
		const origin = parseServerOrigin(target);
		if (!origin) return { status: "invalidAddress" };
		if (this.server.kind === "local" && origin === this.server.origin)
			return { status: "rejected", httpStatus: 403 };
		this.switching = true;
		try {
			const health = await checkServerConnection(origin);
			if (health !== "ok") return { status: health };

			const login = await signInDevice(origin, password);
			if ("status" in login) {
				if (login.status === 0) return { status: "unreachable" };
				return { status: "rejected", httpStatus: login.status };
			}

			const server =
				this.server.kind === "external" && origin === this.server.origin
					? this.server
					: await this.openExternalServer(origin);
			await server.tokens.set(login.token);
			if (this.disposed) return { status: "busy" };
			await writeServerOrigin(app.getPath("userData"), origin);
			if (this.disposed) return { status: "busy" };
			const leavingLocal = this.server.kind === "local";
			if (server !== this.server) this.activateServer(server);
			if (leavingLocal)
				await this.stopLocalBackend().catch(logLocalShutdownFailure);
			console.info("desktop.device_signed_in", { origin });
			return { status: "ok", origin };
		} catch {
			console.error("desktop.server_sign_in_failed");
			return { status: "saveFailed" };
		} finally {
			this.switching = false;
		}
	}

	private async useLocalBackend(): Promise<ServerSignInResult> {
		if (this.switching || this.disposed) return { status: "busy" };
		if (this.server.kind === "local")
			return { status: "ok", origin: this.server.origin };

		this.switching = true;
		try {
			let server: ReturnType<typeof connectLocalBackend>;
			try {
				server = connectLocalBackend(await this.startLocalBackend());
			} catch (error) {
				console.warn("desktop.local_backend_start_failed", { error });
				await this.stopLocalBackend().catch(logLocalShutdownFailure);
				return { status: "localStartFailed" };
			}
			try {
				if (this.disposed) return { status: "busy" };
				await writeServerOrigin(app.getPath("userData"), null);
			} catch (error) {
				console.warn("desktop.local_backend_save_failed", { error });
				await this.stopLocalBackend().catch(logLocalShutdownFailure);
				return { status: "saveFailed" };
			}
			if (this.disposed) return { status: "busy" };
			this.activateServer(server);
			return { status: "ok", origin: server.origin };
		} finally {
			this.switching = false;
		}
	}

	private async createWindow() {
		const startHidden = this.startHidden && this.tray?.enabled === true;
		if (this.startHidden) {
			console.info("desktop.window_start_mode", {
				launchedAtLogin: true,
				hidden: startHidden,
			});
			this.startHidden = false;
		}
		const windowState = new WindowStateStore(app.getPath("userData"));
		const savedState = windowState.read();
		const window = new BrowserWindow({
			...windowState.windowOptions(savedState),
			show: !startHidden,
			...(process.platform === "linux"
				? {
						icon: iconPath(),
					}
				: {}),
			webPreferences: {
				preload,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		windowState.manage(window, savedState, { applyMode: !startHidden });
		if (startHidden && savedState)
			this.hiddenWindowMode = {
				maximized: savedState.maximized,
				fullscreen: savedState.fullscreen,
			};
		window.on("close", (event) => {
			if (this.disposed || !this.tray?.enabled) return;
			event.preventDefault();
			window.hide();
			console.debug("desktop.window_hidden_to_tray");
		});
		if (process.platform !== "darwin") window.removeMenu();
		const contents = window.webContents;
		this.windows.add(contents);
		contents.once("destroyed", () => {
			this.windows.delete(contents);
			this.hiddenWindowMode = undefined;
		});
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
		console.info("desktop.window_opened", { hidden: startHidden });
	}
}
