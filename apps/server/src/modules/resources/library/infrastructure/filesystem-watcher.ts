import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { AsyncSubscription, Event } from "@parcel/watcher";
import type { Logger } from "pino";
import { relativePathParts } from "../../../../platform/paths.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { MonitorState } from "../domain/model.js";
import type { LibraryPolicy } from "../policy.js";

const writeSampleIntervalMs = 100;
const rootCheckIntervalMs = 1000;

interface PendingWrite {
	sample?: { size: bigint; mtimeNs: bigint; since: number };
}

interface WatchSession {
	root: string;
	identity: BigIntStats;
	subscription?: AsyncSubscription;
	failure?: { error: unknown };
	rootTimer?: ReturnType<typeof setTimeout>;
	writeTimer?: ReturnType<typeof setTimeout>;
	writes: Map<string, PendingWrite>;
}

/** Adapts native events to paths that are ready for incremental processing. */
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
		this.clearTimers(this.session);
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
			const { subscribe } = await import("@parcel/watcher");
			if (this.stopped) return;
			const session: WatchSession = { root, identity, writes: new Map() };
			this.session = session;
			session.subscription = await subscribe(
				root,
				(error, events) => {
					if (!this.isActive(session)) return;
					if (error) this.fail(error);
					else this.receive(session, events);
				},
				process.platform === "win32" ? { backend: "windows" } : undefined,
			);
			if (this.stopped) return;
			await this.checkRoot(session);
			if (session.failure) throw session.failure.error;
			if (this.stopped) return;
			this.current = { status: "watching", error: null };
			this.scheduleRootCheck(session);
			this.options.logger.info(
				{ event: "library.monitor_started", watcher: "@parcel/watcher" },
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
		this.clearTimers(session);
		try {
			await session?.subscription?.unsubscribe();
		} catch (error) {
			// Keep the handle available for cleanup on the next restart.
			this.session = session;
			throw error;
		}
	}
	private clearTimers(session: WatchSession | undefined): void {
		if (!session) return;
		clearTimeout(session.rootTimer);
		clearTimeout(session.writeTimer);
		session.writes.clear();
	}
	private isActive(session: WatchSession): boolean {
		return !this.stopped && this.session === session && !session.failure;
	}
	private fail(error: unknown): void {
		if (this.stopped || this.current.status === "degraded") return;
		const session = this.session;
		if (session) session.failure = { error };
		this.clearTimers(session);
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
		// ReadDirectoryChangesW may keep watching the old directory after a rename.
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
	private receive(session: WatchSession, events: readonly Event[]): void {
		for (const event of events) {
			if (!isAbsolute(event.path)) continue;
			const path = relative(session.root, event.path);
			if (!path) {
				this.fail(
					new Error("The resource root changed; reconciliation is required."),
				);
				return;
			}
			if (!relativePathParts(path)) continue;
			if (event.type === "delete") {
				session.writes.delete(path);
				this.options.onChange(path);
			} else {
				// A new event invalidates any read of this path still in flight.
				const prior = session.writes.get(path);
				session.writes.set(path, event.type === "create" ? {} : { ...prior });
				if (session.writes.size > this.options.policy.maximumPendingChanges) {
					this.fail(new Error("The resource write queue exceeded its limit."));
					return;
				}
			}
		}
		this.scheduleWriteSamples(session);
	}
	private scheduleWriteSamples(session: WatchSession): void {
		if (!this.isActive(session) || session.writeTimer || !session.writes.size)
			return;
		session.writeTimer = setTimeout(() => {
			void this.sampleWrites(session).finally(() => {
				delete session.writeTimer;
				this.scheduleWriteSamples(session);
			});
		}, writeSampleIntervalMs).unref();
	}
	private async sampleWrites(session: WatchSession): Promise<void> {
		const changes = [...session.writes];
		const { concurrency } = this.options.policy;
		try {
			for (
				let cursor = 0;
				cursor < changes.length && this.isActive(session);
				cursor += concurrency
			) {
				await Promise.all(
					changes
						.slice(cursor, cursor + concurrency)
						.map(([path, pending]) => this.sampleWrite(session, path, pending)),
				);
			}
		} catch (error) {
			if (this.isActive(session)) this.fail(error);
		}
	}
	private async sampleWrite(
		session: WatchSession,
		path: string,
		pending: PendingWrite,
	): Promise<void> {
		if (session.writes.get(path) !== pending) return;
		const info = await lstat(join(session.root, path), { bigint: true }).catch(
			(error: NodeJS.ErrnoException) => {
				if (
					session.writes.get(path) !== pending ||
					error.code === "ENOENT" ||
					error.code === "ENOTDIR"
				)
					return;
				throw error;
			},
		);
		if (session.writes.get(path) !== pending) return;
		if (info?.isFile()) {
			const now = performance.now();
			const prior = pending.sample;
			if (
				!prior ||
				prior.size !== info.size ||
				prior.mtimeNs !== info.mtimeNs
			) {
				pending.sample = { size: info.size, mtimeNs: info.mtimeNs, since: now };
				return;
			}
			if (now - prior.since < this.options.policy.writeStabilityMs) return;
		}
		session.writes.delete(path);
		this.options.onChange(path);
	}
}
