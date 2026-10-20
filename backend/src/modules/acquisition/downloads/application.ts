import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import type {
	AcquisitionTarget,
	AnimeApi,
	ReleaseAssessmentApi,
} from "../../anime/public.js";
import type { AcquisitionResources } from "../../resources/public.js";
import type { DiscoveryStore, Subscription } from "../discovery/public.js";
import {
	type QbittorrentApi,
	QbittorrentError,
} from "../qbittorrent/public.js";
import {
	type DownloadActivity,
	type DownloadDestination,
	DownloadError,
	type DownloadIntent,
} from "./domain/model.js";
import {
	absoluteDownloadPath,
	inside,
	relativeDownloadPath,
	workDirectory,
} from "./domain/paths.js";
import { resolveTorrent } from "./infrastructure/torrent.js";
import { downloadPolicy as policy } from "./policy.js";
import type { DownloadStore, TorrentTransport } from "./ports.js";
import type { DownloadsApi } from "./public.js";

function conflict(): never {
	throw new DomainError(
		"ACQUISITION_CONFLICT",
		"Acquisition settings or scope changed. Preview again.",
	);
}
interface Options {
	store: DownloadStore;
	discovery: DiscoveryStore;
	resources: AcquisitionResources;
	anime: ReleaseAssessmentApi;
	ingestion: NonNullable<AnimeApi["ingestion"]>;
	transport: TorrentTransport;
	connectionGeneration(): string;
	withClient<T>(
		generation: string,
		operation: (client: QbittorrentApi) => Promise<T>,
	): Promise<T>;
	logger: Logger;
	now?: () => number;
}
export class DownloadsApplication implements DownloadsApi {
	private readonly shutdown = new AbortController();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running: Promise<void> | undefined;
	private readonly pending = new Set<Promise<unknown>>();
	private readonly failures = new Map<
		string,
		{ attempts: number; next: number }
	>();
	constructor(private readonly options: Options) {}
	private now() {
		return this.options.now?.() ?? Date.now();
	}
	private open() {
		if (this.shutdown.signal.aborted)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Acquisition is stopping.",
			);
	}
	private tracked<T>(operation: () => Promise<T>) {
		this.open();
		const task = operation();
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => {});
		return task;
	}
	async settings() {
		const saved = this.options.store.destination();
		const destination =
			saved &&
			saved.connectionGeneration !== this.options.connectionGeneration()
				? { ...saved, validated: false, visibilityVerified: false }
				: saved;
		return {
			destination,
			roots: await this.options.resources.roots(),
		};
	}
	saveDestination(input: {
		revision: string | null;
		scopeId: string;
		path: string;
	}) {
		return this.tracked(async () => {
			if (
				(this.options.store.destination()?.revision ?? null) !== input.revision
			)
				conflict();
			let path: string;
			try {
				path = absoluteDownloadPath(input.path.trim());
			} catch {
				throw new DomainError(
					"INVALID_REQUEST",
					"Enter an absolute qBittorrent destination path.",
				);
			}
			if (
				!(await this.options.resources.roots()).some(
					(root) => root.scopeId === input.scopeId,
				)
			)
				conflict();
			this.open();
			if (
				(this.options.store.destination()?.revision ?? null) !== input.revision
			)
				conflict();
			const destination: DownloadDestination = {
				revision: randomUUID(),
				scopeId: input.scopeId,
				path,
				connectionGeneration: this.options.connectionGeneration(),
				validated: false,
				visibilityVerified: false,
			};
			this.options.store.saveDestination(destination);
			this.options.logger.info(
				{
					event: "acquisition.destination_saved",
					revision: destination.revision,
				},
				"Download destination saved; validation and subscription confirmation are required.",
			);
			return destination;
		});
	}
	validate(revision: string) {
		return this.tracked(async () => {
			const destination = this.options.store.destination();
			if (
				!destination ||
				destination.revision !== revision ||
				destination.connectionGeneration !== this.options.connectionGeneration()
			)
				conflict();
			try {
				await this.options.withClient(
					destination.connectionGeneration,
					async (client) => {
						const probe = await client.probe(this.shutdown.signal);
						if (
							!probe.incompletePathEnabled ||
							!probe.incompletePath ||
							inside(
								absoluteDownloadPath(probe.incompletePath),
								destination.path,
							) ||
							inside(
								destination.path,
								absoluteDownloadPath(probe.incompletePath),
							)
						)
							throw new DownloadError("incomplete_directory_required");
						await this.options.resources.validate(
							destination.scopeId,
							probe.incompletePath,
						);
					},
				);
				this.open();
				if (this.options.store.destination()?.revision !== revision) conflict();
				const result = { ...destination, validated: true };
				this.options.store.saveDestination(result);
				this.options.logger.info(
					{ event: "acquisition.destination_validated", revision },
					"Destination mapping is configured; shared visibility remains subject to completed-file verification.",
				);
				return result;
			} catch (error) {
				if (this.options.store.destination()?.revision === revision)
					this.options.store.saveDestination({
						...destination,
						validated: false,
					});
				throw new DomainError(
					"ACQUISITION_UNAVAILABLE",
					error instanceof DownloadError
						? "Enable an incomplete directory outside resource roots in qBittorrent, then validate again."
						: "Could not validate the destination. Check qBittorrent and resource configuration.",
				);
			}
		});
	}
	preview(
		key: string,
		target: AcquisitionTarget,
	): { revision: string; path: string } | null {
		const destination = this.options.store.destination();
		if (
			!destination?.validated ||
			destination.connectionGeneration !== this.options.connectionGeneration()
		)
			return null;
		return {
			revision: destination.revision,
			path: posix.join(
				destination.path,
				this.options.store.directory(key) ??
					workDirectory(key, target.work.titles[0] ?? "Anime"),
			),
		};
	}
	async authorize(
		workKey: string,
		revision: string,
		destinationRevision: string,
	) {
		this.open();
		const subscription = this.options.discovery.subscription(workKey),
			destination = this.options.store.destination();
		if (
			!subscription ||
			subscription.revision !== revision ||
			!destination?.validated ||
			destination.revision !== destinationRevision ||
			destination.connectionGeneration !== this.options.connectionGeneration()
		)
			conflict();
		this.options.store.authorize({
			workKey,
			feedId: subscription.feedId,
			startEpisode: subscription.startEpisode,
			destinationRevision,
			connectionGeneration: destination.connectionGeneration,
		});
		this.options.logger.info(
			{ event: "acquisition.authorized", workKey, revision },
			"Automatic acquisition scope confirmed.",
		);
	}
	private authorized(subscription: Subscription) {
		const authorization = this.options.store.authorization(
				subscription.workKey,
			),
			destination = this.options.store.destination();
		return Boolean(
			subscription.enabled &&
				destination?.validated &&
				authorization &&
				authorization.feedId === subscription.feedId &&
				authorization.startEpisode === subscription.startEpisode &&
				authorization.destinationRevision === destination.revision &&
				authorization.connectionGeneration ===
					this.options.connectionGeneration() &&
				destination.connectionGeneration ===
					this.options.connectionGeneration(),
		);
	}
	activity(workKey: string, page = 1): DownloadActivity {
		this.open();
		if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
			throw new DomainError("INVALID_REQUEST", "Invalid activity page.");
		const subscription = this.options.discovery.subscription(workKey);
		const all = this.options.store
			.intents()
			.filter((item) => item.workKey === workKey)
			.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
		const directory = this.options.store.directory(workKey),
			destination = this.options.store.destination();
		return {
			authorized: Boolean(subscription && this.authorized(subscription)),
			destination:
				directory && destination
					? posix.join(destination.path, directory)
					: null,
			items: all
				.slice((page - 1) * policy.pageSize, page * policy.pageSize)
				.map((item) => ({
					id: item.id,
					revision: item.revision,
					workKey: item.workKey,
					candidateId: item.candidateId,
					episode: item.episode,
					title: item.title,
					state: item.state,
					transfer: item.transfer,
					progress: item.progress,
					ingestion: item.ingestion,
					error: item.error,
					attempts: item.attempts,
					nextAttemptAt: item.nextAttemptAt,
					observedAt: item.observedAt,
					updatedAt: item.updatedAt,
					createdAt: item.createdAt,
				})),
			total: all.length,
			managedCandidateIds: this.options.discovery
				.candidates(workKey)
				.filter((candidate) =>
					all.some((item) => item.candidateId === candidate.id),
				)
				.map((candidate) => candidate.id),
			attention: all.filter((item) => item.error !== null).length,
			active: all.filter(
				(item) => !["available", "missing", "blocked"].includes(item.state),
			).length,
			page,
		};
	}
	retry(
		id: string,
		revision: string,
		commandId: string,
		kind: "acquisition" | "import",
	) {
		this.open();
		let item = this.options.store.intent(id);
		if (!item) conflict();
		const recoveringConnection =
			item.error === "downloader_configuration_changed";
		if (item.lastCommand?.id === commandId) {
			if (item.lastCommand.kind !== kind) conflict();
			return;
		}
		if (!item.source && kind === "acquisition" && !recoveringConnection)
			throw new DomainError(
				"INVALID_REQUEST",
				"Release evidence expired. Manage this download in qBittorrent WebUI.",
			);
		if (item.revision !== revision || !commandId || commandId.length > 64)
			conflict();
		if (
			kind === "import" &&
			(item.state !== "bound" || !["failed", "review"].includes(item.ingestion))
		)
			conflict();
		if (kind === "acquisition") {
			if (
				!["missing", "blocked", "unknown"].includes(item.state) &&
				!(item.state === "pending" && item.error)
			)
				conflict();
			const subscription = this.options.discovery.subscription(item.workKey);
			if (
				!subscription ||
				!this.authorized(subscription) ||
				item.state === "available" ||
				item.state === "bound"
			)
				conflict();
			const choice = this.options.discovery
				.candidates(item.workKey)
				.find(
					(candidate) =>
						candidate.episode === item?.episode &&
						candidate.status === "selected",
				);
			const entry = choice
				? this.options.discovery
						.feed(subscription.feedId)
						?.entries.find((value) => value.id === choice.entryId)
				: null;
			const destination = this.options.store.destination();
			if (recoveringConnection && destination) item = { ...item, destination };
			if (
				choice &&
				entry?.downloadUrl &&
				destination &&
				(item.state === "missing" ||
					item.state === "pending" ||
					item.error === "selection_changed" ||
					item.hash.startsWith("unresolved:"))
			) {
				item = {
					...item,
					candidateId: choice.id,
					title: choice.title.slice(0, 1024),
					source: entry.downloadUrl,
					hash:
						entry.downloadUrl === item.source
							? item.hash
							: `unresolved:${randomUUID()}`,
					expectedHash: entry.hash,
					destination,
					subscriptionRevision: subscription.revision,
				};
			}
		}
		this.options.logger.info(
			{
				event: "acquisition.retry_requested",
				intentId: item.id,
				commandId,
				kind,
			},
			"Acquisition recovery command accepted.",
		);
		// Unknown submissions always reconcile before a retry can add anything.
		this.save({
			...item,
			state:
				kind === "import"
					? "bound"
					: recoveringConnection
						? "unknown"
						: "pending",
			ingestion: kind === "import" ? "pending" : "not-ready",
			error: null,
			nextAttemptAt: 0,
			lastCommand: { id: commandId, kind },
		});
	}
	private save(item: DownloadIntent) {
		this.open();
		const current = this.options.store.intent(item.id);
		if (!current || current.revision !== item.revision) conflict();
		if (
			JSON.stringify({ ...current, revision: "", updatedAt: 0 }) ===
			JSON.stringify({ ...item, revision: "", updatedAt: 0 })
		)
			return current;
		const value = { ...item, revision: randomUUID(), updatedAt: this.now() };
		this.options.store.saveIntent(value);
		if (
			current.state !== item.state ||
			current.ingestion !== item.ingestion ||
			current.error !== item.error
		)
			this.options.logger.info(
				{
					event: "acquisition.intent_state",
					intentId: item.id,
					state: item.state,
					ingestion: item.ingestion,
					code: item.error,
				},
				"Acquisition state updated.",
			);
		return value;
	}
	private delay(attempts: number) {
		return Math.min(policy.retryMaximumMs, 30_000 * 2 ** Math.min(attempts, 7));
	}
	private async discover() {
		for (const subscription of this.options.discovery.subscriptions()) {
			if (!this.authorized(subscription)) continue;
			const throttle = this.failures.get(subscription.workKey);
			if (throttle && throttle.next > this.now()) continue;
			try {
				const target = await this.options.anime.target(
					subscription.workKey,
					this.shutdown.signal,
				);
				for (const candidate of this.options.discovery.candidates(
					subscription.workKey,
				)) {
					if (
						candidate.status !== "selected" ||
						candidate.episode === null ||
						candidate.episode < subscription.startEpisode ||
						target.availableEpisodes.includes(candidate.episode)
					)
						continue;
					if (
						this.options.store
							.intents()
							.some(
								(item) =>
									item.workKey === subscription.workKey &&
									item.episode === candidate.episode,
							)
					)
						continue;
					const entry = this.options.discovery
						.feed(subscription.feedId)
						?.entries.find((item) => item.id === candidate.entryId);
					if (!entry?.downloadUrl) continue;

					this.open();
					const current = this.options.discovery.subscription(
							subscription.workKey,
						),
						destination = this.options.store.destination();
					if (
						!current ||
						current.revision !== subscription.revision ||
						!this.authorized(current) ||
						!destination
					)
						break;
					const directory =
						this.options.store.directory(subscription.workKey) ??
						workDirectory(
							subscription.workKey,
							target.work.titles[0] ?? "Anime",
						);
					this.options.store.saveDirectory(subscription.workKey, directory);
					const now = this.now();
					const intent: DownloadIntent = {
						id: randomUUID(),
						revision: randomUUID(),
						workKey: subscription.workKey,
						candidateId: candidate.id,
						episode: candidate.episode,
						title: candidate.title.slice(0, 1024),
						hash: `unresolved:${randomUUID()}`,
						expectedHash: entry.hash,
						source: entry.downloadUrl,
						destination,
						directory,
						subscriptionRevision: subscription.revision,
						state: "pending",
						transfer: null,
						progress: null,
						ingestion: "not-ready",
						error: null,
						attempts: 0,
						nextAttemptAt: 0,
						observedAt: null,
						updatedAt: now,
						createdAt: now,
						sourceIdentity: null,
						lastCommand: null,
					};
					if (this.options.store.reserve(intent))
						this.options.logger.info(
							{
								event: "acquisition.intent_reserved",
								intentId: intent.id,
								episode: intent.episode,
							},
							"Download intent reserved.",
						);
				}
				const current = this.options.discovery.subscription(
					subscription.workKey,
				);
				if (current?.lastError === "acquisition_unavailable")
					this.options.discovery.updateCandidates(
						current,
						this.options.discovery.candidates(current.workKey),
						null,
					);
				this.failures.delete(subscription.workKey);
			} catch (error) {
				if (this.shutdown.signal.aborted) return;
				this.options.discovery.updateCandidates(
					subscription,
					this.options.discovery.candidates(subscription.workKey),
					"acquisition_unavailable",
				);
				const attempts = (throttle?.attempts ?? 0) + 1;
				this.failures.set(subscription.workKey, {
					attempts,
					next: this.now() + this.delay(attempts),
				});
				this.options.logger.warn(
					{
						event: "acquisition.reservation_failed",
						workKey: subscription.workKey,
						code: error instanceof DownloadError ? error.code : "unavailable",
					},
					"Could not reserve acquisition; discovery will retry.",
				);
			}
		}
	}
	private async reconcile(item: DownloadIntent) {
		if (item.state === "pending") {
			const subscription = this.options.discovery.subscription(item.workKey);
			if (!subscription || !this.authorized(subscription)) return;
		}
		if (
			item.nextAttemptAt > this.now() ||
			["missing", "blocked"].includes(item.state)
		)
			return;
		try {
			if (item.state === "available") {
				if (
					item.sourceIdentity &&
					(await this.options.ingestion.available(
						item.workKey,
						item.episode,
						item.sourceIdentity,
					))
				)
					return;
				this.save({
					...item,
					state: "bound",
					ingestion: "review",
					error: "association_changed",
				});
				return;
			}
			if (
				item.destination.connectionGeneration !==
				this.options.connectionGeneration()
			) {
				this.save({
					...item,
					state: "blocked",
					error: "downloader_configuration_changed",
				});
				return;
			}
			if (item.hash.startsWith("unresolved:")) {
				const resolved = await resolveTorrent(
					{ downloadUrl: item.source, hash: item.expectedHash },
					this.options.transport,
					this.shutdown.signal,
				);
				if (
					this.options.store
						.intents()
						.some(
							(other) => other.id !== item.id && other.hash === resolved.hash,
						)
				) {
					this.save({ ...item, state: "blocked", error: "torrent_reserved" });
					return;
				}
				item = this.save({ ...item, hash: resolved.hash });
			}
			await this.options.withClient(
				item.destination.connectionGeneration,
				async (client) => {
					let task = await client.task(item.hash, this.shutdown.signal);
					this.open();
					const latest = this.options.store.intent(item.id);
					if (!latest || latest.revision !== item.revision) return;

					if (!task && ["unknown", "submitting"].includes(item.state)) {
						this.save({
							...item,
							state: "unknown",
							error: "submission_unconfirmed",
							nextAttemptAt: this.now() + policy.idleIntervalMs,
						});
						return;
					}
					if (!task && item.state === "bound") {
						this.save({
							...item,
							state: "missing",
							transfer: "missing",
							error: "externally_removed",
							observedAt: this.now(),
						});
						return;
					}
					if (!task) {
						const subscription = this.options.discovery.subscription(
							item.workKey,
						);
						if (!subscription || !this.authorized(subscription)) return;
						if (subscription.startEpisode > item.episode) return;
						const destination = this.options.store.destination();
						if (
							!destination ||
							destination.revision !== item.destination.revision
						)
							throw new DownloadError("destination_changed");
						const target = await this.options.anime.target(
							item.workKey,
							this.shutdown.signal,
						);
						if (target.availableEpisodes.includes(item.episode)) {
							this.save({
								...item,
								state: "blocked",
								error: "already_available",
							});
							return;
						}
						const assessment = this.options.anime.assess(item.title, target);
						if (!assessment.eligible || assessment.episode !== item.episode) {
							this.save({
								...item,
								state: "blocked",
								error: "release_evidence_changed",
							});
							return;
						}
						const snapshot = await client.tasks(this.shutdown.signal);
						if (
							snapshot.some((task) => {
								if ([task.hash, task.v1Hash, task.v2Hash].includes(item.hash))
									return true;
								const assessment = this.options.anime.assess(task.name, target);
								return (
									assessment.eligible && assessment.episode === item.episode
								);
							})
						) {
							this.save({
								...item,
								state: "blocked",
								error: "episode_downloading",
							});
							return;
						}
						const source = await resolveTorrent(
							{ downloadUrl: item.source, hash: item.hash },
							this.options.transport,
							this.shutdown.signal,
						);
						const probe = await client.probe(this.shutdown.signal);
						if (
							!probe.incompletePathEnabled ||
							!probe.incompletePath ||
							inside(
								absoluteDownloadPath(probe.incompletePath),
								item.destination.path,
							) ||
							inside(
								item.destination.path,
								absoluteDownloadPath(probe.incompletePath),
							)
						)
							throw new DownloadError("incomplete_directory_required");
						await this.options.resources.validate(
							item.destination.scopeId,
							probe.incompletePath,
						);
						this.open();
						const before = this.options.discovery.subscription(item.workKey);
						if (
							!before ||
							before.revision !== subscription.revision ||
							!this.authorized(before)
						)
							return;
						const choice = this.options.discovery
							.candidates(item.workKey)
							.find(
								(candidate) =>
									candidate.id === item.candidateId &&
									candidate.episode === item.episode &&
									candidate.status === "selected",
							);
						if (!choice) {
							this.save({
								...item,
								state: "blocked",
								error: "selection_changed",
							});
							return;
						}
						item = this.save({
							...item,
							state: "submitting",
							attempts: item.attempts + 1,
							subscriptionRevision: before.revision,
							error: null,
						});
						try {
							await client.add(
								{
									source: source.source,
									savePath: posix.join(item.destination.path, item.directory),
									category: "anishelf",
									tags: [`anishelf-${item.id}`],
								},
								this.shutdown.signal,
							);
						} catch (error) {
							if (
								error instanceof QbittorrentError &&
								error.outcome !== "unknown"
							)
								throw error;
							this.save({
								...item,
								state: "unknown",
								error: "submission_unconfirmed",
								nextAttemptAt: this.now() + policy.activeIntervalMs,
							});
							return;
						}
						task = await client.task(item.hash, this.shutdown.signal);
						if (!task) {
							this.save({
								...item,
								state: "unknown",
								error: "submission_unconfirmed",
							});
							return;
						}
					}
					if (
						task.category !== "anishelf" ||
						!task.tags.includes(`anishelf-${item.id}`)
					) {
						this.save({
							...item,
							state: "blocked",
							error: "external_task_conflict",
						});
						return;
					}
					if (
						absoluteDownloadPath(task.savePath) !==
						posix.join(item.destination.path, item.directory)
					)
						throw new DownloadError("task_path_changed");
					item = this.save({
						...item,
						state: "bound",
						transfer: task.state,
						progress: task.progress,
						observedAt: this.now(),
						error: ["failed", "review"].includes(item.ingestion)
							? item.error
							: null,
						nextAttemptAt: 0,
					});
					if (
						task.progress !== 1 ||
						task.remainingBytes !== 0 ||
						/checking|moving|meta|error|missing/i.test(task.state)
					)
						return;
					if (item.ingestion === "review" || item.ingestion === "failed")
						return;
					const files = await client.files(item.hash, this.shutdown.signal);
					const selected = files.filter((file) => file.priority > 0);
					const videos = selected.filter((file) =>
						/\.(?:mkv|mp4|m4v|webm|avi|mov|ts|m2ts|mpg|mpeg)$/i.test(file.path),
					);
					if (
						videos.length !== 1 ||
						!selected.length ||
						selected.some((file) => file.progress !== 1) ||
						videos[0]?.sizeBytes === 0
					) {
						this.save({
							...item,
							ingestion: "review",
							error: "unsupported_file_layout",
						});
						return;
					}
					const video = videos[0];
					if (!video) return;
					for (const file of files) relativeDownloadPath(file.path);
					const path = relativeDownloadPath(
						posix.join(item.directory, relativeDownloadPath(video.path)),
					);
					item = this.save({ ...item, ingestion: "validating" });
					const inspected = await this.options.resources.inspect(
						item.destination.scopeId,
						path,
					);
					if (inspected.sizeBytes !== video.sizeBytes)
						throw new DownloadError("file_size_conflict");
					const identity = await this.options.resources.refresh(
						item.destination.scopeId,
						path,
					);
					if (identity.sourceVersion !== inspected.sourceVersion)
						throw new DownloadError("source_changed");
					const completed = await client.task(item.hash, this.shutdown.signal),
						finalFiles = await client.files(item.hash, this.shutdown.signal);
					if (
						completed?.progress !== 1 ||
						completed.remainingBytes !== 0 ||
						completed.savePath !== task.savePath ||
						JSON.stringify(finalFiles) !== JSON.stringify(files)
					)
						throw new DownloadError("download_changed");
					const outcome = await this.options.ingestion.ingest(
						item.workKey,
						item.episode,
						identity,
						this.shutdown.signal,
					);
					const destination = this.options.store.destination();
					if (destination?.revision === item.destination.revision)
						this.options.store.saveDestination({
							...destination,
							visibilityVerified: true,
						});
					this.save({
						...item,
						sourceIdentity: identity,
						state: outcome === "available" ? "available" : "bound",
						ingestion: outcome,
						error: outcome === "review" ? "association_requires_review" : null,
					});
				},
			);
		} catch (error) {
			if (this.shutdown.signal.aborted) return;
			const current = this.options.store.intent(item.id);
			if (!current || current.revision !== item.revision) return;
			const code =
				error instanceof DownloadError
					? error.code
					: error instanceof QbittorrentError
						? `downloader_${error.code}`
						: "verification_unavailable";
			this.save({
				...current,
				state:
					current.state === "submitting"
						? error instanceof QbittorrentError &&
							error.outcome !== "unknown" &&
							error.outcome !== "read"
							? "pending"
							: "unknown"
						: current.state === "available"
							? "bound"
							: current.state,
				ingestion:
					current.ingestion === "validating" ||
					current.ingestion === "available"
						? "failed"
						: current.ingestion,
				error: code,
				attempts: current.attempts + 1,
				nextAttemptAt: this.now() + this.delay(current.attempts + 1),
			});
		}
	}
	tick(): Promise<void> {
		if (this.running || this.shutdown.signal.aborted)
			return this.running ?? Promise.resolve();
		const task = (async () => {
			await this.discover();
			const intents = this.options.store.intents();
			for (
				let offset = 0;
				offset < intents.length && !this.shutdown.signal.aborted;
				offset += policy.maximumConcurrent
			)
				await Promise.all(
					intents
						.slice(offset, offset + policy.maximumConcurrent)
						.map((item) => this.reconcile(item)),
				);
			this.options.store.prune(this.now() - policy.historyMs);
		})().catch(() => {
			if (!this.shutdown.signal.aborted)
				this.options.logger.warn(
					{ event: "acquisition.worker_failed" },
					"Acquisition worker will retry.",
				);
		});
		this.running = task;
		void task.finally(() => {
			this.running = undefined;
		});
		return task;
	}
	start() {
		const run = async () => {
			await this.tick();
			if (this.shutdown.signal.aborted) return;
			const active = this.options.store
				.intents()
				.some(
					(item) => !["available", "missing", "blocked"].includes(item.state),
				);
			this.timer = setTimeout(
				() => {
					void run();
				},
				active ? policy.activeIntervalMs : policy.idleIntervalMs,
			);
			this.timer.unref();
		};
		void run();
	}
	async close() {
		this.shutdown.abort();
		if (this.timer) clearTimeout(this.timer);
		await this.options.transport.close();
		await Promise.allSettled([
			...this.pending,
			...(this.running ? [this.running] : []),
		]);
	}
}
