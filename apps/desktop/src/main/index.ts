import { fileURLToPath } from "node:url";
import { desktopOrigin } from "@anishelf/contracts/defaults";
import { app, BrowserWindow, dialog } from "electron";
import { registerDesktopIpc } from "./ipc.js";
import {
	registerRendererProtocol,
	registerRendererScheme,
} from "./protocol.js";
import { resolveServerOrigin } from "./server-address.js";

const rendererUrl = `${desktopOrigin}/`;
const preload = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

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
		registerDesktopIpc(origin);
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
