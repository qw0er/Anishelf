import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { FSWatcher } from "chokidar";
import type { Logger } from "pino";
import { relativePathParts } from "../../../../platform/paths.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { MonitorState } from "../domain/model.js";
import type { LibraryPolicy } from "../policy.js";

const rootCheckIntervalMs = 1000;

interface WatchSession {
	root: string;
	identity: BigIntStats;
	watcher: FSWatcher;
	ready: PromiseWithResolvers<void>;
	rootTimer?: ReturnType<typeof setTimeout>;
}

/** Adapts Chokidar events to paths ready for incremental processing. */
export class FilesystemWatcher {
	private session: WatchSession | undefined;
	private operation = Promise.resolve();
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

	start(path: string, restart = false): Promise<void> {
		if (this.stopped) return this.operation;
		const starting = this.operation.then(() => this.open(path, restart));
		this.operation = starting.catch(() => {});
		return starting;
	}

	close(): Promise<void> {
		if (this.stopped) return this.operation;
		this.stopped = true;
		this.session?.ready.resolve();
		clearTimeout(this.session?.rootTimer);
		this.current = { status: "disabled", error: null };
		this.operation = this.operation.then(() => this.reset());
		return this.operation;
	}

	private async open(path: string, restart: boolean): Promise<void> {
		if (this.stopped) return;
		try {
			const root = await realpath(path);
			if (this.stopped) return;
			if (
				!restart &&
				this.session?.root === root &&
				this.current.status === "watching"
			) {
				await this.checkRoot(this.session);
				return;
			}
			await this.reset();
			if (this.stopped) return;
			this.current = { status: "starting", error: null };
			const identity = await lstat(root, { bigint: true });
			if (!identity.isDirectory())
				throw new Error("The resource root is not a directory.");
			const { watch } = await import("chokidar");
			if (this.stopped) return;
			const watcher = watch(root, {
				ignoreInitial: true,
				followSymlinks: false,
				usePolling: false,
				atomic: true,
				awaitWriteFinish: {
					stabilityThreshold: this.options.policy.writeStabilityMs,
					pollInterval: 100,
				},
			});
			const ready = Promise.withResolvers<void>();
			const session: WatchSession = { root, identity, watcher, ready };
			this.session = session;
			watcher.once("ready", () => ready.resolve());
			watcher.on("error", (error) => {
				if (!this.isActive(session)) return;
				this.fail(error);
			});
			watcher.on("all", (_event, path) => this.receive(session, path));
			await ready.promise;
			if (this.stopped) return;
			await this.checkRoot(session);
			if (this.stopped) return;
			if (!this.isActive(session))
				throw new Error("Filesystem monitoring failed while starting.");
			this.current = { status: "watching", error: null };
			this.scheduleRootCheck(session);
			this.options.logger.info(
				{ event: "library.monitor_started", watcher: "chokidar" },
				"Resource monitoring started.",
			);
		} catch (error) {
			this.fail(error);
			throw error;
		}
	}

	private async reset(): Promise<void> {
		const session = this.session;
		this.session = undefined;
		clearTimeout(session?.rootTimer);
		try {
			await session?.watcher.close();
		} catch (error) {
			// Keep the handle available for cleanup on the next restart.
			this.session = session;
			throw error;
		}
	}

	private isActive(session: WatchSession): boolean {
		return (
			!this.stopped &&
			this.session === session &&
			this.current.status !== "degraded"
		);
	}

	private fail(error: unknown): void {
		if (this.stopped || this.current.status === "degraded") return;
		clearTimeout(this.session?.rootTimer);
		if (this.current.status === "starting") this.session?.ready.reject(error);
		this.current = {
			status: "degraded",
			error: "Resource monitoring needs recovery. Retry or run a manual scan.",
		};
		this.options.onError(error);
	}

	private async checkRoot(session: WatchSession): Promise<void> {
		const identity = await lstat(session.root, { bigint: true });
		if (
			!identity.isDirectory() ||
			identity.dev !== session.identity.dev ||
			identity.ino !== session.identity.ino
		) {
			throw new Error("The resource root changed; reconciliation is required.");
		}
	}

	private scheduleRootCheck(session: WatchSession): void {
		// An event watcher can keep its old directory handle after a rename.
		session.rootTimer = setTimeout(() => {
			void this.checkRoot(session).then(
				() => {
					if (this.isActive(session)) this.scheduleRootCheck(session);
				},
				(error) => {
					if (this.isActive(session)) this.fail(error);
				},
			);
		}, rootCheckIntervalMs).unref();
	}

	private receive(session: WatchSession, path: string): void {
		if (!this.isActive(session) || !isAbsolute(path)) return;
		const local = relative(session.root, path);
		if (!local) {
			this.fail(
				new Error("The resource root changed; reconciliation is required."),
			);
			return;
		}
		if (relativePathParts(local)) this.options.onChange(local);
	}
}
