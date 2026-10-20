import { QBittorrent, TorrentClientError } from "@ctrl/qbittorrent";
import { Check } from "typebox/value";
import {
	type AddDownload,
	type DownloadTask,
	type QbittorrentApi,
	QbittorrentError,
	type QbittorrentFailureCode,
	type QbittorrentOptions,
} from "./domain/model.js";
import {
	filesSchema,
	preferencesSchema,
	tasksSchema,
} from "./infrastructure/schema.js";

function inputError(): never {
	throw new QbittorrentError("invalid-input", "not-sent");
}
function hashValue(value: string): string {
	if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) inputError();
	return value.toLowerCase();
}
function text(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 4096 &&
		!/[\r\n\0]/.test(value)
	);
}

export class QbittorrentClient implements QbittorrentApi {
	private readonly sdk: QBittorrent;
	private readonly shutdown = new AbortController();
	private readonly pending = new Set<Promise<unknown>>();
	private authentication: Promise<void> | undefined;
	private readonly logger;

	constructor(options: QbittorrentOptions) {
		let url: URL;
		try {
			url = new URL(options.url);
		} catch {
			inputError();
		}
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			!text(options.username) ||
			!text(options.password)
		)
			inputError();
		url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
		const timeoutMs = options.timeoutMs ?? 30_000;
		if (
			!Number.isSafeInteger(timeoutMs) ||
			timeoutMs < 1 ||
			timeoutMs > 2_147_483_647
		)
			inputError();
		this.sdk = new QBittorrent({
			baseUrl: url.href,
			username: options.username,
			password: options.password,
			timeout: timeoutMs,
		});
		this.logger = options.logger.child({ module: "qbittorrent" });
		this.logger.debug(
			{ event: "qbittorrent.configured" },
			"qBittorrent adapter configured.",
		);
	}

	probe(signal?: AbortSignal) {
		return this.run("probe", false, signal, async () => {
			const version = this.sdk.state.version?.version;
			const apiVersion = await this.sdk.getApiVersion();
			const defaultSavePath = await this.sdk.getDefaultSavePath();
			const preferences: unknown = await this.sdk.getPreferences();
			if (
				!text(version) ||
				!/^2\.\d+\.\d+$/.test(apiVersion) ||
				!text(defaultSavePath) ||
				!Check(preferencesSchema, preferences)
			)
				throw new QbittorrentError("invalid-response", "read");
			return {
				version,
				apiVersion,
				defaultSavePath,
				incompletePathEnabled: preferences.temp_path_enabled,
				incompletePath: preferences.temp_path,
			};
		});
	}
	tasks(signal?: AbortSignal) {
		return this.run("tasks", false, signal, () => this.readTasks());
	}
	task(hash: string, signal?: AbortSignal) {
		const normalized = hashValue(hash);
		return this.run("task", false, signal, async () => {
			const tasks = await this.readTasks(normalized);
			if (
				tasks.length > 1 ||
				tasks.some(
					(task) => ![task.hash, task.v1Hash, task.v2Hash].includes(normalized),
				)
			)
				throw new QbittorrentError("invalid-response", "read");
			return tasks[0] ?? null;
		});
	}
	files(hash: string, signal?: AbortSignal) {
		const normalized = hashValue(hash);
		return this.run("files", false, signal, async () => {
			const result: unknown = await this.sdk.torrentFiles(normalized);
			if (
				!Check(filesSchema, result) ||
				new Set(result.map((file) => file.index)).size !== result.length
			)
				throw new QbittorrentError("invalid-response", "read");
			return result.map((file) => ({
				index: file.index,
				path: file.name,
				sizeBytes: file.size,
				progress: file.progress,
				priority: file.priority,
			}));
		});
	}
	add(input: AddDownload, signal?: AbortSignal) {
		if (
			!text(input.savePath) ||
			!text(input.category) ||
			input.category.length > 256 ||
			input.tags.length > 32 ||
			input.tags.some(
				(tag) => !text(tag) || tag.length > 256 || tag.includes(","),
			)
		)
			inputError();
		if ("magnet" in input.source) {
			// Only already-resolved magnets or bounded torrent bytes: never arbitrary URLs.
			if (!text(input.source.magnet) || input.source.magnet.length > 4096)
				inputError();
			let magnet: URL;
			try {
				magnet = new URL(input.source.magnet);
			} catch {
				inputError();
			}
			if (
				magnet.protocol !== "magnet:" ||
				!magnet.searchParams
					.getAll("xt")
					.some((xt) => /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(xt))
			)
				inputError();
		} else if (
			!input.source.torrent.byteLength ||
			input.source.torrent.byteLength > 10 * 1024 * 1024
		)
			inputError();
		const source =
			"magnet" in input.source
				? input.source.magnet
				: input.source.torrent.slice();
		const options = {
			savepath: input.savePath,
			category: input.category,
			tags: input.tags.join(","),
			paused: input.paused ? ("true" as const) : ("false" as const),
			useAutoTMM: "false" as const,
		};
		return this.run("add", true, signal, async () => {
			if (typeof source === "string") await this.sdk.addMagnet(source, options);
			else await this.sdk.addTorrent(source, options);
		});
	}
	pause(hash: string, signal?: AbortSignal) {
		const normalized = hashValue(hash);
		return this.run("pause", true, signal, async () => {
			await this.sdk.stopTorrent(normalized);
		});
	}
	resume(hash: string, signal?: AbortSignal) {
		const normalized = hashValue(hash);
		return this.run("resume", true, signal, async () => {
			await this.sdk.startTorrent(normalized);
		});
	}
	remove(hash: string, signal?: AbortSignal) {
		const normalized = hashValue(hash);
		return this.run("remove", true, signal, () =>
			this.sdk.removeTorrent(normalized, false),
		);
	}
	recheck(hash: string, signal?: AbortSignal) {
		const normalized = hashValue(hash);
		return this.run("recheck", true, signal, async () => {
			await this.sdk.recheckTorrent(normalized);
		});
	}

	private async readTasks(hash?: string): Promise<DownloadTask[]> {
		const result: unknown = await this.sdk.listTorrents(
			hash ? { hashes: hash } : {},
		);
		if (!Check(tasksSchema, result))
			throw new QbittorrentError("invalid-response", "read");
		return result.map((task) => ({
			hash: task.hash.toLowerCase(),
			v1Hash: task.infohash_v1?.toLowerCase() || null,
			v2Hash: task.infohash_v2?.toLowerCase() || null,
			name: task.name,
			state: task.state,
			progress: task.progress,
			remainingBytes: task.amount_left,
			totalBytes: task.size,
			downloadBytesPerSecond: task.dlspeed,
			uploadBytesPerSecond: task.upspeed,
			savePath: task.save_path,
			contentPath: task.content_path,
			category: task.category,
			tags: task.tags
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean),
		}));
	}
	private async authenticate() {
		if (!this.sdk.state.auth) {
			this.authentication ??= this.sdk
				.login()
				.then(() => {})
				.finally(() => {
					this.authentication = undefined;
				});
			await this.authentication;
		}
		// A known baseline also initializes SDK version-dependent command names before dispatch.
		if (
			!/^v?5\.\d+\.\d+(?:[-+].*)?$/.test(this.sdk.state.version?.version ?? "")
		)
			throw new QbittorrentError("unsupported-version", "not-sent");
	}
	private run<T>(
		operation: string,
		write: boolean,
		signal: AbortSignal | undefined,
		action: () => Promise<T>,
	): Promise<T> {
		const cancellation = AbortSignal.any([
			this.shutdown.signal,
			...(signal ? [signal] : []),
		]);
		let actionStarted = false;
		const task = (async () => {
			try {
				cancellation.throwIfAborted();
				await this.authenticate();
				cancellation.throwIfAborted();
				actionStarted = true;
				const result = await action();
				cancellation.throwIfAborted();
				this.logger.debug(
					{ event: "qbittorrent.succeeded", operation },
					"qBittorrent operation succeeded.",
				);
				return result;
			} catch (error) {
				let code: QbittorrentFailureCode = "unavailable";
				let status: number | undefined;
				if (error instanceof TorrentClientError) {
					status = error.status;
					if (error.code === "unauthorized") code = "unauthorized";
					else if (error.code === "client_error") code = "rejected";
				} else if (
					error &&
					typeof error === "object" &&
					"statusCode" in error &&
					typeof error.statusCode === "number"
				)
					status = error.statusCode;
				if (status === 401 || status === 403) code = "unauthorized";
				else if (status && status >= 400 && status < 500) code = "rejected";
				if (error instanceof QbittorrentError) code = error.code;
				// The SDK wraps fetch timeouts in TorrentClientError/FetchError causes.
				for (let cause = error; cause instanceof Error; cause = cause.cause) {
					if (cause.name === "TimeoutError") code = "timeout";
				}
				if (cancellation.aborted) code = "cancelled";
				const outcome = !write
					? "read"
					: !actionStarted
						? "not-sent"
						: code === "unauthorized" || code === "rejected"
							? "rejected"
							: "unknown";
				const failure = new QbittorrentError(code, outcome);
				// SDK errors, URLs, bodies and causes can contain credentials. Retain none.
				this.logger.warn(
					{ event: "qbittorrent.failed", operation, code, outcome },
					"qBittorrent operation failed.",
				);
				throw failure;
			}
		})();
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
	async close(): Promise<void> {
		this.shutdown.abort();
		await Promise.allSettled([...this.pending]);
		this.sdk.logout();
		this.logger.debug(
			{ event: "qbittorrent.stopped" },
			"qBittorrent adapter stopped.",
		);
	}
}
