import { QBittorrent, TorrentClientError } from "@ctrl/qbittorrent";
import { gte } from "semver";
import { abortable } from "../../../../shared/abortable.js";
import {
	type TorrentClient,
	TorrentError,
	type TorrentFailureCode,
	type TorrentFile,
	type TorrentProbe,
	type TorrentSource,
	type TorrentState,
	type TorrentSubmission,
	type TorrentTask,
} from "../public.js";
import { inspectQbittorrentMetadata } from "./metadata.js";
import type { QbittorrentOptions } from "./model.js";

function text(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 4096 &&
		!/[\r\n\0]/.test(value)
	);
}

export class QbittorrentClient implements TorrentClient {
	private readonly sdk: QBittorrent;
	private readonly shutdown = new AbortController();
	private readonly pending = new Set<Promise<unknown>>();
	private authentication: Promise<void> | undefined;
	private metadataCapability: Promise<boolean> | undefined;
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

	probe(signal?: AbortSignal): Promise<TorrentProbe> {
		return this.run("probe", false, signal, async () => {
			const version = this.sdk.state.version?.version;
			const apiVersion = await this.sdk.getApiVersion();
			const preferences = await this.sdk.getPreferences();
			if (
				!text(version) ||
				!/^2\.\d+\.\d+$/.test(apiVersion) ||
				typeof preferences.temp_path_enabled !== "boolean" ||
				typeof preferences.temp_path !== "string"
			)
				throw new TorrentError("invalid-response", "read");
			return {
				version,
				...(gte(apiVersion, "2.11.9") ? { selectiveFiles: true as const } : {}),
				incompleteDirectory: preferences.temp_path_enabled
					? preferences.temp_path
					: null,
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
				throw new TorrentError("invalid-response", "read");
			return tasks[0] ?? null;
		});
	}
	files(hash: string, signal?: AbortSignal): Promise<TorrentFile[]> {
		const normalized = hash.toLowerCase();
		return this.run("files", false, signal, async () => {
			const result = await this.sdk.torrentFiles(normalized);
			return result.map((file) => {
				const index = "index" in file ? file.index : undefined;
				return {
					...(typeof index === "number" &&
					Number.isSafeInteger(index) &&
					index >= 0
						? { index }
						: {}),
					path: file.name,
					sizeBytes: file.size,
					progress: file.progress,
					priority: file.priority,
					selected: file.priority > 0,
				};
			});
		});
	}
	inspectMetadata(
		input: { source: TorrentSource; expectedHash: string },
		signal?: AbortSignal,
	) {
		const deadline = AbortSignal.timeout(8_000);
		const bounded = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
		const task = this.run(
			"inspect_metadata",
			false,
			bounded,
			async (active) => {
				this.metadataCapability ??= this.sdk
					.getApiVersion()
					.then((version) => {
						if (!/^2\.\d+\.\d+$/.test(version))
							throw new TorrentError("invalid-response", "read");
						const supported = gte(version, "2.11.9");
						this.logger.debug(
							{ event: "qbittorrent.metadata_capability", version, supported },
							"Checked qBittorrent metadata preview support.",
						);
						return supported;
					})
					.catch((error: unknown) => {
						this.metadataCapability = undefined;
						throw error;
					});
				const supported = await this.metadataCapability;
				active.throwIfAborted();
				if (!supported) return null;
				return inspectQbittorrentMetadata(this.sdk, input, active);
			},
		);
		return abortable(task, bounded).catch((error: unknown) => {
			if (signal?.aborted) throw new TorrentError("cancelled", "read");
			if (deadline.aborted) throw new TorrentError("timeout", "read");
			throw error;
		});
	}
	add(input: TorrentSubmission, signal?: AbortSignal) {
		const source =
			"magnet" in input.source
				? input.source.magnet
				: input.source.torrent.slice();
		const options = {
			savepath: input.savePath,
			category: "anishelf",
			tags: `anishelf-${input.ownerKey}`,
			paused: input.paused ? ("true" as const) : ("false" as const),
			useAutoTMM: "false" as const,
		};
		const selection = input.fileSelection;
		if (selection)
			return this.run("add_selected", true, signal, async () => {
				// qBittorrent takes initial priorities with a reference to cached metadata.
				let magnet =
					typeof source === "string"
						? source
						: `magnet:?xt=urn:btih:${selection.hash}`;
				if (selection.v2Hash) {
					const exactTopic = `urn:btmh:1220${selection.v2Hash}`;
					if (!new URL(magnet).searchParams.getAll("xt").includes(exactTopic))
						magnet += `&xt=${exactTopic}`;
				}
				const selectiveOptions = {
					...options,
					contentLayout: "Original",
					filePriorities: selection.priorities.join(","),
				};
				await this.sdk.addMagnet(magnet, selectiveOptions);
			});
		return this.run("add", true, signal, async () => {
			if (typeof source === "string") await this.sdk.addMagnet(source, options);
			else await this.sdk.addTorrent(source, options);
		});
	}

	enableFiles(hash: string, indices: readonly number[], signal?: AbortSignal) {
		return this.run("enable_files", true, signal, async () => {
			await this.sdk.setFilePriority(hash, indices.map(String), 1);
		});
	}

	private async readTasks(hash?: string): Promise<TorrentTask[]> {
		const result = await this.sdk.listTorrents(hash ? { hashes: hash } : {});
		return result.map((task) => ({
			hash: task.hash.toLowerCase(),
			v1Hash: task.infohash_v1?.toLowerCase() || null,
			v2Hash: task.infohash_v2?.toLowerCase() || null,
			name: task.name,
			state: this.transferState(task.state),
			progress: task.progress,
			remainingBytes: task.amount_left,
			totalBytes: task.size,
			downloadBytesPerSecond: task.dlspeed,
			uploadBytesPerSecond: task.upspeed,
			savePath: task.save_path,
			contentPath: task.content_path,
			ownerKey: ownerKey(task.category, task.tags),
		}));
	}
	private reportedUnknownState = false;
	private transferState(value: string): TorrentState {
		const state = Object.hasOwn(transferStates, value)
			? transferStates[value]
			: undefined;
		if (state) return state;
		if (!this.reportedUnknownState) {
			this.reportedUnknownState = true;
			this.logger.warn(
				{ event: "qbittorrent.unknown_state" },
				"Unrecognized transfer state; completed-file import is blocked.",
			);
		}
		return "unknown";
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
		action: (signal: AbortSignal) => Promise<T>,
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
				const result = await action(cancellation);
				cancellation.throwIfAborted();
				this.logger.debug(
					{ event: "qbittorrent.succeeded", operation },
					"qBittorrent operation succeeded.",
				);
				return result;
			} catch (error) {
				let code: TorrentFailureCode = "unavailable";
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
				if (error instanceof TorrentError) code = error.code;
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
				const failure = new TorrentError(code, outcome);
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

const transferStates: Readonly<Record<string, TorrentState>> = {
	downloading: "downloading",
	forcedDL: "downloading",
	uploading: "seeding",
	forcedUP: "seeding",
	pausedDL: "paused",
	pausedUP: "paused",
	stoppedDL: "paused",
	stoppedUP: "paused",
	queuedDL: "queued",
	queuedUP: "queued",
	stalledDL: "stalled",
	stalledUP: "stalled",
	checkingDL: "checking",
	checkingUP: "checking",
	checkingResumeData: "checking",
	moving: "moving",
	metaDL: "metadata",
	forcedMetaDL: "metadata",
	allocating: "checking",
	error: "error",
	missingFiles: "missing",
	unknown: "unknown",
};

function ownerKey(category: string, tags: string): string | null {
	if (category !== "anishelf") return null;
	const identities = [
		...new Set(
			tags
				.split(",")
				.map((tag) => tag.trim())
				.filter(
					(tag) =>
						tag.startsWith("anishelf-") && tag.length > "anishelf-".length,
				),
		),
	];
	return identities.length === 1
		? (identities[0]?.slice("anishelf-".length) ?? null)
		: null;
}
