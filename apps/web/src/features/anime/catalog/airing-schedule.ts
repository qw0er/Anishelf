import type {
	MetadataAiringResponse,
	MetadataDetailsResponse,
} from "../../../shared/api/contracts.js";

export interface AiringRecord {
	episode: number;
	airingAt: number;
	fetchedAt: number;
	stale: boolean;
	status: "aired" | "scheduled" | "unconfirmed";
}

/** Plans remain visible; only a snapshot taken after airtime confirms a broadcast. */
export function airingSchedule(
	pages: readonly MetadataAiringResponse[],
	metadata: MetadataDetailsResponse | null,
	now: number,
) {
	const byEpisode = new Map<number, AiringRecord>();
	function add(
		item: { episode: number; airingAt: number },
		snapshot: { fetchedAt: number; stale: boolean; refreshError: unknown },
	) {
		const record: AiringRecord = {
			...item,
			fetchedAt: snapshot.fetchedAt,
			stale: snapshot.stale || Boolean(snapshot.refreshError),
			status:
				item.airingAt * 1000 <= Math.min(now, snapshot.fetchedAt)
					? "aired"
					: item.airingAt * 1000 > now
						? "scheduled"
						: "unconfirmed",
		};
		const previous = byEpisode.get(item.episode);
		if (
			!previous ||
			record.fetchedAt > previous.fetchedAt ||
			(record.fetchedAt === previous.fetchedAt && !record.stale)
		)
			byEpisode.set(item.episode, record);
	}
	// Detail metadata provides the next broadcast even when schedule pages are incomplete.
	if (metadata?.data.nextAiringEpisode)
		add(metadata.data.nextAiringEpisode, metadata);
	for (const page of pages) for (const item of page.data.items) add(item, page);
	const records = [...byEpisode.values()].sort(
		(a, b) => a.airingAt - b.airingAt || a.episode - b.episode,
	);
	return {
		plans: records
			.filter((record) => record.status !== "aired")
			.sort(
				(a, b) =>
					Number(a.status === "unconfirmed") -
						Number(b.status === "unconfirmed") || a.airingAt - b.airingAt,
			),
		history: records.filter((record) => record.status === "aired").reverse(),
	};
}
