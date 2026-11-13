import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	session,
	type WebContents,
} from "electron";
import { registerDesktopIpc } from "./ipc.js";
import { openExternal } from "./native/links.js";
import {
	registerDesktopScheme,
	registerRendererFiles,
} from "./renderer/protocol.js";
import { createDesktopWindow } from "./renderer/window.js";
import { attachDeviceCredentials, serverAddress } from "./server/connection.js";
import { openDeviceTokenStore } from "./server/device-tokens.js";

registerDesktopScheme();

const windows = new Set<WebContents>();
const rendererRoot = fileURLToPath(new URL("../renderer/", import.meta.url));
const preload = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

async function prepareSession() {
	const target = serverAddress();
	const userData = app.getPath("userData");
	const serverId = createHash("sha256").update(target.origin).digest("hex");
	const desktopSession = session.fromPartition(
		`persist:anishelf-desktop-${serverId}`,
	);
	const tokens = await openDeviceTokenStore(target.origin, userData);
	registerRendererFiles(desktopSession, target.origin, rendererRoot);
	attachDeviceCredentials(
		desktopSession,
		target.origin,
		tokens.authorization,
		windows,
	);
	registerDesktopIpc(target.origin, tokens.set, windows);
	return desktopSession;
}

app
	.whenReady()
	.then(async () => {
		const desktopSession = await prepareSession();
		createDesktopWindow(desktopSession, preload, windows, openExternal);
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0)
				createDesktopWindow(desktopSession, preload, windows, openExternal);
		});
	})
	.catch((error: unknown) => {
		console.error("desktop.start_failed", { error });
		dialog.showErrorBox(
			"Anishelf could not start",
			error instanceof Error ? error.message : "Unexpected startup failure.",
		);
		app.exit(1);
	});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
