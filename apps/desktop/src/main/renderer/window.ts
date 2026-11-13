import { desktopOrigin } from "@anishelf/contracts/defaults";
import { app, BrowserWindow, type Session, type WebContents } from "electron";
import { isDesktopPage } from "../renderer-url.js";

export function createDesktopWindow(
	desktopSession: Session,
	preload: string,
	windows: Set<WebContents>,
	openExternal: (url: string) => Promise<void>,
) {
	const window = new BrowserWindow({
		width: 1280,
		height: 800,
		webPreferences: {
			session: desktopSession,
			preload,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
		},
	});
	const contents = window.webContents;
	windows.add(contents);
	contents.once("destroyed", () => windows.delete(contents));
	window.setMenu(null);
	contents.setWindowOpenHandler(({ url }) => {
		void Promise.resolve()
			.then(() => openExternal(url))
			.catch(() => {
				console.warn("desktop.external_navigation_rejected");
			});
		return { action: "deny" };
	});
	contents.on("will-frame-navigate", (event) => {
		if (!event.isMainFrame || !isDesktopPage(event.url)) event.preventDefault();
	});
	contents.on("will-redirect", (event) => event.preventDefault());
	contents.on("will-attach-webview", (event) => event.preventDefault());
	console.info("desktop.renderer_loading", { origin: desktopOrigin });
	void window.loadURL(`${desktopOrigin}/`).catch((error: unknown) => {
		if (window.isDestroyed()) return;
		console.error("desktop.renderer_load_failed", { error });
		app.exit(1);
	});
}
