import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { app, dialog } from "electron";
import { userDataDir } from "platformdirs";
import { DesktopApplication } from "./application.js";
import { registerRendererScheme } from "./protocol.js";
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

function startApplication() {
	registerRendererScheme();
	let desktop: DesktopApplication | undefined;
	app.on("second-instance", () => {
		console.info("desktop.second_instance_received");
		desktop?.showWindow();
	});

	app.whenReady().then(async () => {
		const application = new DesktopApplication((error) => {
			application.dispose();
			reportStartupFailure(error);
		});
		try {
			await application.start(await readServerOrigin(profileDir));
			desktop = application;
			app.once("will-quit", () => application.dispose());
		} catch (error) {
			application.dispose();
			reportStartupFailure(error);
		}
	});
}

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
