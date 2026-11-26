import { DomainError } from "../../../../shared/errors.js";
import { SourceError, type SourcePublication } from "../../sources/public.js";
import { needsHistory } from "../domain/airing-schedule.js";
import type {
	SubscriptionSearchInput,
	SubscriptionSearchResult,
} from "../domain/model.js";
import {
	acquisitionProfileFingerprint,
	builtinAcquisitionProfiles,
	defaultAcquisitionProfileId,
} from "../domain/profiles.js";
import { selectCandidates } from "../domain/selection.js";
import type { SubscriptionsContext } from "./context.js";
import {
	evaluateCoverage,
	previewCoverage,
	shortlistPacks,
} from "./coverage.js";

type SearchSource = NonNullable<SubscriptionSearchResult["source"]>;
export interface DiscoveryCollection {
	source: SearchSource;
	publication: SourcePublication;
}
interface DiscoveryOptions {
	permitted?: () => boolean;
	refresh?: boolean;
	collected?(publications: readonly DiscoveryCollection[]): void;
}

/** Discovery prepares a choice; only saving a subscription can grant download permission. */
export class SubscriptionDiscovery {
	private readonly running = new Set<string>();
	constructor(private readonly context: SubscriptionsContext) {}
	search(
		input: SubscriptionSearchInput,
		options: DiscoveryOptions = {},
	): Promise<SubscriptionSearchResult> {
		if (this.running.has(input.workKey) || this.running.size >= 2)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Source discovery is busy. Retry shortly.",
			);
		this.running.add(input.workKey);
		return this.context
			.tracked(() => this.run(input, options))
			.finally(() => this.running.delete(input.workKey));
	}
	private async run(
		input: SubscriptionSearchInput,
		{ permitted, refresh = false, collected }: DiscoveryOptions,
	): Promise<SubscriptionSearchResult> {
		const { options } = this.context;
		const settings = options.sources.connector.settings();
		if (!settings.ready || settings.providers.length === 0)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Configure source sites in Settings first.",
			);
		const profileId =
			input.profileId ??
			options.defaultProfileId?.() ??
			defaultAcquisitionProfileId;
		const profile = (options.profiles ?? builtinAcquisitionProfiles).find(
			(value) => value.id === profileId,
		);
		if (!profile)
			throw new DomainError(
				"INVALID_REQUEST",
				"The acquisition profile is unavailable.",
			);
		const fingerprint = acquisitionProfileFingerprint(profile);
		const policyRevision = this.context.profileScope(input);
		const guard = () => {
			this.context.open();
			if (permitted && !permitted())
				throw new DomainError(
					"ACQUISITION_CONFLICT",
					"Subscription acquisition stopped.",
				);
			if (this.context.profileScope(input) !== policyRevision) {
				options.logger.info(
					{
						event: "acquisition.discovery_invalidated",
						workKey: input.workKey,
						profileId,
						reason: "profile_changed",
					},
					"Discarding discovery prepared under an earlier profile policy.",
				);
				throw new DomainError(
					"ACQUISITION_CONFLICT",
					"The acquisition profile changed. Search again.",
				);
			}
			if (
				(options.store.subscription(input.workKey)?.revision ?? null) !==
					input.revision ||
				options.sources.connector.settings().generation !==
					settings.generation ||
				(!input.profileId &&
					(options.defaultProfileId?.() ?? defaultAcquisitionProfileId) !==
						profileId) ||
				acquisitionProfileFingerprint(profile) !== fingerprint
			)
				throw new DomainError(
					"ACQUISITION_CONFLICT",
					"Source or subscription settings changed. Search again.",
				);
		};
		guard();
		const target = await options.anime.target(
			input.workKey,
			this.context.signal,
		);
		guard();
		const titles = target.searchTitles;
		if (!titles.length)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"No usable anime titles are available for source discovery.",
			);
		let hashes: string[] | null;
		try {
			hashes = await options.downloads(this.context.signal);
		} catch {
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"The downloader is unavailable. Retry discovery when it is ready.",
			);
		}
		if (!hashes)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"The downloader is unavailable. Retry discovery when it is ready.",
			);
		guard();
		const attempts: SubscriptionSearchResult["attempts"] = [];
		const publications: (DiscoveryCollection & { attempt: number })[] = [];
		const history = collected
			? needsHistory(
					{
						startEpisode: input.startEpisode,
						schedule:
							options.store.subscription(input.workKey)?.schedule ?? null,
					},
					target,
					this.context.now(),
				)
				? "continue"
				: "hold"
			: undefined;
		const assess = (
			publication: SourcePublication,
		): Parameters<typeof selectCandidates>[0] => ({
			subscription: {
				workKey: input.workKey,
				startEpisode: input.startEpisode,
				profileId,
			},
			feed: publication.snapshot,
			target,
			profile,
			now: this.context.now(),
			active: new Set(hashes),
			reservedEpisodes: options.reservedEpisodes?.(input.workKey),
			downloadsUnknown: false,
			assessReleaseTitle: (title, work) =>
				options.anime.assessReleaseTitle(title, work),
		});
		const eligibleCandidates = (
			candidates: ReturnType<typeof selectCandidates>,
		) =>
			candidates.filter(
				(candidate) =>
					candidate.status === "selected" ||
					(candidate.reasons.length === 1 &&
						candidate.reasons[0] === "waiting_for_level"),
			);
		const record = (
			source: SearchSource,
			publication: SourcePublication,
			candidates: ReturnType<typeof selectCandidates>,
			offset: number,
		) => {
			const eligible = eligibleCandidates(candidates);
			const episodes = [
				...new Set(
					eligible.flatMap(({ episode }) =>
						episode === null ? [] : [episode],
					),
				),
			].sort((a, b) => a - b);
			attempts[offset] = {
				providerId: source.providerId,
				outcome: episodes.length
					? "matched"
					: candidates.length
						? "no_eligible"
						: "no_match",
				code: null,
				reasons: episodes.length
					? []
					: [
							...new Set(candidates.flatMap((candidate) => candidate.reasons)),
						].slice(0, 20),
				limited: publication.snapshot.coverage?.limited ?? false,
				...(options.manifestPreview && episodes.length ? { episodes } : {}),
			};
			options.logger.info(
				{
					event: "acquisition.source_discovery_evaluated",
					profileId,
					fingerprint,
					policyRevision,
					workKey: input.workKey,
					providerId: source.providerId,
					outcome: attempts[offset].outcome,
					episodes,
				},
				"Source discovery evaluated a configured provider.",
			);
			return { eligible, episodes };
		};
		const result = (
			source: SearchSource,
			eligible: ReturnType<typeof selectCandidates>,
		) => {
			options.sources.snapshot(source);
			collected?.(publications);
			return {
				source,
				attempts,
				releases: eligible.slice(0, 20).map((candidate) => ({
					id: candidate.id,
					title: candidate.title,
					episode: candidate.episode,
					waiting: candidate.reasons.includes("waiting_for_level"),
				})),
			};
		};
		for (const providerId of settings.providers) {
			guard();
			const source: SearchSource = {
				kind: "search",
				connectionRevision: settings.generation,
				providerId,
				titles,
			};
			try {
				const publication = await options.sources.fetch(source, {
					refresh,
					...(history ? { history } : {}),
				});
				guard();
				const attempt = attempts.length;
				attempts.length++;
				publications.push({ source, publication, attempt });
				if (!options.manifestPreview) {
					const { eligible } = record(
						source,
						publication,
						selectCandidates(assess(publication)),
						attempt,
					);
					if (eligible.length) return result(source, eligible);
				}
			} catch (error) {
				guard();
				if (!(error instanceof SourceError)) throw error;
				if (
					error.code === "source_conflict" ||
					error.code === "source_disabled"
				)
					throw new DomainError(
						"ACQUISITION_CONFLICT",
						"Source settings changed. Search again.",
					);
				attempts.push({
					providerId,
					outcome: "unavailable",
					reasons: [],
					code: error.code,
					...(error.retryAt ? { retryAt: error.retryAt } : {}),
					limited: false,
				});
				options.logger.warn(
					{
						event: "acquisition.source_discovery_failed",
						workKey: input.workKey,
						providerId,
						code: error.code,
						...(error.retryAt ? { retryAt: error.retryAt } : {}),
					},
					"Source discovery could not read a configured provider.",
				);
			}
		}
		const firstPublication = publications[0];
		if (options.manifestPreview && firstPublication) {
			const shortlists = publications.map(({ publication }) =>
				shortlistPacks(this.context, publication, target),
			);
			// Give each source its first lookup before trying a second release from any source.
			const inspection = shortlists
				.flatMap((list) =>
					list.map((candidate, offset) => ({ candidate, offset })),
				)
				.sort((a, b) => a.offset - b.offset)
				.map(({ candidate }) => candidate);
			const evidence = await previewCoverage(
				this.context,
				assess(firstPublication.publication),
				inspection,
			);
			const previewByCandidate = new Map(
				inspection.map((candidate, index) => [
					candidate,
					evidence.previews[index],
				]),
			);
			guard();
			const ranked = publications
				.map(({ source, publication, attempt }, index) => {
					const shortlist = shortlists[index] ?? [];
					const previews = shortlist.map((candidate) =>
						previewByCandidate.get(candidate),
					);
					const candidates = evaluateCoverage(
						this.context,
						{ ...assess(publication), recordLevelIndex: true },
						shortlist,
						{ supported: evidence.supported, previews },
					);
					const { eligible, episodes } = record(
						source,
						publication,
						candidates,
						attempt,
					);
					const selected = eligible.filter(
						({ status }) => status === "selected",
					);
					const levels = new Map<number, number>();
					for (const { episode, selection } of eligible) {
						if (episode === null) continue;
						const level = selection?.levelIndex ?? 0;
						levels.set(
							episode,
							Math.min(level, levels.get(episode) ?? Infinity),
						);
					}
					const levelScore = [...levels.values()].reduce(
						(sum, level) => sum + level,
						0,
					);
					const usable = selected.length ? selected : eligible;
					const packEpisodes = new Map<string, Set<number>>();
					for (const candidate of usable) {
						if (
							!candidate.selection?.file?.complete ||
							candidate.episode === null
						)
							continue;
						const pack =
							packEpisodes.get(candidate.entryId) ?? new Set<number>();
						pack.add(candidate.episode);
						packEpisodes.set(candidate.entryId, pack);
					}
					return {
						source,
						eligible,
						episodes,
						selected,
						levelScore,
						single:
							episodes.length === 1 &&
							usable.some((candidate) => !candidate.selection?.file),
						full:
							input.startEpisode === 1 &&
							!target.availableEpisodes.length &&
							[...packEpisodes.values()].some(
								(pack) => pack.size === target.work.episodeCount,
							),
					};
				})
				.filter(({ episodes }) => episodes.length);
			ranked.sort(
				(a, b) =>
					b.selected.length - a.selected.length ||
					b.episodes.length - a.episodes.length ||
					a.levelScore - b.levelScore ||
					Number(b.full) - Number(a.full) ||
					Number(b.single) - Number(a.single),
			);
			const best = ranked[0];
			if (best) return result(best.source, best.eligible);
		}
		collected?.(publications);
		return { source: null, attempts, releases: [] };
	}
}
