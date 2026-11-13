import { desktopOrigin } from "@anishelf/contracts/defaults";
import { ipcMain, type WebContents } from "electron";
import type { DesktopBridge } from "../ipc/desktop.js";

export function registerDesktopIpc(
	bridge: DesktopBridge,
	windows: ReadonlySet<WebContents>,
) {
	function handle<Args extends unknown[], Result>(
		channel: string,
		action: (...args: Args) => Promise<Result>,
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
			return action(...args);
		});
	}

	handle("desktop:server-origin", bridge.getServerOrigin);
	handle("desktop:sign-in", bridge.signIn);
	handle("desktop:clear-device-token", bridge.clearDeviceToken);
}
