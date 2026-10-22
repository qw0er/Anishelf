import { DomainError } from "../../../shared/errors.js";
import { workReference } from "../../../shared/external-reference.js";
import type { AnimeCatalogApi } from "../anime-catalog/public.js";
import {
	matchingTitle,
	proposeMapping,
	rankCandidates,
	titleEvidence,
} from "../identification/public.js";
import type { MetadataApi } from "../metadata/public.js";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
	ReleaseParser,
} from "./public.js";

/** Remote publication evidence never impersonates a confined local source. */
export class AnimeReleaseAssessment implements ReleaseAssessmentApi {
	constructor(
		private readonly parser: ReleaseParser,
		private readonly metadata: MetadataApi,
		private readonly catalog:
			| Pick<AnimeCatalogApi, "availableEpisodes">
			| undefined,
	) {}
	async target(key: string, signal?: AbortSignal): Promise<AcquisitionTarget> {
		let reference: ReturnType<typeof workReference>;
		try {
			reference = workReference(key);
		} catch {
			throw new DomainError("INVALID_REQUEST", "Invalid subscription target.");
		}
		const snapshot = await this.metadata.get(reference, {
			...(signal ? { signal } : {}),
		});
		const data = snapshot.data;
		const ordinals = data.titles.map((title) => titleEvidence(title.value));
		const seasons = [...new Set(ordinals.flatMap((title) => title.seasons))];
		const parts = [...new Set(ordinals.flatMap((title) => title.parts))];
		const availability = (await this.catalog?.availableEpisodes(reference)) ?? {
			episodes: [],
			revision: "no-catalog",
		};
		return {
			work: {
				reference,
				snapshotId: snapshot.snapshotId,
				titles: data.titles.map((title) => title.value),
				titleVariants: data.titles.map((title) => ({
					value: title.value,
					kind: title.kind === "alias" ? "alias" : "primary",
					language: title.language,
				})),
				year: data.year,
				format: data.format,
				episodeCount: data.episodeCount,
				season: seasons.length === 1 ? (seasons[0] ?? null) : null,
				part: parts.length === 1 ? (parts[0] ?? null) : null,
				ordinalSource: "provider-title",
			},
			availableEpisodes: availability.episodes,
			revision: JSON.stringify([snapshot.snapshotId, availability.revision]),
		};
	}
	assessReleaseTitle(title: string, target: AcquisitionTarget) {
		const evidence = this.parser.extractRelease(title);
		const candidate = rankCandidates(evidence, [target.work])[0];
		const version = `${evidence.parserVersion}:${evidence.normalizationVersion}:${candidate?.matcherVersion ?? "unknown"}:rss-single-v1`;
		const mapping = proposeMapping(evidence, target.work);
		const reasons: string[] = [];
		if (
			!candidate ||
			candidate.conflicts.length ||
			!evidence.titles.some((value) =>
				target.work.titles.some((alias) =>
					matchingTitle(value, alias, evidence.seasons, evidence.parts),
				),
			)
		)
			reasons.push("identity_unconfirmed");
		if (evidence.contentKind !== "regular") reasons.push("unsupported_content");
		if (
			evidence.numbering !== "single" ||
			mapping.targets.length !== 1 ||
			mapping.unresolved.length
		)
			reasons.push("episode_unconfirmed");
		const mapped = mapping.targets[0];
		const episode =
			mapped?.kind === "regular" && /^\d+$/.test(mapped.number)
				? Number(mapped.number)
				: null;
		if (!episode || !Number.isSafeInteger(episode))
			reasons.push("episode_unconfirmed");
		return {
			episode,
			eligible: reasons.length === 0,
			reasons: [...new Set(reasons)],
			version,
		};
	}
}
