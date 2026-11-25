import { workReference } from "@anishelf/contracts/references";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import type {
	AnimeCatalogApi,
	CatalogMetadata,
} from "../anime-catalog/public.js";
import type { MetadataIdentitiesApi } from "../external-works/metadata/public.js";
import {
	proposeMapping,
	rankCandidates,
	titleEvidence,
} from "../identification/public.js";
import { releaseAttributes } from "./attributes.js";
import { mapReleaseFiles } from "./file-mapping.js";
import type {
	AcquisitionTarget,
	ReleaseAssessmentApi,
	ReleaseParser,
} from "./public.js";
import { acquisitionSearchTitles } from "./search-titles.js";
import {
	localizedPackLabel,
	matchesPublicationTitle,
	publicationRangeEvidence,
} from "./title.js";

/** Remote publication evidence never impersonates a confined local source. */
export class AnimeReleaseAssessment implements ReleaseAssessmentApi {
	constructor(
		private readonly parser: ReleaseParser,
		private readonly metadata: Pick<CatalogMetadata, "get">,
		private readonly catalog:
			| Pick<AnimeCatalogApi, "availableEpisodes">
			| undefined,
		private readonly identities: MetadataIdentitiesApi,
		private readonly logger?: Logger,
	) {}
	async target(key: string, signal?: AbortSignal): Promise<AcquisitionTarget> {
		let reference: ReturnType<typeof workReference>;
		try {
			reference = workReference(key);
		} catch {
			throw new DomainError("INVALID_REQUEST", "Invalid subscription target.");
		}
		const snapshot = await this.metadata.get(
			this.identities.referenceForExternal(reference),
			{
				...(signal ? { signal } : {}),
			},
		);
		const data = snapshot.data;
		const ordinals = data.titles.map((title) => titleEvidence(title.value));
		const seasons = [...new Set(ordinals.flatMap((title) => title.seasons))];
		const parts = [...new Set(ordinals.flatMap((title) => title.parts))];
		const availability = (await this.catalog?.availableEpisodes(
			snapshot.data.reference,
		)) ?? {
			episodes: [],
			revision: "no-catalog",
		};
		const searchTitles = acquisitionSearchTitles(data.titles);
		this.logger?.debug(
			{
				event: "acquisition.search_titles_selected",
				count: searchTitles.length,
			},
			"Romaji, English, native and Chinese search titles selected.",
		);
		return {
			airing: {
				status: data.status,
				nextEpisode: data.nextAiringEpisode
					? {
							episode: data.nextAiringEpisode.episode,
							airingAt: data.nextAiringEpisode.airingAt * 1000,
						}
					: null,
				fetchedAt: snapshot.fetchedAt,
				stale: snapshot.stale,
				refreshing: snapshot.refreshing,
				refreshError: snapshot.refreshError !== null,
			},
			searchTitles,
			work: {
				reference: snapshot.data.reference,
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
	assessReleaseTitle(
		title: string,
		target: AcquisitionTarget,
	): ReturnType<ReleaseAssessmentApi["assessReleaseTitle"]> {
		const evidence = this.parser.extractRelease(title);
		const publication = publicationRangeEvidence(this.parser, evidence);
		const candidate = rankCandidates(publication, [target.work])[0];
		const version = `${evidence.parserVersion}:${evidence.normalizationVersion}:${candidate?.matcherVersion ?? "unknown"}:rss-single-v2`;
		const titleMatches = publication.titles.some((value) =>
			matchesPublicationTitle(
				value,
				target.work,
				publication.seasons,
				publication.parts,
			),
		);
		const possiblePack =
			publication.numbering === "range" ||
			(publication.numbering === "ambiguous" &&
				publication.rawEpisodes.length > 1) ||
			(publication.numbering === "unknown" && publication.seasons.length > 0) ||
			localizedPackLabel.test(title) ||
			evidence.inputs.some((input) =>
				input.elements.some(
					(element) =>
						element.kind === "release_information" &&
						/^(batch|complete)$/iu.test(element.value),
				),
			);
		const plausibleIdentity = Boolean(
			titleMatches &&
				candidate &&
				!candidate.identityConflicts?.length &&
				!candidate.identityUnresolved?.length,
		);
		const inspectionCandidate =
			plausibleIdentity &&
			target.work.format !== "MOVIE" &&
			(publication.contentKind === "regular" ||
				publication.contentKind === "unknown") &&
			(possiblePack || publication.numbering === "single");
		const reasons: string[] = [];
		let episode: number | null = null;
		if (!plausibleIdentity || (!possiblePack && candidate?.conflicts.length))
			reasons.push("identity_unconfirmed");
		if (possiblePack && inspectionCandidate) {
			reasons.push("pack_requires_inspection");
		} else {
			if (publication.contentKind !== "regular")
				reasons.push("unsupported_content");
			if (!possiblePack && publication.numbering === "single") {
				const mapping = proposeMapping(publication, target.work);
				const mapped = mapping.targets[0];
				if (
					mapping.targets.length === 1 &&
					!mapping.unresolved.length &&
					mapped?.kind === "regular"
				)
					episode = Number(mapped.number);
			}
			if (!episode || !Number.isSafeInteger(episode))
				reasons.push("episode_unconfirmed");
		}
		return {
			episode,
			inspectionCandidate,
			attributes: releaseAttributes(evidence),
			eligible: reasons.length === 0,
			reasons,
			version,
		};
	}
	mapReleaseFiles(
		...args: Parameters<NonNullable<ReleaseAssessmentApi["mapReleaseFiles"]>>
	) {
		const [title, target, files] = args;
		const evidence = this.parser.extractRelease(title);
		return mapReleaseFiles(
			this.parser,
			publicationRangeEvidence(this.parser, evidence),
			target,
			files,
		);
	}
}
