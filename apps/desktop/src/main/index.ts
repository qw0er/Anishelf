import { app, BrowserWindow, dialog, net, protocol } from "electron";

const rendererUrl = "anishelf://desktop/";
const rendererRoot = new URL("../renderer/", import.meta.url);

protocol.registerSchemesAsPrivileged([
	{
		scheme: "anishelf",
		privileges: { standard: true, secure: true },
	},
]);

function registerRenderer() {
	protocol.handle("anishelf", async (request) => {
		const url = new URL(request.url);
		const path = url.pathname === "/" ? "/index.html" : url.pathname;
		// Vite emits flat, hashed asset names. Serve only the entry and those assets.
		if (
			url.host !== "desktop" ||
			request.method !== "GET" ||
			(path !== "/index.html" && !/^\/assets\/[\w.-]+\.(?:js|css)$/.test(path))
		) {
			return new Response(null, { status: 404 });
		}

		const response = await net.fetch(new URL(path.slice(1), rendererRoot).href);
		const headers = new Headers(response.headers);
		headers.set(
			"Content-Security-Policy",
			"default-src 'none'; script-src 'self'; style-src 'self'",
		);
		return new Response(response.body, { status: response.status, headers });
	});
}

async function createWindow() {
	const window = new BrowserWindow({
		width: 1280,
		height: 800,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	await window.loadURL(rendererUrl);
	console.info("desktop.window_opened");
}

app.whenReady().then(async () => {
	try {
		registerRenderer();
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
