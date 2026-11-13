import { desktopOrigin } from "@anishelf/contracts/defaults";
import { ipcMain } from "electron";

export function registerDesktopIpc(serverOrigin: string) {
	ipcMain.handle("desktop:server-origin", (event) => {
		const frame = event.senderFrame;
		if (
			!frame ||
			frame !== event.sender.mainFrame ||
			frame.origin !== desktopOrigin
		) {
			console.warn("desktop.server_origin_request_rejected");
			throw new Error("Unexpected sender for desktop server configuration.");
		}
		return serverOrigin;
	});
}
