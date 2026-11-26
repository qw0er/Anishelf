import { desktopOrigin } from "@anishelf/contracts/defaults";
import { ipcMain, type WebContents } from "electron";
import type {
	DesktopBridge,
	DesktopLoginItemState,
	DesktopMenuCommand,
	DesktopUpdateCheck,
	ExternalPlayerListResponse,
	ServerSignInResult,
} from "../ipc/desktop.js";

/**
 * Main-process handlers. Unlike the preload-facing DesktopBridge, these receive
 * the sender for native dialogs and treat IPC arguments as untrusted.
 */
export interface DesktopIpcHandlers {
	offlineCache: {
		list: DesktopBridge["offlineCache"]["list"];
		start(target: unknown): Promise<void>;
		cancel(id: unknown): Promise<void>;
		retry(id: unknown): Promise<void>;
		remove(id: unknown): Promise<void>;
		open(
			sender: WebContents,
			id: unknown,
		): ReturnType<DesktopBridge["offlineCache"]["open"]>;
		position(
			sender: WebContents,
			lease: unknown,
			positionMs: unknown,
		): Promise<void>;
		close(sender: WebContents, lease: unknown): Promise<void>;
	};
	checkForUpdates(): Promise<DesktopUpdateCheck>;
	setLanguage(language: unknown): Promise<void>;
	consumePendingMenuCommand(
		sender: WebContents,
	): Promise<DesktopMenuCommand | null>;
	getLaunchAtLogin(): Promise<DesktopLoginItemState>;
	setLaunchAtLogin(enabled: unknown): Promise<void>;
	getCloseToTray(): Promise<boolean>;
	setCloseToTray(enabled: unknown): Promise<void>;
	setWindowControlsColors(
		sender: WebContents,
		color: unknown,
		symbolColor: unknown,
	): Promise<void>;
	getServerConnection: DesktopBridge["getServerConnection"];
	useLocalBackend: DesktopBridge["useLocalBackend"];
	signIn(origin: unknown, password: unknown): Promise<ServerSignInResult>;
	clearDeviceToken(origin: unknown): Promise<void>;
	copyText(text: string): Promise<void>;
	chooseDirectory(sender: WebContents): Promise<string | null>;
	openExternal(url: string): Promise<void>;
	downloadFile(
		sender: WebContents,
		url: unknown,
		filename: unknown,
		id: unknown,
	): Promise<boolean>;
	revealDownload(sender: WebContents, id: unknown): Promise<void>;
	listExternalPlayers(): Promise<ExternalPlayerListResponse>;
	addExternalPlayer(draft: unknown): Promise<void>;
	removeExternalPlayer(id: unknown): Promise<void>;
	choosePlayerExecutable(sender: WebContents): Promise<string | null>;
	launchExternalPlayer(
		sender: WebContents,
		id: unknown,
		mediaUrl: unknown,
		mimeType: unknown,
	): Promise<void>;
}

export function registerDesktopIpc(
	handlers: DesktopIpcHandlers,
	windows: ReadonlySet<WebContents>,
) {
	const channels: string[] = [];
	function handle<Args extends unknown[], Result>(
		channel: string,
		action: (sender: WebContents, ...args: Args) => Promise<Result>,
	) {
		ipcMain.handle(channel, (event, ...args: Args) => {
			const frame = event.senderFrame;
			if (
				!windows.has(event.sender) ||
				!frame ||
				frame !== event.sender.mainFrame ||
				frame.origin !== desktopOrigin
			) {
				console.warn("desktop.ipc_sender_rejected", { channel });
				throw new Error("Unexpected desktop IPC sender.");
			}
			return action(event.sender, ...args);
		});
		channels.push(channel);
	}

	function unregister() {
		for (const channel of channels.splice(0)) ipcMain.removeHandler(channel);
	}

	try {
		handle("desktop:check-for-updates", () => handlers.checkForUpdates());
		handle("desktop:language:set", (_, language) =>
			handlers.setLanguage(language),
		);
		handle("desktop:menu:consume-pending", (sender) =>
			handlers.consumePendingMenuCommand(sender),
		);
		handle("desktop:login-item:get", () => handlers.getLaunchAtLogin());
		handle("desktop:login-item:set", (_, enabled) =>
			handlers.setLaunchAtLogin(enabled),
		);
		handle("desktop:tray:get", handlers.getCloseToTray);
		handle("desktop:tray:set", (_, enabled) =>
			handlers.setCloseToTray(enabled),
		);
		handle(
			"desktop:window-controls:set-colors",
			handlers.setWindowControlsColors,
		);
		handle("desktop:server-connection", handlers.getServerConnection);
		handle("desktop:use-local-backend", handlers.useLocalBackend);
		handle("desktop:sign-in", (_, origin, password) =>
			handlers.signIn(origin, password),
		);
		handle("desktop:clear-device-token", (_, origin) =>
			handlers.clearDeviceToken(origin),
		);
		handle("desktop:copy-text", (_, text: string) => handlers.copyText(text));
		handle("desktop:choose-directory", (sender) =>
			handlers.chooseDirectory(sender),
		);
		handle("desktop:open-external", (_, url: string) =>
			handlers.openExternal(url),
		);
		handle("desktop:download-file", handlers.downloadFile);
		handle("desktop:reveal-download", handlers.revealDownload);
		const cache = handlers.offlineCache;
		handle("desktop:cache:list", cache.list);
		handle("desktop:cache:start", (_, target) => cache.start(target));
		handle("desktop:cache:cancel", (_, id) => cache.cancel(id));
		handle("desktop:cache:retry", (_, id) => cache.retry(id));
		handle("desktop:cache:remove", (_, id) => cache.remove(id));
		handle("desktop:cache:open", cache.open);
		handle("desktop:cache:position", cache.position);
		handle("desktop:cache:close", cache.close);
		handle("desktop:external-players:list", () =>
			handlers.listExternalPlayers(),
		);
		handle("desktop:external-players:add", (_, draft) =>
			handlers.addExternalPlayer(draft),
		);
		handle("desktop:external-players:remove", (_, id) =>
			handlers.removeExternalPlayer(id),
		);
		handle("desktop:external-players:choose-executable", (sender) =>
			handlers.choosePlayerExecutable(sender),
		);
		handle(
			"desktop:external-players:launch",
			(sender, id, mediaUrl, mimeType) =>
				handlers.launchExternalPlayer(sender, id, mediaUrl, mimeType),
		);
	} catch (error) {
		unregister();
		throw error;
	}
	return unregister;
}
