import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { Logger } from "pino";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { SourceError } from "../domain/model.js";
import {
	type BootstrapState,
	JackettBootstrapStateFile,
} from "./bootstrap-state.js";
import type { JackettConnection } from "./connection.js";
import type { JackettConfiguration } from "./model.js";
import { provisionPublicSite } from "./provisioning.js";

const nativeSchema = Type.Object(
	{
		APIKey: Type.String({ minLength: 1, maxLength: 4096 }),
		AdminPassword: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	},
	{ additionalProperties: true },
);
function missing(error: unknown) {
	return (
		error &&
		typeof error === "object" &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
interface BundledOptions {
	path?: string;
	dataDir: string;
	connection: JackettConnection;
	logger: Logger;
	/** Fixed service address in production; injectable for isolated acceptance tests. */
	url?: string;
	request?: typeof fetch;
}
/** A single background worker owns native credential import and first-run setup. */
export class BundledJackett {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running: Promise<void> | undefined;
	private readonly shutdown = new AbortController();
	private readonly store: JackettBootstrapStateFile;
	private failures = 0;
	private started = false;
	available = false;
	setup: "waiting" | "pending" | "complete" | "manual" = "waiting";
	constructor(private readonly options: BundledOptions) {
		this.store = new JackettBootstrapStateFile(options.dataDir);
	}
	private get url() {
		return this.options.url ?? "http://jackett:9117/";
	}
	private async read() {
		if (!this.options.path) throw new SourceError("bundled_unavailable");
		const metadata = await stat(this.options.path);
		if (!metadata.isFile() || metadata.size > 64 * 1024)
			throw new SourceError("invalid_configuration");
		const value: unknown = JSON.parse(
			await readFile(this.options.path, "utf8"),
		);
		if (!Check(nativeSchema, value))
			throw new SourceError("invalid_configuration");
		return value;
	}
	private value(apiKey: string, indexers: string[]): JackettConfiguration {
		return {
			version: 1,
			generation: randomUUID(),
			connection: { url: this.url, apiKey, origin: "bundled", indexers },
		};
	}
	private async update(state: BootstrapState) {
		this.shutdown.signal.throwIfAborted();
		await this.store.write(state);
		this.setup = state.phase === "attempted" ? "manual" : state.phase;
	}
	private async run(): Promise<void> {
		let state = await this.store.read();
		let native: Awaited<ReturnType<BundledJackett["read"]>>;
		try {
			native = await this.read();
		} catch (error) {
			if (missing(error) && !state)
				await this.update({ version: 1, instance: null, phase: "waiting" });
			throw error;
		}
		this.shutdown.signal.throwIfAborted();
		this.available = true;
		const instance = createHash("sha256").update(native.APIKey).digest("hex");
		if (!state) {
			// An already-existing installation is never treated as a fresh service.
			state = { version: 1, instance, phase: "manual" };
			await this.update(state);
		} else if (state.instance && state.instance !== instance) {
			await this.update({ ...state, instance, phase: "manual" });
			this.options.logger.warn(
				{ event: "acquisition.jackett_bootstrap_identity_changed" },
				"Bundled credentials changed; select the connection explicitly and review site setup.",
			);
			return;
		} else if (state.phase === "waiting") {
			state = { ...state, instance, phase: "pending" };
			await this.update(state);
		}
		this.setup = state.phase === "attempted" ? "manual" : state.phase;
		const connection = this.options.connection;
		const indexers = connection.matchesBundled(this.url, native.APIKey)
			? connection.settings().indexers
			: state.phase === "pending"
				? ["nyaasi"]
				: [];
		await connection.importBundled(this.value(native.APIKey, indexers));
		this.shutdown.signal.throwIfAborted();
		if (!connection.matchesBundled(this.url, native.APIKey)) return;
		if (state.phase === "attempted") {
			await this.update({ ...state, phase: "manual" });
			this.options.logger.warn(
				{ event: "acquisition.jackett_setup_review_required" },
				"A previous site write is uncertain; finish setup in Jackett management.",
			);
			return;
		}
		if (state.phase !== "pending") return;
		if (native.AdminPassword) {
			await this.update({ ...state, phase: "manual" });
			this.options.logger.warn(
				{ event: "acquisition.jackett_setup_review_required" },
				"Jackett management authentication is configured; finish site setup there.",
			);
			return;
		}
		const generation = connection.settings().generation;
		const guard = () => {
			this.shutdown.signal.throwIfAborted();
			if (
				!connection.current(generation) ||
				!connection.matchesBundled(this.url, native.APIKey)
			)
				throw new SourceError("source_conflict");
		};
		try {
			await provisionPublicSite({
				url: this.url,
				signal: AbortSignal.any([
					this.shutdown.signal,
					connection.signal(generation),
				]),
				guard,
				beforeWrite: () =>
					this.update({ version: 1, instance, phase: "attempted" }),
				...(this.options.request ? { request: this.options.request } : {}),
			});
			guard();
			await this.update({ version: 1, instance, phase: "complete" });
			this.options.logger.info(
				{ event: "acquisition.jackett_setup_completed", providerId: "nyaasi" },
				"Bundled public site setup completed.",
			);
		} catch (error) {
			if (
				error instanceof SourceError &&
				error.code === "bundled_management_required"
			) {
				await this.update({ version: 1, instance, phase: "manual" });
				this.options.logger.warn(
					{ event: "acquisition.jackett_setup_review_required" },
					"Jackett management requires manual site setup.",
				);
				return;
			}
			throw error;
		}
		return;
	}
	private schedule(delay: number) {
		if (this.shutdown.signal.aborted) return;
		this.timer = setTimeout(() => {
			void this.tick();
		}, delay);
		this.timer.unref();
	}
	private tick(): Promise<void> {
		if (this.running || this.shutdown.signal.aborted)
			return this.running ?? Promise.resolve();
		const task = (async () => {
			try {
				await this.run();
			} catch (error) {
				if (this.shutdown.signal.aborted) return;
				this.failures++;
				if (!missing(error) && this.failures === 1)
					this.options.logger.warn(
						{ event: "acquisition.jackett_bootstrap_unavailable" },
						"Bundled source setup will retry; existing connections are preserved.",
					);
				this.schedule(
					Math.min(300_000, 5000 * 2 ** Math.min(this.failures - 1, 6)),
				);
			}
		})();
		this.running = task;
		void task.finally(() => {
			this.running = undefined;
		});
		return task;
	}
	start() {
		if (!this.options.path || this.started || this.shutdown.signal.aborted)
			return;
		this.started = true;
		this.schedule(0);
	}
	async activate(generation: string) {
		try {
			const native = await this.read();
			this.shutdown.signal.throwIfAborted();
			const connection = this.options.connection;
			const indexers = connection.matchesBundled(this.url, native.APIKey)
				? connection.settings().indexers
				: [];
			await connection.importBundled(
				this.value(native.APIKey, indexers),
				generation,
			);
			this.available = true;
			if (this.timer) clearTimeout(this.timer);
			// Restart the worker without changing its durable first-run authorization.
			if (this.running) await this.running;
			this.schedule(0);
		} catch (error) {
			if (error instanceof SourceError) throw error;
			throw new SourceError("bundled_unavailable");
		}
	}
	async close() {
		this.shutdown.abort();
		if (this.timer) clearTimeout(this.timer);
		await this.running;
	}
}
