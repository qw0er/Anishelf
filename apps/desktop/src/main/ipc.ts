import { desktopOrigin } from "@anishelf/contracts/defaults";
import { ipcMain, type WebContents } from "electron";
import type { DesktopBridge } from "../ipc/desktop.js";

export function registerDesktopIpc(
	bridge: Omit<DesktopBridge, "downloadFile"> & {
		downloadFile(
			sender: WebContents,
			url: string,
			filename: string,
		): Promise<void>;
	},
	windows: ReadonlySet<WebContents>,
) {
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
	}

	handle("desktop:server-origin", bridge.getServerOrigin);
	handle("desktop:sign-in", (_, password: string) => bridge.signIn(password));
	handle("desktop:clear-device-token", bridge.clearDeviceToken);
	handle("desktop:copy-text", (_, text: string) => bridge.copyText(text));
	handle("desktop:open-external", (_, url: string) => bridge.openExternal(url));
	handle("desktop:open-player", (_, url: string) => bridge.openPlayer(url));
	handle("desktop:download-file", bridge.downloadFile);
}
