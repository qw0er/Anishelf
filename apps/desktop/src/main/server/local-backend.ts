import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, type UtilityProcess, utilityProcess } from "electron";
import { isDeviceToken } from "./device-tokens.js";

const startupTimeoutMs = 20_000;
const shutdownTimeoutMs = 5_000;

interface BackendConnection {
	origin: string;
	deviceToken: string;
}

export class LocalBackend {
	private readonly child: UtilityProcess;
	private readonly exited: Promise<number>;
	private readonly ready: Promise<BackendConnection>;
	private stopping: Promise<void> | undefined;
	private running = false;

	constructor(profileDir: string, onExit: (error: Error) => void) {
		const appPath = app.getAppPath();
		const backendPath = app.isPackaged
			? join(appPath, "dist/backend/app/bootstrap/desktop.js")
			: join(appPath, "../server/dist/desktop.js");
		this.child = utilityProcess.fork(
			join(appPath, "backend-process.mjs"),
			[backendPath, join(profileDir, "backend")],
			{ serviceName: "Anishelf Backend" },
		);
		this.child.on("error", (type, location) => {
			console.error("desktop.backend_process_error", { type, location });
		});
		this.exited = new Promise((resolve) => {
			this.child.once("exit", (code) => {
				resolve(code);
				if (this.running && !this.stopping) {
					this.running = false;
					onExit(
						new Error(`Local backend exited unexpectedly (code ${code}).`),
					);
				}
			});
		});
		this.ready = this.waitUntilReady();
	}

	start(): Promise<BackendConnection> {
		return this.ready;
	}

	close(): Promise<void> {
		this.stopping ??= this.stop();
		return this.stopping;
	}

	private waitUntilReady(): Promise<BackendConnection> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => fail(new Error("Local backend startup timed out.")),
				startupTimeoutMs,
			);
			const fail = (error: Error) => {
				cleanup();
				reject(error);
			};
			const onExit = (code: number) =>
				fail(
					new Error(`Local backend exited before it was ready (code ${code}).`),
				);
			const onMessage = (message: unknown) => {
				if (
					!message ||
					typeof message !== "object" ||
					!("type" in message) ||
					message.type !== "ready" ||
					!("origin" in message) ||
					typeof message.origin !== "string" ||
					!("deviceToken" in message) ||
					!isDeviceToken(message.deviceToken)
				) {
					fail(new Error("Invalid local backend readiness message."));
					return;
				}
				cleanup();
				this.running = true;
				console.info("desktop.backend_ready", { origin: message.origin });
				resolve({ origin: message.origin, deviceToken: message.deviceToken });
			};
			const cleanup = () => {
				clearTimeout(timer);
				this.child.off("message", onMessage);
				this.child.off("exit", onExit);
			};
			this.child.on("message", onMessage);
			this.child.on("exit", onExit);
		});
	}

	private async stop(): Promise<void> {
		if (this.child.pid === undefined) {
			// A stop during launch must still reach the child once it has spawned.
			this.child.once("spawn", () => this.child.postMessage("shutdown"));
		} else {
			this.child.postMessage("shutdown");
		}
		const code = await Promise.race([
			this.exited,
			delay(shutdownTimeoutMs, undefined, { ref: false }),
		]);
		if (code === undefined) {
			console.warn("desktop.backend_shutdown_timeout");
			this.child.kill();
			const terminated = await Promise.race([
				this.exited,
				delay(2_000, undefined, { ref: false }),
			]);
			if (terminated === undefined)
				throw new Error("Local backend did not exit after termination.");
		} else if (code !== 0 && this.running) {
			console.warn("desktop.backend_shutdown_failed", { code });
		}
		console.info("desktop.backend_stopped");
	}
}
