import { fileURLToPath } from "node:url";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import {
	app,
	BrowserWindow,
	dialog,
	session,
	type WebContents,
} from "electron";
import { registerDesktopIpc } from "./ipc.js";
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
	const contents = window.webContents;
	windows.add(contents);
	contents.once("destroyed", () => windows.delete(contents));
	contents.on("will-navigate", (event) => event.preventDefault());
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
