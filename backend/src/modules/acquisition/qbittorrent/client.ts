import { QBittorrent, TorrentClientError } from "@ctrl/qbittorrent";
import {
	type AddDownload,
	type DownloadTask,
	type QbittorrentApi,
	QbittorrentError,
	type QbittorrentFailureCode,
	type QbittorrentOptions,
} from "./domain/model.js";

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
		this.sdk = new QBittorrent({
			baseUrl: options.url,
			username: options.username,
			password: options.password,
			timeout: options.timeoutMs ?? 30_000,
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
			const preferences = await this.sdk.getPreferences();
			if (
				!text(version) ||
				!/^2\.\d+\.\d+$/.test(apiVersion) ||
				!text(defaultSavePath) ||
				typeof preferences.temp_path_enabled !== "boolean" ||
				typeof preferences.temp_path !== "string"
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
		const normalized = hash.toLowerCase();
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
		const normalized = hash.toLowerCase();
		return this.run("files", false, signal, async () => {
			const result = await this.sdk.torrentFiles(normalized);
			return result.map((file) => ({
				path: file.name,
				sizeBytes: file.size,
				progress: file.progress,
				priority: file.priority,
			}));
		});
	}
	add(input: AddDownload, signal?: AbortSignal) {
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

	private async readTasks(hash?: string): Promise<DownloadTask[]> {
		const result = await this.sdk.listTorrents(hash ? { hashes: hash } : {});
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
