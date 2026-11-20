import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { app, dialog } from "electron";
import { userDataDir } from "platformdirs";
import { DesktopApplication } from "./application.js";
import { LAUNCH_AT_LOGIN_FLAG } from "./native/login-item.js";
import { registerRendererScheme } from "./protocol.js";
import { LocalBackend } from "./server/local-backend.js";
import { readServerOrigin } from "./server-connection.js";

const profileOverride = app.commandLine.getSwitchValue("user-data-dir");
const profileDir = profileOverride
	? resolve(profileOverride)
	: join(userDataDir("anishelf", false), "desktop");
mkdirSync(profileDir, { recursive: true, mode: 0o700 });
app.setPath("userData", profileDir);
app.setPath("sessionData", profileDir);
console.info("desktop.data_directory_configured", { path: profileDir });

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
	console.info("desktop.second_instance_exit");
	app.quit();
} else {
	startApplication();
}

function launchedAtLogin(): boolean {
	if (process.platform !== "darwin")
		return process.argv.includes(LAUNCH_AT_LOGIN_FLAG);
	try {
		return app.getLoginItemSettings().wasOpenedAtLogin;
	} catch (error) {
		console.warn("desktop.login_item_launch_detection_failed", { error });
		return false;
	}
}

function configureNvidiaVaapi() {
	if (process.platform !== "linux") return;
	const feature = "VaapiOnNvidiaGPUs";
	const { commandLine } = app;
	const enabledFeatures = commandLine.getSwitchValue("enable-features");
	const disabledFeatures = commandLine.getSwitchValue("disable-features");
	const includesFeature = (features: string) =>
		features
			.split(",")
			.some((entry) => entry.trim().split(/[<:]/, 1)[0] === feature);
	if (includesFeature(disabledFeatures) || includesFeature(enabledFeatures))
		return;
	commandLine.appendSwitch(
		"enable-features",
		[enabledFeatures, feature].filter(Boolean).join(","),
	);
	console.info("desktop.chromium_feature_enabled_by_default", { feature });
}

function startApplication() {
	configureNvidiaVaapi();
	registerRendererScheme();
	let desktop: DesktopApplication | undefined;
	let backend: LocalBackend | undefined;
	let quitting = false;
	let recovering = false;
	let exitCode = 0;

	async function stopLocalBackend() {
		const active = backend;
		await active?.close();
		if (backend === active) backend = undefined;
	}

	function startLocalBackend() {
		if (quitting || backend) throw new Error("Local backend is unavailable.");
		backend = new LocalBackend(profileDir, (error) => {
			void recover(error);
		});
		return backend.start();
	}

	function stop() {
		if (quitting) return;
		quitting = true;
		void (async () => {
			try {
				desktop?.dispose();
			} finally {
				await stopLocalBackend();
			}
		})()
			.catch((error: unknown) => {
				console.error("desktop.shutdown_failed", { error });
				exitCode = 1;
			})
			.finally(() => app.exit(exitCode));
	}

	async function recover(error: unknown) {
		if (quitting || recovering) return;
		recovering = true;
		console.error("desktop.start_failed", { error });
		exitCode = 1;
		desktop?.dispose();
		const failedBackend = backend;
		await stopLocalBackend().catch((shutdownError: unknown) => {
			console.error("desktop.backend_shutdown_failed", {
				error: shutdownError,
			});
		});
		if (quitting) return;
		const logDirectory = join(profileDir, "logs");
		const logPath = join(logDirectory, "desktop-failure.log");
		let detail: string | undefined;
		try {
			await mkdir(logDirectory, { recursive: true, mode: 0o700 });
			await writeFile(
				logPath,
				`${new Date().toISOString()} desktop.start_failed
${inspect(error)}
${failedBackend?.diagnostics ?? ""}`,
				{ mode: 0o600 },
			);
			detail = `Diagnostic log
${logPath}`;
		} catch (error) {
			console.warn("desktop.diagnostic_log_failed", { error });
		}
		if (quitting) return;
		const { response } = await dialog
			.showMessageBox({
				type: "error",
				title: "Anishelf",
				message: "Anishelf could not start or its local backend stopped.",
				...(detail ? { detail } : {}),
				buttons: ["Restart Anishelf", "Quit"],
				cancelId: 1,
			})
			.catch(() => ({ response: 1 }));
		if (quitting) return;
		if (response === 0) {
			app.relaunch();
			exitCode = 0;
		}
		stop();
	}

	app.on("before-quit", (event) => {
		event.preventDefault();
		stop();
	});
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);

	app.on("second-instance", () => {
		console.info("desktop.second_instance_received");
		desktop?.showWindow();
	});

	void app
		.whenReady()
		.then(async () => {
			const externalOrigin = await readServerOrigin(profileDir);
			if (quitting) return;
			const connection = externalOrigin ?? (await startLocalBackend());
			if (quitting) return;
			desktop = new DesktopApplication(
				(error) => void recover(error),
				startLocalBackend,
				stopLocalBackend,
			);
			const startHidden = launchedAtLogin();
			if (startHidden) console.info("desktop.launched_at_login");
			await desktop.start(connection, { startHidden });
		})
		.catch(recover);
}

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
