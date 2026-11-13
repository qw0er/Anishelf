import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, session, shell } from "electron";
import { createDesktopDeviceSession } from "./device-session.js";
import { startDesktopGateway } from "./gateway.js";
import { startLocalBackend } from "./local-backend.js";
import { defaultDesktopDevUrl, desktopApiTarget } from "./renderer-defaults.js";

let gateway: Awaited<ReturnType<typeof startDesktopGateway>> | undefined;
let backend: ReturnType<typeof startLocalBackend> | undefined;
let shuttingDown = false;

function closeGateway() {
	gateway?.close();
	gateway = undefined;
}

async function exitDesktop(code: number) {
	if (shuttingDown) return;
	shuttingDown = true;
	closeGateway();
	try {
		await backend?.stop();
	} finally {
		app.exit(code);
	}
}

function httpUrl(value: string, variable: string): URL {
	const url = URL.parse(value);
	if (
		!url ||
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password
	)
		throw new Error(`${variable} must be an HTTP(S) URL without credentials.`);
	return url;
}

async function desktopWindowOptions() {
	const development =
		!app.isPackaged && process.argv.includes("--renderer-dev");
	if (development) {
		return {
			development,
			rendererUrl: httpUrl(
				process.env.ANISHELF_DESKTOP_URL ?? defaultDesktopDevUrl,
				"ANISHELF_DESKTOP_URL",
			),
			partition: "persist:anishelf-desktop-dev",
		};
	}
	const serverArgument = process.argv.find((argument) =>
		argument.startsWith("--server="),
	);
	const target = httpUrl(
		serverArgument?.slice("--server=".length) ?? desktopApiTarget(),
		"Anishelf server address",
	);
	if (target.href !== `${target.origin}/`)
		throw new Error("ANISHELF_API_TARGET must be a server origin.");
	const port = Number(process.env.ANISHELF_DESKTOP_GATEWAY_PORT ?? 5175);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error(
			"ANISHELF_DESKTOP_GATEWAY_PORT must be an integer from 1 to 65535.",
		);
	const device =
		target.protocol === "https:"
			? await createDesktopDeviceSession(target, app.getPath("userData"))
			: undefined;
	if (!device && !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
		throw new Error("A remote Anishelf server must use HTTPS.");
	const executable = process.env.ANISHELF_DESKTOP_BACKEND_EXECUTABLE;
	const managed = Boolean(
		executable || process.argv.includes("--managed-backend"),
	);
	if (managed && executable && !isAbsolute(executable))
		throw new Error(
			"ANISHELF_DESKTOP_BACKEND_EXECUTABLE must be an absolute path.",
		);
	if (managed && !executable && app.isPackaged)
		throw new Error(
			"Set ANISHELF_DESKTOP_BACKEND_EXECUTABLE to run a managed backend from this installation.",
		);
	if (managed) {
		backend = startLocalBackend({
			executable: executable ?? "node",
			...(executable
				? {}
				: {
						entry: fileURLToPath(
							new URL("../../server/dist/index.js", import.meta.url),
						),
					}),
			dataDir:
				process.env.ANISHELF_DATA_DIR ??
				join(app.getPath("userData"), "server"),
			target,
			onExit: () => {
				void exitDesktop(1);
			},
		});
		await backend.ready();
	}
	gateway = await startDesktopGateway({
		rendererRoot: fileURLToPath(new URL("./renderer/", import.meta.url)),
		target,
		port,
		...(device ? { device } : {}),
	});
	const serverId = createHash("sha256").update(target.origin).digest("hex");
	const partition = `persist:anishelf-desktop-${serverId}`;
	if (device) {
		const { url, secret } = gateway;
		session
			.fromPartition(partition)
			.webRequest.onBeforeSendHeaders(
				{ urls: [`${url.origin}/api`, `${url.origin}/api/*`] },
				(details, callback) => {
					const requestHeaders = details.requestHeaders;
					if (
						details.initiatorOrigin === url.origin ||
						(!details.initiatorOrigin &&
							details.resourceType === "media" &&
							URL.parse(details.frame?.url ?? "")?.origin === url.origin)
					)
						requestHeaders["X-Anishelf-Desktop"] = secret;
					callback({ requestHeaders });
				},
			);
	}
	return {
		development,
		rendererUrl: gateway.url,
		partition,
	};
}

function openExternal(url: string) {
	const parsed = URL.parse(url);
	if (
		!parsed ||
		!["http:", "https:"].includes(parsed.protocol) ||
		parsed.username ||
		parsed.password
	) {
		console.warn("Blocked an unsupported external URL.");
		return;
	}
	void shell.openExternal(parsed.href).catch((error: unknown) => {
		console.error("Failed to open an external URL:", error);
	});
}

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

function createWindow({
	development,
	rendererUrl,
	partition,
}: Awaited<ReturnType<typeof desktopWindowOptions>>) {
	const window = new BrowserWindow({
		width: 1280,
		height: 800,
		webPreferences: {
			partition,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
		},
	});

	window.setMenu(null);
	window.webContents.setWindowOpenHandler(({ url }) => {
		openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (URL.parse(url)?.origin !== rendererUrl.origin) {
			event.preventDefault();
			openExternal(url);
		}
	});
	window.webContents.on("will-redirect", (event, url) => {
		if (URL.parse(url)?.origin !== rendererUrl.origin) event.preventDefault();
	});
	console.info(`Loading desktop page from ${rendererUrl.origin}`);
	const loading = development
		? loadRenderer(window, rendererUrl)
		: window.loadURL(rendererUrl.href);
	void loading.catch((error: unknown) => {
		if (window.isDestroyed()) return;
		console.error("Failed to load the desktop renderer:", error);
		void exitDesktop(1);
	});
}

app
	.whenReady()
	.then(async () => {
		const options = await desktopWindowOptions();
		createWindow(options);
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow(options);
		});
	})
	.catch((error: unknown) => {
		if (shuttingDown) return;
		console.error("Desktop startup failed:", error);
		dialog.showErrorBox(
			"Anishelf could not start",
			error instanceof Error ? error.message : "Unexpected startup failure.",
		);
		void exitDesktop(1);
	});

app.on("before-quit", (event) => {
	if (shuttingDown) return;
	event.preventDefault();
	void exitDesktop(0);
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
