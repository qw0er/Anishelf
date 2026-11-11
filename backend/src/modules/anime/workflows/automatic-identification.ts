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
import type { AnimeCatalogApi, ReviewItem } from "../anime-catalog/public.js";
import { identificationDefaults } from "../identification/defaults.js";
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
interface ReviewReidentificationRun {
	id: number;
	state: "running" | "completed" | "failed";
	total: number;
	processed: number;
	identified: number;
	pending: number;
	failed: number;
	skipped: number;
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
	private forcedDirectories = new Set<string>();
	private forcedRequests = new Map<string, Promise<void>>();
	private reviewRun: ReviewReidentificationRun | undefined;
	private reviewTask: Promise<void> | undefined;
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	constructor(
		private readonly options: {
			library: LibraryApi;
			sources: ResourceAccessApi;
			identification: IdentificationApi;
			logger: Logger;
			metadataContext?: () => string;
			catalog?: Pick<AnimeCatalogApi, "reviews" | "review"> &
				Partial<Pick<AnimeCatalogApi, "reusableAcquisitions">>;
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
	/** Capture the entire pending queue before publication can change its pagination. */
	reidentifyPending(): void {
		if (this.reviewTask) return;
		const catalog = this.options.catalog;
		if (this.closed || !catalog)
			throw new DomainError(
				"CATALOG_UNAVAILABLE",
				"Pending review identification is unavailable.",
			);
		const run: ReviewReidentificationRun = {
			id: (this.reviewRun?.id ?? 0) + 1,
			state: "running",
			total: 0,
			processed: 0,
			identified: 0,
			pending: 0,
			failed: 0,
			skipped: 0,
		};
		this.reviewRun = run;
		this.options.logger.info(
			{ event: "identification.pending_started", runId: run.id },
			"Pending review re-identification started.",
		);
		this.reviewTask = Promise.resolve()
			.then(async () => {
				await this.waitForCompletion();
				const items: ReviewItem[] = [];
				for (let page = 1; ; page++) {
					if (this.closed) throw new Error("Identification is shutting down.");
					const result = await catalog.reviews({
						decision: "pending",
						page,
						perPage: 50,
					});
					items.push(...result.items);
					if (!result.hasNextPage) break;
				}
				// Availability is checked by Catalog and again when resolving each file.
				const selected = [
					...new Map(
						items
							.filter((item) => item.available && item.decision === "pending")
							.map((item) => [item.id, item]),
					).values(),
				];
				run.total = selected.length;
				const directories = new Map<string, ReviewItem[]>();
				for (const item of selected) {
					try {
						const file = await this.options.library.getFile(item.fileId);
						const siblings = directories.get(file.parentId) ?? [];
						siblings.push(item);
						directories.set(file.parentId, siblings);
					} catch {
						run.failed++;
						run.processed++;
					}
				}
				for (const siblings of directories.values()) {
					if (this.closed) throw new Error("Identification is shutting down.");
					const current: ReviewItem[] = [];
					for (const item of siblings) {
						try {
							const latest = await catalog.review(item.id);
							if (latest.available && latest.decision === "pending")
								current.push(latest);
							else {
								run.skipped++;
								run.processed++;
							}
						} catch {
							run.failed++;
							run.processed++;
						}
					}
					const first = current[0];
					if (!first) continue;
					try {
						await this.reidentify(first.fileId);
						for (const item of current) {
							try {
								const latest = await catalog.review(item.id);
								if (!latest.available || latest.metadataStatus === "failed")
									run.failed++;
								else if (latest.decision === "confirmed") run.identified++;
								else if (latest.decision === "pending") run.pending++;
								else run.skipped++;
							} catch {
								run.failed++;
							}
						}
					} catch (err) {
						run.failed += current.length;
						this.options.logger.warn(
							{
								event: "identification.pending_directory_failed",
								runId: run.id,
								fileId: first.fileId,
								err,
							},
							"Pending review directory re-identification failed.",
						);
					}
					run.processed += current.length;
				}
				run.state = "completed";
			})
			.catch((err: unknown) => {
				run.state = "failed";
				this.options.logger.warn(
					{ event: "identification.pending_failed", runId: run.id, err },
					"Pending review re-identification could not finish.",
				);
			})
			.finally(() => {
				this.reviewTask = undefined;
				this.options.logger.info(
					{ event: "identification.pending_completed", ...run },
					"Pending review re-identification finished.",
				);
			});
	}
	/** Explicit recovery shares the automatic queue and preserves directory evidence. */
	async reidentify(fileId: string): Promise<void> {
		const status = await this.options.library.getStatus();
		if (this.closed || !status.ready || status.stale)
			throw new DomainError(
				"CATALOG_UNAVAILABLE",
				"Wait for a current resource scan before identifying again.",
			);
		const epoch = this.options.sources.accessRevision;
		const file = await this.options.library.getFile(fileId);
		await this.options.sources.resolveSource(fileId);
		this.options.sources.assertAccessRevision(epoch);
		if (this.closed)
			throw new DomainError(
				"CATALOG_UNAVAILABLE",
				"Identification is shutting down.",
			);
		const existing = this.forcedRequests.get(file.parentId);
		if (existing) return existing;
		const task = this.forceDirectory(file.parentId, fileId);
		this.forcedRequests.set(file.parentId, task);
		try {
			await task;
		} finally {
			this.forcedRequests.delete(file.parentId);
		}
	}
	private async forceDirectory(
		directoryId: string,
		fileId: string,
	): Promise<void> {
		this.forcedDirectories.add(directoryId);
		// Isolate explicit recovery from a different directory's failed publication.
		this.pending = new Set([directoryId, ...this.pending]);
		if (this.activeDirectories.has(directoryId)) this.controller?.abort();
		this.options.logger.info(
			{ event: "identification.forced_requested", fileId, directoryId },
			"Directory re-identification requested.",
		);
		this.request();
		await this.waitForCompletion();
		if (this.closed || this.forcedDirectories.has(directoryId))
			throw new DomainError(
				"CATALOG_UNAVAILABLE",
				"Re-identification did not finish. Retry shortly.",
			);
	}
	private request(): void {
		if (this.closed || this.active) return;
		clearTimeout(this.retryTimer);
		this.retryTimer = undefined;
		this.active = Promise.resolve()
			.then(async () => {
				while ((this.full || this.pending.size) && !this.closed) {
					const forced = [...this.pending].find((id) =>
						this.forcedDirectories.has(id),
					);
					const full = !forced && this.full;
					this.incremental = !full;
					if (full) this.full = false;
					const directories = forced ? [forced] : [...this.pending];
					for (const id of directories) this.pending.delete(id);
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
					}, identificationDefaults.automaticRetryMs);
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
		const forcedCompleted = new Set<string>();
		this.options.logger.info(
			{
				event: "identification.automatic_started",
				full,
				directories: groups.size,
			},
			"Automatic local identification started.",
		);
		groupsLoop: for (const [id, files] of groups) {
			const forced = this.forcedDirectories.has(id);
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
				.update(
					JSON.stringify([
						this.options.identification.version,
						this.options.metadataContext?.(),
						sources,
					]),
				)
				.digest("hex");
			const cached = this.cache.get(id);
			let results: IdentificationResult[];
			if (!forced && cached?.fingerprint === fingerprint)
				results = cached.results;
			else {
				const reusable =
					(await this.options.catalog?.reusableAcquisitions?.(sources)) ?? [];
				const reused = new Set(
					reusable.map(
						(result) =>
							`${result.source.fileId}:${result.source.sourceVersion}`,
					),
				);
				const unidentified = sources.filter(
					(source) => !reused.has(`${source.fileId}:${source.sourceVersion}`),
				);
				results = [...reusable];
				for (
					let start = 0;
					start < unidentified.length;
					start += identificationDefaults.parserGroupSize
				)
					results.push(
						...(await this.options.identification.identify(
							unidentified.slice(
								start,
								start + identificationDefaults.parserGroupSize,
							),
							signal,
							{ refreshMetadata: forced },
						)),
					);
				for (const result of results) {
					const best = result.proposals[0]?.candidate;
					this.options.logger.debug(
						{
							event: "identification.candidate_evaluated",
							fileId: result.source.fileId,
							seasons: result.evidence.seasons,
							reference: best?.work.reference,
							score: best?.score,
							conflicts: best?.conflicts,
							assumptions: best?.assumptions,
							matcherVersion: identificationDefaults.matcherVersion,
						},
						"Local identification candidate evaluated.",
					);
				}
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
			if (forced) forcedCompleted.add(id);
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
		for (const id of forcedCompleted) this.forcedDirectories.delete(id);
		this.retryDirectories = new Set(
			[...next]
				.filter(([, entry]) => entry.fingerprint === "")
				.map(([id]) => id),
		);
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
				identityUnresolved: publication.filter(
					(result) => result.proposals[0]?.candidate.identityUnresolved?.length,
				).length,
				matcherVersion: identificationDefaults.matcherVersion,
				forcedDirectories: forcedCompleted.size,
				elapsedMs: Math.round(performance.now() - started),
			},
			"Automatic local identification completed.",
		);
	}
	getStatus() {
		return {
			running: Boolean(this.active || this.reviewTask),
			failed: this.failed,
			revision: this.revision,
			incremental: this.reviewTask ? true : this.incremental,
			...(this.reviewRun ? { reviewRun: { ...this.reviewRun } } : {}),
		};
	}
	getResults(): IdentificationResult[] {
		return structuredClone(
			[...this.cache.values()].flatMap((entry) => entry.results),
		);
	}
	async waitForCompletion(): Promise<void> {
		while (this.active) await this.active;
	}
	async close(): Promise<void> {
		this.closed = true;
		clearTimeout(this.retryTimer);
		this.unsubscribe?.();
		this.controller?.abort();
		await this.active;
		await this.reviewTask;
		this.cache.clear();
		this.forcedDirectories.clear();
	}
}
