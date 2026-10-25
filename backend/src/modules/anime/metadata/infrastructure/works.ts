import { eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import { workKey } from "../../../../shared/external-reference.js";
import { type WorkSummary, workTitle } from "../domain/source-model.js";
import { metadataWorks } from "./schema.js";

/** Only the Metadata adapter writes the shared index, including summaries supplied by Tracking. */
export function saveWorkSummary(
	store: Store,
	work: Pick<
		WorkSummary,
		| "reference"
		| "titles"
		| "format"
		| "year"
		| "episodeCount"
		| "status"
		| "nextAiringEpisode"
		| "coverUrl"
	>,
	fetchedAt: number,
	detail = false,
	detailSnapshotId: string | null = null,
): void {
	const key = workKey(work.reference);
	const previous = store
		.select()
		.from(metadataWorks)
		.where(eq(metadataWorks.key, key))
		.get();
	// A partial list/search response cannot replace authoritative detail fields, even when newer.
	if (
		previous &&
		((previous.detail && !detail) ||
			(previous.detail === detail && previous.fetchedAt > fetchedAt))
	)
		return;
	const value = {
		key,
		provider: work.reference.provider,
		providerId: work.reference.id,
		providerTitle: workTitle(work.titles, key),
		titles: work.titles,
		format: work.format,
		year: work.year,
		episodeCount: work.episodeCount,
		status: work.status,
		nextAiringEpisode: work.nextAiringEpisode?.episode ?? null,
		nextAiringAt: work.nextAiringEpisode?.airingAt ?? null,
		coverUrl: work.coverUrl,
		fetchedAt,
		detail,
		detailSnapshotId,
	};
	store
		.insert(metadataWorks)
		.values(value)
		.onConflictDoUpdate({ target: metadataWorks.key, set: value })
		.run();
}
