import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import type {
	FileInfo,
	LibraryApi,
	LibraryChange,
	ResourceAccessApi,
	SourceIdentity,
} from "../../resources/public.js";
import { identificationPolicy } from "../identification/policy.js";
import type {
	IdentificationApi,
	IdentificationResult,
} from "../identification/public.js";

interface DirectoryResult {
	fingerprint: string;
	results: IdentificationResult[];
	fileIds: string[];
	scopeId: string | undefined;
}
/** Queues directory contexts; unrelated publications never cancel active incremental recognition. */
export class AutomaticIdentificationCoordinator {
	private unsubscribe: (() => void) | undefined;
	private controller: AbortController | undefined;
	private active: Promise<void> | undefined;
	private full = false;
	private pending = new Set<string>();
	private retryDirectories = new Set<string>();
	private activeDirectories = new Set<string>();
	private failed = false;
	private revision = 0;
	private incremental = false;
	private closed = false;
	private cache = new Map<string, DirectoryResult>();
	private results: IdentificationResult[] = [];
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	constructor(
		private readonly options: {
			library: LibraryApi;
			sources: ResourceAccessApi;
			identification: IdentificationApi;
			logger: Logger;
			onPublication?: (
				results: readonly IdentificationResult[],
				scopeIds: readonly string[],
				signal: AbortSignal,
				fileIds?: readonly string[],
			) => void | Promise<void>;
		},
	) {}
	start(): void {
		if (this.closed || this.unsubscribe) return;
		this.unsubscribe = this.options.library.onSnapshotChanged(
			(change: LibraryChange) => {
				if (change.directoryIds === null) {
					this.controller?.abort();
					this.full = true;
					this.pending.clear();
				} else {
					for (const id of change.directoryIds) this.pending.add(id);
					if (
						this.full ||
						change.directoryIds.some((id) => this.activeDirectories.has(id))
					)
						this.controller?.abort();
				}
				this.request();
			},
		);
		this.full = true;
		this.request();
	}
	private request(): void {
		if (this.closed || this.active) return;
		clearTimeout(this.retryTimer);
		this.retryTimer = undefined;
		this.active = Promise.resolve()
			.then(async () => {
				while ((this.full || this.pending.size) && !this.closed) {
					const full = this.full;
					this.incremental = !full;
					this.full = false;
					const directories = [...this.pending];
					this.pending.clear();
					this.activeDirectories = new Set(directories);
					const controller = new AbortController();
					this.controller = controller;
					try {
						await this.synchronize(full, directories, controller.signal);
						this.failed = false;
					} catch (err) {
						if (this.closed) return;
						if (full) this.full = true;
						else for (const id of directories) this.pending.add(id);
						if (controller.signal.aborted) continue;
						this.failed = true;
						this.options.logger.warn(
							{ event: "identification.automatic_failed", err },
							"Automatic identification failed; affected directories will retry.",
						);
						break;
					}
				}
			})
			.finally(() => {
				this.active = undefined;
				this.controller = undefined;
				this.activeDirectories.clear();
				if (!this.closed && !this.failed && (this.full || this.pending.size))
					this.request();
				else if (!this.closed && (this.failed || this.retryDirectories.size)) {
					this.retryTimer = setTimeout(() => {
						for (const id of this.retryDirectories) this.pending.add(id);
						this.request();
					}, identificationPolicy.automaticRetryMs);
					this.retryTimer.unref();
				}
			});
	}
	private async synchronize(
		full: boolean,
		directoryIds: string[],
		signal: AbortSignal,
	): Promise<void> {
		const epoch = this.options.sources.accessRevision;
		const status = await this.options.library.getStatus();
		signal.throwIfAborted();
		this.options.sources.assertAccessRevision(epoch);
		if (!status.ready || status.stale || !this.options.sources.hasSnapshot)
			return;
		const groups = new Map<string, FileInfo[]>();
		if (full) {
			let offset: number | null = 0;
			while (offset !== null) {
				const page = this.options.library.readFilePage(
					status.revision,
					offset,
					500,
				);
				for (const file of page.files) {
					const group = groups.get(file.parentId) ?? [];
					group.push(file);
					groups.set(file.parentId, group);
				}
				offset = page.nextOffset;
			}
		} else
			for (const id of directoryIds)
				groups.set(id, this.options.library.readDirectoryFiles(id));
		this.activeDirectories = new Set(groups.keys());
		const scope = await this.options.sources.getScope();
		const availableScopes = scope.ids.filter(
			(id) =>
				!status.roots ||
				status.roots.some((root) => root.id === id && root.available),
		);
		const next = full
			? new Map(
					[...this.cache].filter(
						([, entry]) =>
							entry.scopeId &&
							scope.ids.includes(entry.scopeId) &&
							!availableScopes.includes(entry.scopeId),
					),
				)
			: new Map(this.cache);
		const started = performance.now();
		let parsed = 0;
		const publication: IdentificationResult[] = [];
		const affectedFiles = new Set<string>();
		this.options.logger.info(
			{
				event: "identification.automatic_started",
				full,
				directories: groups.size,
			},
			"Automatic local identification started.",
		);
		groupsLoop: for (const [id, files] of groups) {
			const sources: SourceIdentity[] = [];
			files.sort(
				(a, b) =>
					a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"),
			);
			for (const file of files) {
				signal.throwIfAborted();
				this.options.sources.assertAccessRevision(epoch);
				// Unreadable entries retain the previous publication and retry, never imply deletion.
				try {
					sources.push(
						(await this.options.sources.resolveSource(file.id)).identity,
					);
				} catch (error) {
					if (
						full &&
						error instanceof DomainError &&
						error.code === "RESOURCE_ROOT_UNAVAILABLE"
					) {
						this.options.logger.warn(
							{ event: "identification.scope_unavailable", fileId: file.id },
							"Unavailable resource directory retained during identification.",
						);
						continue groupsLoop;
					}
					throw error;
				}
			}
			for (const fileId of this.cache.get(id)?.fileIds ?? [])
				affectedFiles.add(fileId);
			for (const file of files) affectedFiles.add(file.id);
			const fingerprint = createHash("sha256")
				.update(JSON.stringify([this.options.identification.version, sources]))
				.digest("hex");
			const cached = this.cache.get(id);
			let results: IdentificationResult[];
			if (cached?.fingerprint === fingerprint) results = cached.results;
			else {
				results = [];
				for (
					let start = 0;
					start < sources.length;
					start += identificationPolicy.parserGroupSize
				)
					results.push(
						...(await this.options.identification.identify(
							sources.slice(
								start,
								start + identificationPolicy.parserGroupSize,
							),
							signal,
						)),
					);
				parsed += sources.length;
			}
			for (const source of sources)
				await this.options.sources.revalidateSource({
					identity: source,
					accessRevision: epoch,
				});
			signal.throwIfAborted();
			this.options.sources.assertAccessRevision(epoch);
			publication.push(...results);
			// Failed provider results are retained for Review but not reused on retry.
			next.set(id, {
				fingerprint: results.some(
					(result) => result.metadataStatus === "failed",
				)
					? ""
					: fingerprint,
				results,
				fileIds: files.map((file) => file.id),
				scopeId: sources[0]?.scopeId ?? cached?.scopeId,
			});
		}
		signal.throwIfAborted();
		this.options.sources.assertAccessRevision(epoch);
		await this.options.onPublication?.(
			publication,
			availableScopes,
			signal,
			full ? undefined : [...affectedFiles],
		);
		signal.throwIfAborted();
		this.options.sources.assertAccessRevision(epoch);
		this.revision++;
		this.cache = next;
		this.retryDirectories = new Set(
			[...next]
				.filter(([, entry]) => entry.fingerprint === "")
				.map(([id]) => id),
		);
		this.results = [...next.values()].flatMap((entry) => entry.results);
		this.options.logger.info(
			{
				event: "identification.automatic_completed",
				full,
				directories: groups.size,
				sources: publication.length,
				parsed,
				reused: publication.length - parsed,
				available: publication.length,
				metadataFailed: publication.filter(
					(result) => result.metadataStatus === "failed",
				).length,
				elapsedMs: Math.round(performance.now() - started),
			},
			"Automatic local identification completed.",
		);
	}
	getStatus() {
		return {
			running: Boolean(this.active),
			failed: this.failed,
			revision: this.revision,
			incremental: this.incremental,
		};
	}
	getResults(): IdentificationResult[] {
		return structuredClone(this.results);
	}
	async waitForCompletion(): Promise<void> {
		await this.active;
	}
	async close(): Promise<void> {
		this.closed = true;
		clearTimeout(this.retryTimer);
		this.unsubscribe?.();
		this.controller?.abort();
		await this.active;
		this.cache.clear();
		this.results = [];
	}
}
