import {
	assessReleaseTitle,
	type ReleaseParser,
	workCandidate,
} from "@anishelf/anime-identification";
import { workReference } from "@anishelf/contracts/references";
import type { Logger } from "pino";
import { DomainError } from "../../../shared/errors.js";
import type {
	AnimeCatalogApi,
	CatalogMetadata,
} from "../anime-catalog/public.js";
import type { MetadataIdentitiesApi } from "../external-works/metadata/public.js";
import { mapReleaseFiles } from "./file-mapping.js";
import type { AcquisitionTarget, ReleaseAssessmentApi } from "./public.js";
import { acquisitionSearchTitles } from "./search-titles.js";

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
			work: workCandidate(data, snapshot.snapshotId),
			availableEpisodes: availability.episodes,
			revision: JSON.stringify([snapshot.snapshotId, availability.revision]),
		};
	}
	assessReleaseTitle(
		title: string,
		target: AcquisitionTarget,
	): ReturnType<ReleaseAssessmentApi["assessReleaseTitle"]> {
		return assessReleaseTitle(this.parser, title, target.work);
	}
	mapReleaseFiles(
		...args: Parameters<NonNullable<ReleaseAssessmentApi["mapReleaseFiles"]>>
	) {
		const [title, target, files] = args;
		return mapReleaseFiles(this.parser, title, target, files, this.logger);
	}
}
