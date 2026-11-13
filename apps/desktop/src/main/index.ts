import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	session,
	type WebContents,
} from "electron";
import { userDataDir } from "platformdirs";
import { registerDesktopIpc } from "./ipc.js";
import { downloadMedia } from "./native/download.js";
import { openExternal, openPlayer } from "./native/links.js";
import {
	registerRendererProtocol,
	registerRendererScheme,
} from "./protocol.js";
import {
	attachDeviceCredentials,
	signInDevice,
} from "./server/device-authentication.js";
import { openDeviceTokenStore } from "./server/device-tokens.js";
import { resolveServerOrigin } from "./server-address.js";

const rendererUrl = `${desktopOrigin}/`;
const preload = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
const windows = new Set<WebContents>();

const profileOverride = app.commandLine.getSwitchValue("user-data-dir");
const profileDir = profileOverride
	? resolve(profileOverride)
	: join(userDataDir("anishelf", false), "desktop");
mkdirSync(profileDir, { recursive: true, mode: 0o700 });
app.setPath("userData", profileDir);
app.setPath("sessionData", profileDir);
console.info("desktop.data_directory_configured", { path: profileDir });

registerRendererScheme();

async function createWindow() {
	const window = new BrowserWindow({
		width: 1280,
		height: 800,
		webPreferences: {
			preload,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	if (process.platform !== "darwin") window.removeMenu();
	const contents = window.webContents;
	windows.add(contents);
	contents.once("destroyed", () => windows.delete(contents));
	contents.on("will-navigate", (event, url) => {
		// Session changes reload the same local document with a new hash route.
		if (url.split("#", 1)[0] !== rendererUrl) event.preventDefault();
	});
	contents.setWindowOpenHandler(() => ({ action: "deny" }));
	await window.loadURL(rendererUrl);
	console.info("desktop.window_opened");
}

app.whenReady().then(async () => {
	let origin: string;
	try {
		origin = resolveServerOrigin();
		console.info("desktop.server_configured", { origin });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Invalid server configuration.";
		console.error("desktop.server_configuration_invalid", { message });
		dialog.showErrorBox("Invalid Anishelf server address", message);
		app.exit(1);
		return;
	}

	try {
		const tokens = await openDeviceTokenStore(origin, app.getPath("userData"));
		attachDeviceCredentials(
			session.defaultSession,
			origin,
			tokens.authorization,
			windows,
		);
		registerDesktopIpc(
			{
				getServerOrigin: async () => origin,
				signIn: (password) => signInDevice(origin, password, tokens.set),
				clearDeviceToken: () => tokens.set(null),
				copyText: async (text) => {
					if (typeof text !== "string")
						throw new Error("Expected clipboard text.");
					clipboard.writeText(text);
				},
				openExternal,
				openPlayer,
				downloadFile: async (sender, url, filename) => {
					downloadMedia(sender, origin, url, filename);
				},
			},
			windows,
		);
		registerRendererProtocol(origin);
		await createWindow();
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				void createWindow().catch(reportStartupFailure);
			}
		});
	} catch (error) {
		reportStartupFailure(error);
	}
});

function reportStartupFailure(error: unknown) {
	console.error("desktop.start_failed", { error });
	dialog.showErrorBox(
		"Anishelf could not start",
		"Could not open the desktop window.",
	);
	app.exit(1);
}

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
