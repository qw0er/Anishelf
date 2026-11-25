import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { abortable } from "../../../../shared/abortable.js";
import { DomainError } from "../../../../shared/errors.js";
import type { ManifestPreviewCandidate } from "../../manifest-preview.js";
import { selectCandidates } from "../../release-selection.js";
import { type ReleaseEvidence, SourceError } from "../../sources/public.js";
import {
	acquisitionProfileFingerprint,
	builtinAcquisitionProfiles,
	defaultAcquisitionProfileId,
} from "../../subscriptions/public.js";
import { downloadDefaults } from "../defaults.js";
import { observeFileSelection } from "../domain/file-selection.js";
import { DownloadError, type DownloadIntent } from "../domain/model.js";
import { workDirectory } from "../domain/paths.js";
import {
	conflict,
	type DownloadApplicationContext,
	type DownloadExecution,
} from "./context.js";
import { absoluteDownloadPath, sameDownloadPath } from "./destination-paths.js";
import { episodeFileOptions } from "./episode-file-options.js";

/** One explicit episode request owns its discovery and permission; no subscription writes. */
export class OneOffDownloads {
	constructor(private readonly context: DownloadApplicationContext) {}
	private configuration() {
		const { options } = this.context;
		const destination = options.store.destination();
		const sources = options.sources.connector.settings();
		const profileId =
			options.defaultProfileId?.() ?? defaultAcquisitionProfileId;
		const profile = (options.profiles ?? builtinAcquisitionProfiles).find(
			(value) => value.id === profileId,
		);
		if (
			!destination?.validated ||
			destination.connectionGeneration !== options.connectionGeneration() ||
			!sources.ready ||
			!sources.providers.length ||
			!profile
		)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Configure and validate download settings and source sites first.",
			);
		return { destination, sources, profile };
	}
	authorized(item: DownloadIntent) {
		try {
			const config = this.configuration();
			return Boolean(
				item.oneOff &&
					config.destination.revision === item.destination.revision &&
					config.sources.generation === item.oneOff.sourceGeneration &&
					config.profile.id === item.oneOff.profileId &&
					acquisitionProfileFingerprint(config.profile) ===
						item.oneOff.profileFingerprint,
			);
		} catch {
			return false;
		}
	}
	canRetry(item: DownloadIntent) {
		if (
			!item.oneOff ||
			!(
				["missing", "blocked", "unknown"].includes(item.state) ||
				(item.state === "pending" && item.error)
			)
		)
			return false;
		try {
			this.configuration();
			return true;
		} catch {
			return false;
		}
	}
	accept(input: { workKey: string; episode: number; commandId: string }) {
		return this.context.tracked(async () => {
			const { options } = this.context;
			if (
				!Number.isSafeInteger(input.episode) ||
				input.episode < 1 ||
				input.episode > 10000 ||
				!/^[0-9a-f-]{36}$/i.test(input.commandId)
			)
				throw new DomainError("INVALID_REQUEST", "Invalid episode request.");
			const existingRequest = () => {
				const replay = options.store.episodeCommand(input.commandId);
				const existing =
					replay ?? options.store.episodeIntent(input.workKey, input.episode);
				if (!existing) return null;
				if (
					existing.workKey !== input.workKey ||
					existing.episode !== input.episode
				)
					conflict();
				if (!replay) {
					options.store.saveEpisodeCommand(input.commandId, existing.id);
					options.logger.info(
						{
							event: "acquisition.episode_claim_joined",
							intentId: existing.id,
							workKey: input.workKey,
							episode: input.episode,
						},
						"Single-episode command joined an existing claim.",
					);
				}
				return {
					accepted: true as const,
					intentId: existing.id,
					existing: true,
				};
			};
			const existing = options.store.transaction(existingRequest);
			if (existing) return existing;
			const config = this.configuration();
			const target = await options.anime.target(
				input.workKey,
				this.context.signal,
			);
			this.context.open();
			if (
				target.work.format === "MOVIE" ||
				(target.work.episodeCount !== null &&
					input.episode > target.work.episodeCount)
			)
				throw new DomainError(
					"INVALID_REQUEST",
					"This episode cannot be acquired individually.",
				);
			if (target.availableEpisodes.includes(input.episode))
				throw new DomainError(
					"ACQUISITION_CONFLICT",
					"This episode is already available locally.",
				);
			const now = this.context.now();
			const item: DownloadIntent = {
				id: input.commandId,
				revision: randomUUID(),
				workKey: input.workKey,
				candidateId: input.commandId,
				episode: input.episode,
				title: (target.work.titles[0] ?? "Anime").slice(0, 1024),
				hash: `unresolved:${randomUUID()}`,
				expectedHash: null,
				source: "",
				destination: config.destination,
				directory:
					options.store.directory(input.workKey) ??
					workDirectory(input.workKey, target.work.titles[0] ?? "Anime"),
				origin: "one-off",
				subscriptionRevision: null,
				oneOff: {
					profileId: config.profile.id,
					profileFingerprint: acquisitionProfileFingerprint(config.profile),
					sourceGeneration: config.sources.generation,
					discovery: [],
				},
				state: "discovering",
				transfer: null,
				progress: null,
				ingestion: "not-ready",
				error: null,
				attempts: 0,
				nextAttemptAt: 0,
				observedAt: null,
				createdAt: now,
				updatedAt: now,
				sourceIdentity: null,
				lastCommand: null,
			};
			const accepted = options.store.transaction(() => {
				const prior = existingRequest();
				if (prior) return prior;
				if (!this.authorized(item) || !options.store.reserve(item)) conflict();
				options.store.saveEpisodeCommand(input.commandId, item.id);
				options.store.saveDirectory(item.workKey, item.directory);
				return { accepted: true as const, intentId: item.id, existing: false };
			});
			if (accepted.existing) return accepted;
			options.logger.info(
				{
					event: "acquisition.episode_requested",
					intentId: item.id,
					workKey: item.workKey,
					episode: item.episode,
				},
				"Single-episode acquisition accepted.",
			);
			return accepted;
		});
	}
	/** Explicit retry adopts current settings, while uncertain submissions retain their identity. */
	prepareRetry(item: DownloadIntent): DownloadIntent {
		const config = this.configuration();
		const selective = item.transferId
			? this.context.options.store.fileSelection(item.transferId)
			: null;
		if (selective?.pending?.requestId === item.id)
			return {
				...item,
				state: selective.pending.sentAt === null ? "pending" : "unknown",
			};
		if (selective)
			item = {
				...item,
				source: "",
				expectedHash: null,
				hash: `unresolved:${randomUUID()}`,
				sourceIdentity: null,
				associationReview: null,
			};
		const uncertain =
			item.oneOff?.uncertainSubmission ||
			item.state === "unknown" ||
			item.error === "submission_unconfirmed" ||
			(item.error === "downloader_configuration_changed" &&
				!item.hash.startsWith("unresolved:"));
		const reconcileOnly = Boolean(
			uncertain &&
				(item.oneOff?.reconcileOnly ||
					!this.authorized(item) ||
					!this.context.options.sources.isContentCurrent(item.source)),
		);
		const rediscover =
			!uncertain &&
			(!item.source ||
				!this.context.options.sources.isContentCurrent(item.source) ||
				item.oneOff?.profileId !== config.profile.id ||
				item.oneOff.profileFingerprint !==
					acquisitionProfileFingerprint(config.profile));
		return {
			...item,
			destination: config.destination,
			oneOff: {
				profileId: config.profile.id,
				profileFingerprint: acquisitionProfileFingerprint(config.profile),
				sourceGeneration: config.sources.generation,
				uncertainSubmission: uncertain,
				reconcileOnly,
				discovery: item.oneOff?.discovery ?? [],
			},
			state: reconcileOnly ? "unknown" : rediscover ? "discovering" : "pending",
			...(rediscover
				? { source: "", expectedHash: null, hash: `unresolved:${randomUUID()}` }
				: {}),
		};
	}
	async discover(execution: DownloadExecution) {
		const { options } = this.context;
		const initial = execution.current;
		const attempts: NonNullable<DownloadIntent["oneOff"]>["discovery"] = [];
		const guard = () => {
			this.context.open();
			if (
				options.store.intent(initial.id)?.revision !==
					execution.current.revision ||
				!this.authorized(execution.current)
			)
				throw new DownloadError("acquisition_configuration_changed");
		};
		try {
			guard();
			const config = this.configuration();
			const target = await options.anime.target(
				initial.workKey,
				this.context.signal,
			);
			guard();
			if (target.availableEpisodes.includes(initial.episode))
				throw new DownloadError("already_available");
			const titles = target.searchTitles;
			if (!titles.length) throw new DownloadError("discovery_unavailable");
			const tasks = await options.withClient(
				initial.destination.connectionGeneration,
				async (client) => {
					const tasks = await client.tasks(this.context.signal);
					if (
						tasks.some((task) => {
							const assessment = options.anime.assessReleaseTitle(
								task.name,
								target,
							);
							return (
								assessment.eligible && assessment.episode === initial.episode
							);
						})
					)
						throw new DownloadError("episode_downloading");
					return tasks;
				},
			);
			const hashes = new Set(
				tasks.flatMap((task) =>
					[task.hash, task.v1Hash, task.v2Hash].filter((hash): hash is string =>
						Boolean(hash),
					),
				),
			);
			guard();
			const entries: ReleaseEvidence[] = [];
			const inspection: ManifestPreviewCandidate[] = [];
			for (const providerId of config.sources.providers) {
				try {
					const publication = await abortable(
						options.sources.fetch({
							kind: "search",
							connectionRevision: config.sources.generation,
							providerId,
							titles,
						}),
						this.context.signal,
					);
					guard();
					publication.commit(() => {});
					attempts.push({
						providerId,
						code: null,
						limited: publication.snapshot.coverage?.limited ?? false,
					});
					let packsRequiringInspection = 0;
					for (const entry of publication.snapshot.entries) {
						const assessment = options.anime.assessReleaseTitle(
							entry.title,
							target,
						);
						if (assessment.reasons.includes("pack_requires_inspection")) {
							packsRequiringInspection++;
							if (
								options.manifestPreview &&
								publication.content &&
								entry.download
							)
								inspection.push({ publication, entry });
						}
						if (
							!assessment.eligible ||
							assessment.episode !== initial.episode ||
							!entry.download
						)
							continue;
						// Namespace provider IDs so one provider cannot overwrite another's evidence.
						entries.push({
							...entry,
							id: `${publication.snapshot.id}:${entry.id}`,
						});
					}
					if (packsRequiringInspection)
						options.logger.info(
							{
								event: "acquisition.episode_packs_found",
								intentId: initial.id,
								providerId,
								count: packsRequiringInspection,
								reason: "pack_requires_inspection",
							},
							"Found publications requiring file inspection during episode discovery.",
						);
				} catch (error) {
					guard();
					if (!(error instanceof SourceError)) throw error;
					attempts.push({ providerId, code: error.code, limited: false });
					options.logger.warn(
						{
							event: "acquisition.episode_source_failed",
							intentId: initial.id,
							providerId,
							code: error.code,
						},
						"Single-episode source discovery failed.",
					);
				}
			}
			guard();
			const policy = {
				subscription: {
					workKey: initial.workKey,
					startEpisode: initial.episode,
					profileId: config.profile.id,
				},
				target,
				profile: config.profile,
				now: this.context.now(),
			};
			const acceptedTarget = {
				workKey: initial.workKey,
				reference: target.work.reference,
				episode: initial.episode,
				snapshotId: target.work.snapshotId,
			};
			const candidates = selectCandidates({
				...policy,
				feed: { entries },
				waitForLevels: false,
				active: hashes,
				downloadsUnknown: false,
				assessReleaseTitle: options.anime.assessReleaseTitle.bind(
					options.anime,
				),
			});
			const chosen = candidates.find(
				(candidate) => candidate.status === "selected",
			);
			const entry =
				chosen && entries.find((entry) => entry.id === chosen.entryId);
			if (!chosen || !entry?.download) {
				if (inspection.length && options.manifestPreview) {
					const previews = await options.manifestPreview.preview({
						candidates: inspection,
						target,
						workKey: initial.workKey,
						scope: { episode: initial.episode },
						signal: this.context.signal,
					});
					guard();
					const choices = episodeFileOptions({
						inspection,
						previews,
						policy,
						episode: initial.episode,
						assessTitle: options.anime.assessReleaseTitle.bind(options.anime),
					});
					if (choices.length) {
						const generation = initial.destination.connectionGeneration;
						const supported = await options.withClient(
							generation,
							async (client) =>
								Boolean(
									client.enableFiles &&
										(await client.probe(this.context.signal)).selectiveFiles,
								),
						);
						guard();
						let busy = false;
						let conflictCode: string | undefined;
						if (!supported) throw new DownloadError("metadata_unsupported");
						for (const choice of choices) {
							if (!options.sources.isContentCurrent(choice.source)) continue;
							const hash = choice.plan.manifest.hash;
							const owned = options.store.ownedFileSelection(hash, generation);
							const task =
								owned && !owned.pending
									? await options.withClient(generation, (client) =>
											client.task(
												owned.manifest.v2Hash?.slice(0, 40) ?? hash,
												this.context.signal,
											),
										)
									: tasks.find((entry) =>
											[entry.hash, entry.v1Hash, entry.v2Hash].includes(hash),
										);
							guard();
							if (task && (!owned || task.ownerKey !== owned.ownerKey)) {
								conflictCode ??= "external_task_conflict";
								continue;
							}
							if (!task && owned && !owned.pending) {
								if (
									!options.store.updateFileSelection({
										transferId: owned.id,
										revision: owned.revision,
										release: true,
									})
								) {
									busy = true;
									continue;
								}
								options.logger.info(
									{
										event: "acquisition.file_selection_released",
										transferId: owned.id,
										code: "externally_removed",
									},
									"Released ownership of a removed torrent task.",
								);
							}
							if (task && owned?.observed && !owned.pending) {
								if (
									!sameDownloadPath(
										task.savePath,
										join(
											absoluteDownloadPath(owned.destination.path),
											owned.directory,
										),
									)
								) {
									conflictCode ??= "task_path_changed";
									continue;
								}
								const compatible = await options
									.withClient(generation, async (client) => {
										const files = await client.files(
											task.hash,
											this.context.signal,
										);
										return (
											JSON.stringify(
												observeFileSelection(choice.plan.manifest, files),
											) === JSON.stringify(owned.observed)
										);
									})
									.catch(() => false);
								guard();
								if (!compatible) {
									conflictCode ??= "file_selection_changed";
									continue;
								}
							}
							const result = execution.planSelection(
								{
									...execution.current,
									acceptedTarget,
									candidateId: choice.candidate.id,
									title: choice.candidate.title.slice(0, 1024),
									source: choice.source,
									expectedHash: hash,
									state: "pending",
									error: null,
									nextAttemptAt: 0,
									oneOff: {
										...configToAuthorization(config),
										discovery: attempts,
									},
								},
								choice.plan,
							);
							if (result === "planned") return;
							if (result === "busy") busy = true;
						}
						if (busy) {
							execution.save({
								...execution.current,
								error: null,
								nextAttemptAt:
									this.context.now() + downloadDefaults.activeIntervalMs,
							});
							return;
						}
						if (conflictCode) throw new DownloadError(conflictCode);
					}
					if (previews.length && previews.every(({ code }) => code !== null)) {
						const codes = previews.map(({ code }) => code);
						const reason = [
							"metadata_timeout",
							"metadata_unsupported",
							"torrent_identity_conflict",
							"invalid_file_path",
							"source_changed",
						].find((code) => codes.includes(code));
						throw new DownloadError(reason ?? "torrent_unavailable");
					}
				}
				throw new DownloadError(
					attempts.some((attempt) => attempt.code)
						? "discovery_unavailable"
						: "no_eligible_release",
				);
			}
			if (!options.sources.isContentCurrent(entry.download))
				throw new DownloadError("source_changed");
			execution.save({
				...execution.current,
				acceptedTarget,
				candidateId: chosen.id,
				title: chosen.title.slice(0, 1024),
				source: entry.download,
				expectedHash: entry.hash,
				state: "pending",
				oneOff: { ...configToAuthorization(config), discovery: attempts },
				error: null,
			});
			options.logger.info(
				{
					event: "acquisition.episode_release_selected",
					intentId: initial.id,
					episode: initial.episode,
					providers: attempts.length,
				},
				"Single-episode release selected without subscription waiting.",
			);
		} catch (error) {
			if (
				this.context.signal.aborted ||
				options.store.intent(initial.id)?.revision !==
					execution.current.revision
			)
				return;
			const code =
				error instanceof DownloadError ? error.code : "discovery_unavailable";
			execution.save({
				...execution.current,
				state: "blocked",
				error: code,
				oneOff: initial.oneOff
					? { ...initial.oneOff, discovery: attempts }
					: null,
			});
			options.logger.warn(
				{
					event: "acquisition.episode_discovery_stopped",
					intentId: initial.id,
					code,
				},
				"Single-episode discovery stopped; explicit retry is available.",
			);
		}
	}
}

function configToAuthorization(config: {
	profile: Parameters<typeof acquisitionProfileFingerprint>[0];
	sources: { generation: string };
}) {
	return {
		profileId: config.profile.id,
		profileFingerprint: acquisitionProfileFingerprint(config.profile),
		sourceGeneration: config.sources.generation,
	};
}
