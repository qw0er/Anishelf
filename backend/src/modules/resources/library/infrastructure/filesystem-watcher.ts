import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { Logger } from "pino";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { MonitorState } from "../domain/model.js";
import type { LibraryPolicy } from "../policy.js";

/** Native event adapter only; scheduling, dirty paths and recovery belong to the application. */
export class FilesystemWatcher {
	private watcher: FSWatcher | undefined;
	private root: string | undefined;
	private starting: Promise<void> | undefined;
	private cancelReady: (() => void) | undefined;
	private stopped = false;
	private current: MonitorState = { status: "disabled", error: null };
	constructor(
		private readonly options: {
			policy: DeepReadonly<LibraryPolicy>;
			logger: Logger;
			onChange(path: string): void;
			onError(error: unknown): void;
		},
	) {}
	get state(): MonitorState {
		return { ...this.current };
	}
	async start(path: string, restart = false): Promise<void> {
		if (this.stopped) return;
		const root = await realpath(path);
		if (this.stopped) return;
		if (
			!restart &&
			this.root === root &&
			this.watcher &&
			this.current.status !== "degraded"
		) {
			await this.starting;
			return;
		}
		await this.reset();
		if (this.stopped) return;
		this.root = root;
		this.current = { status: "starting", error: null };
		const watcher = chokidar.watch(root, {
			ignoreInitial: true,
			followSymlinks: false,
			atomic: true,
			awaitWriteFinish: {
				stabilityThreshold: this.options.policy.writeStabilityMs,
				pollInterval: 100,
			},
		});
		this.watcher = watcher;
		const failed = (error: unknown) => {
			if (this.watcher !== watcher || this.stopped) return;
			this.current = {
				status: "degraded",
				error:
					"Resource monitoring needs recovery. Retry or run a manual scan.",
			};
			this.options.onError(error);
		};
		this.starting = new Promise<void>((resolve, reject) => {
			this.cancelReady = resolve;
			watcher.once("ready", () => {
				if (this.watcher === watcher && this.current.status !== "degraded") {
					this.current = { status: "watching", error: null };
					this.options.logger.info(
						{ event: "library.monitor_started" },
						"Resource monitoring started.",
					);
				}
				resolve();
			});
			watcher.on("error", (error) => {
				failed(error);
				reject(error);
			});
		});
		watcher.on("all", (_event, path) => {
			if (this.watcher !== watcher || this.stopped) return;
			const local = relative(root, path);
			if (!local) {
				failed(
					new Error("The resource root changed; reconciliation is required."),
				);
				return;
			}
			if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
				return;
			this.options.onChange(local);
		});
		try {
			await this.starting;
		} finally {
			this.starting = undefined;
		}
	}
	private async reset(): Promise<void> {
		this.cancelReady?.();
		this.cancelReady = undefined;
		const watcher = this.watcher;
		this.watcher = undefined;
		this.root = undefined;
		await watcher?.close();
	}
	async close(): Promise<void> {
		this.stopped = true;
		await this.reset();
		this.current = { status: "disabled", error: null };
	}
}
