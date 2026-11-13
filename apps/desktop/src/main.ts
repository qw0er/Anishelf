import { setTimeout } from "node:timers/promises";
import { developmentDefaults } from "@anishelf/contracts/defaults";
import { app, BrowserWindow } from "electron";

async function loadRenderer(window: BrowserWindow, rendererUrl: URL) {
	const deadline = Date.now() + 30_000;
	let waiting = false;
	while (!window.isDestroyed()) {
		try {
			await window.loadURL(rendererUrl.href);
			return;
		} catch (error) {
			if (window.isDestroyed()) return;
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "ERR_CONNECTION_REFUSED" ||
				Date.now() >= deadline
			)
				throw error;
			if (!waiting) {
				console.info("Waiting for the desktop renderer to accept connections.");
				waiting = true;
			}
			await setTimeout(500);
		}
	}
}

function createWindow(rendererUrl: URL) {
	const window = new BrowserWindow({
		width: 1280,
		height: 800,
	});

	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event, url) => {
		if (new URL(url).origin !== rendererUrl.origin) {
			event.preventDefault();
		}
	});
	console.info(`Loading desktop page from ${rendererUrl.origin}`);
	void loadRenderer(window, rendererUrl).catch((error) => {
		console.error("Failed to load the desktop development page:", error);
		app.exit(1);
	});
}

app
	.whenReady()
	.then(() => {
		const value =
			process.env.ANISHELF_DESKTOP_URL ??
			`http://${developmentDefaults.host}:${developmentDefaults.port}`;
		const rendererUrl = URL.parse(value);
		if (
			!rendererUrl ||
			!["http:", "https:"].includes(rendererUrl.protocol) ||
			rendererUrl.username ||
			rendererUrl.password
		)
			throw new Error(
				"ANISHELF_DESKTOP_URL must be an HTTP(S) URL without credentials.",
			);
		createWindow(rendererUrl);
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow(rendererUrl);
		});
	})
	.catch((error: unknown) => {
		console.error("Desktop startup failed:", error);
		app.exit(1);
	});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
