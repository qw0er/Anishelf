import { hostname } from "node:os";
import { clipboard, ipcMain, type WebContents } from "electron";
import type { DesktopBridge } from "../ipc/desktop.js";
import { downloadMedia } from "./native/download.js";
import { openExternal, openPlayer } from "./native/links.js";
import { isDesktopPage } from "./renderer-url.js";

export function registerDesktopIpc(
	origin: string,
	setDeviceToken: (token: unknown) => Promise<void>,
	windows: ReadonlySet<WebContents>,
) {
	const deviceName = `Anishelf Desktop (${hostname()})`
		.replace(/[\p{Cc}\p{Cf}]/gu, "")
		.slice(0, 80);

	function handle<Method extends keyof DesktopBridge>(
		channel: `desktop:${Method}`,
		handler: (
			sender: WebContents,
			...args: Parameters<DesktopBridge[Method]>
		) =>
			| Awaited<ReturnType<DesktopBridge[Method]>>
			| ReturnType<DesktopBridge[Method]>,
	) {
		ipcMain.handle(
			channel,
			(event, ...args: Parameters<DesktopBridge[Method]>) => {
				const frame = event.senderFrame;
				if (
					!windows.has(event.sender) ||
					!frame ||
					frame !== event.sender.mainFrame ||
					!isDesktopPage(frame.url)
				) {
					console.warn("desktop.ipc_sender_rejected", { channel });
					throw new Error("Invalid desktop IPC sender.");
				}
				return handler(event.sender, ...args);
			},
		);
	}

	handle("desktop:configuration", () => ({ origin, deviceName }));
	handle("desktop:setDeviceToken", (_, token) => setDeviceToken(token));
	handle("desktop:copyText", (_, text) => {
		if (typeof text !== "string") throw new Error("Expected clipboard text.");
		clipboard.writeText(text);
	});
	handle("desktop:openExternal", (_, url) => openExternal(url));
	handle("desktop:openPlayer", (_, url) => openPlayer(url));
	handle("desktop:downloadFile", (sender, url, filename) =>
		downloadMedia(sender, origin, url, filename),
	);
}
