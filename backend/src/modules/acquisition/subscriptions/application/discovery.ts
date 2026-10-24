import { DomainError } from "../../../../shared/errors.js";
import { SourceError } from "../../sources/public.js";
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

/** Discovery prepares a choice; only saving a subscription can grant download permission. */
export class SubscriptionDiscovery {
	private readonly running = new Set<string>();
	constructor(private readonly context: SubscriptionsContext) {}
	search(input: SubscriptionSearchInput): Promise<SubscriptionSearchResult> {
		if (this.running.has(input.workKey) || this.running.size >= 2)
			throw new DomainError(
				"ACQUISITION_UNAVAILABLE",
				"Source discovery is busy. Retry shortly.",
			);
		this.running.add(input.workKey);
		return this.context
			.tracked(() => this.run(input))
			.finally(() => this.running.delete(input.workKey));
	}
	private async run(
		input: SubscriptionSearchInput,
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
		const guard = () => {
			this.context.open();
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
		const titles = [
			...new Set(
				target.work.titles
					.map((title) => title.normalize("NFKC").trim())
					.filter(
						(title) =>
							title.length > 0 &&
							title.length <= 256 &&
							!/[\r\n\0]/.test(title),
					),
			),
		].slice(0, 4);
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
		for (const providerId of settings.providers) {
			guard();
			const source = {
				kind: "search" as const,
				connectionRevision: settings.generation,
				providerId,
				titles,
			};
			try {
				const assess = (
					feed: import("../../sources/public.js").SourceSnapshot,
				) =>
					selectCandidates({
						subscription: {
							workKey: input.workKey,
							feedId: feed.id,
							startEpisode: input.startEpisode,
							profileId,
							enabled: false,
							revision: "discovery",
						},
						feed,
						target,
						profile,
						now: this.context.now(),
						active: new Set(hashes),
						downloadsUnknown: false,
						assessReleaseTitle: (title, work) =>
							options.anime.assessReleaseTitle(title, work),
					});
				const eligibleCandidates = (candidates: ReturnType<typeof assess>) =>
					candidates.filter(
						(candidate) =>
							candidate.status === "selected" ||
							(candidate.reasons.length === 1 &&
								candidate.reasons[0] === "waiting_for_level"),
					);
				const publication = await options.sources.fetch(source, {
					accept: (snapshot) => {
						guard();
						return eligibleCandidates(assess(snapshot)).length > 0;
					},
				});
				guard();
				const candidates = assess(publication.snapshot);
				const eligible = eligibleCandidates(candidates);
				attempts.push({
					providerId,
					outcome: eligible.length
						? "matched"
						: candidates.length
							? "no_eligible"
							: "no_match",
					code: null,
					reasons: eligible.length
						? []
						: [
								...new Set(
									candidates.flatMap((candidate) => candidate.reasons),
								),
							].slice(0, 20),
					limited: publication.snapshot.coverage?.limited ?? false,
				});
				options.logger.info(
					{
						event: "acquisition.source_discovery_evaluated",
						workKey: input.workKey,
						providerId,
						outcome: attempts.at(-1)?.outcome,
						eligible: eligible.length,
					},
					"Source discovery evaluated a configured provider.",
				);
				if (eligible.length) {
					// Validate the prepared result without publishing evidence, candidates or permission.
					options.sources.snapshot(source);
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
		return { source: null, attempts, releases: [] };
	}
}
