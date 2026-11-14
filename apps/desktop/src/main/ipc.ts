import { desktopOrigin } from "@anishelf/contracts/defaults";
import { ipcMain, type WebContents } from "electron";
import type {
	DesktopBridge,
	DesktopUpdateCheck,
	ExternalPlayerListResponse,
	ServerSignInResult,
} from "../ipc/desktop.js";

/**
 * Main-process handlers. Unlike the preload-facing DesktopBridge, these receive
 * the sender for native dialogs and treat IPC arguments as untrusted.
 */
export interface DesktopIpcHandlers {
	checkForUpdates(): Promise<DesktopUpdateCheck>;
	getServerConnection: DesktopBridge["getServerConnection"];
	useLocalBackend: DesktopBridge["useLocalBackend"];
	signIn(origin: unknown, password: unknown): Promise<ServerSignInResult>;
	clearDeviceToken(origin: unknown): Promise<void>;
	copyText(text: string): Promise<void>;
	openExternal(url: string): Promise<void>;
	downloadFile(
		sender: WebContents,
		url: string,
		filename: string,
	): Promise<void>;
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
		handle("desktop:server-connection", handlers.getServerConnection);
		handle("desktop:use-local-backend", handlers.useLocalBackend);
		handle("desktop:sign-in", (_, origin, password) =>
			handlers.signIn(origin, password),
		);
		handle("desktop:clear-device-token", (_, origin) =>
			handlers.clearDeviceToken(origin),
		);
		handle("desktop:copy-text", (_, text: string) => handlers.copyText(text));
		handle("desktop:open-external", (_, url: string) =>
			handlers.openExternal(url),
		);
		handle("desktop:download-file", handlers.downloadFile);
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
