import type {
	AnimeDetailResponse,
	AnimeStatusResponse,
	CatalogReviewItem,
	LocalWorkDetailResponse,
	TrackingEntryResponse,
} from "../../src/shared/api/contracts.js";
import { trackingProvider } from "../tracking-fixture.js";

export function animeFixture(): LocalWorkDetailResponse {
	const reference = {
		provider: "anilist",
		mediaType: "anime",
		id: "154587",
	} as const;
	const work = {
		id: "work-1",
		providerTitle: "Frieren",
		searchTitles: ["Frieren"],
		format: "TV",
		year: 2023,
		episodeCount: 3,
		airedEpisodeCount: 3,
		revision: 1,
		createdAt: 1,
		updatedAt: 1,
		displayTitle: "Frieren",
		metadataStale: true,
		reference,
		availableEpisodes: 1,
		availableRegularEpisodes: 1,
		coverUrl: "/api/catalog/works/work-1/artwork/cover",
	};
	const version = (sourceId: string, available = true) => ({
		sourceId,
		reviewId: `review-${sourceId}`,
		fileId: "file-1",
		relativePath: `${sourceId}/葬送のフリーレン 01-02 [1080p].mkv`,
		sourceVersion: "source-v1",
		available,
		evidence: {
			parser: "anitomy-ng",
			parserVersion: "1",
			normalizationVersion: "1",
			contextFingerprint: "context",
			originalName: "葬送のフリーレン 01-02 [1080p].mkv",
			relativePath: `${sourceId}/file.mkv`,
			inputs: [
				{
					mode: "basename" as const,
					input: "file.mkv",
					elements: [
						{ kind: "VideoResolution", value: "1080p", position: 0 },
						{ kind: "ReleaseGroup", value: "Group A", position: 1 },
					],
				},
			],
			titles: ["Frieren"],
			years: ["2023"],
			seasons: [],
			parts: [],
			rawEpisodes: ["1", "2"],
			numbering: "range" as const,
			contentKind: "regular" as const,
		},
		mapping: { rawNumbers: ["1", "2"], reason: "Confirmed", offset: 0 },
	});
	return {
		work,
		bannerUrl: null,
		episodeCountProvenance: "provider-count",
		metadata: {
			snapshotId: "snapshot",
			fetchedAt: 1,
			stale: true,
			refreshing: false,
			refreshError: null,
			data: {
				reference,
				titles: [{ value: "Frieren", language: "en", kind: "english" }],
				unavailableFields: ["endDate"],
				year: 2023,
				format: "TV",
				status: "FINISHED",
				episodeCount: 3,
				nextAiringEpisode: null,
				airingSeason: "FALL",
				coverUrl:
					"https://s4.anilist.co/file/anilistcdn/media/anime/cover/test.jpg",
				bannerUrl: null,
				description:
					'<b>Safe synopsis</b><script>alert(1)</script><img src="https://tracking.invalid/pixel" onerror="alert(2)"><a href="javascript:alert(3)">Bad link</a>',
				startDate: { year: 2023, month: 9, day: 29 },
				endDate: null,
				durationMinutes: 24,
				country: "JP",
				source: "MANGA",
				genres: ["Adventure"],
				tags: [{ name: "Hidden spoiler", rank: 50, spoiler: true }],
				studios: [{ id: "1", name: "Madhouse" }],
				averageScore: 90,
				siteUrl: "https://anilist.co/anime/154587",
				providerUpdatedAt: null,
				streamingEpisodes: [],
				episodeCatalog: "unavailable",
			},
		},
		episodes: [
			{
				id: "ep-1",
				workId: work.id,
				kind: "regular",
				number: "1",
				label: "Episode 1",
				provenance: "confirmed",
				versions: [
					version("source-a"),
					version("source-b"),
					version("source-missing", false),
				],
				availability: "available",
			},
			{
				id: "ep-2",
				workId: work.id,
				kind: "regular",
				number: "2",
				label: "Episode 2",
				provenance: "confirmed",
				versions: [version("source-missing", false)],
				availability: "unavailable",
			},
			{
				id: "ep-3",
				workId: work.id,
				kind: "regular",
				number: "3",
				label: "Episode 3",
				provenance: "count-derived",
				versions: [],
				availability: "missing",
			},
		],
	};
}

export function reviewFixture(confirmed = false): CatalogReviewItem {
	const detail = animeFixture();
	const version = detail.episodes[0]?.versions[0];
	if (!version) throw new Error("Missing version fixture");
	return {
		id: version.reviewId,
		sourceId: version.sourceId,
		rootId: "root",
		fileId: version.fileId,
		relativePath: version.relativePath,
		sourceVersion: version.sourceVersion,
		available: true,
		revision: 1,
		decision: confirmed ? "confirmed" : "pending",
		reason: confirmed
			? "Automatically identified from an unambiguous title and episode mapping."
			: null,
		evidence: version.evidence,
		proposals: [],
		metadataStatus: "failed",
		unresolved: ["Metadata search failed; manual identification is required."],
		associations: confirmed
			? [
					{
						workId: detail.work.id,
						workTitle: detail.work.displayTitle,
						reference: detail.work.reference,
						episodeId: "ep-1",
						kind: "regular",
						number: "1",
						label: "Episode 1",
					},
				]
			: [],
	};
}

export function animeDetailFixture(
	local: LocalWorkDetailResponse,
	_viewing?: TrackingEntryResponse,
): AnimeDetailResponse {
	return {
		reference: local.work.reference,
		displayTitle: local.work.displayTitle,
		metadata: local.metadata,
		metadataError: null,
		local,
	};
}
export function animeStatusFixture(
	viewing?: TrackingEntryResponse,
): AnimeStatusResponse {
	return {
		viewing: viewing ?? {
			provider: trackingProvider,
			accountId: null,
			generation: "fixture",
			state: "disconnected",
			fetchedAt: null,
			stale: false,
			refreshing: false,
			error: null,
			entry: null,
		},
		subscription: { subscription: null },
		downloads: { total: 0, active: 0, attention: 0 },
	};
}
