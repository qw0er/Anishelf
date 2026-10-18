import { AniListError, type AniListListsApi } from "../../anilist/public.js";
import type { TrackingLease, TrackingListEntry } from "../domain/list.js";
import { TrackingProviderError } from "../domain/list.js";
import type { TrackingListProvider } from "../ports.js";
import {
	aniListId,
	aniListWork,
	fromAniListRemote,
} from "./provider-mapping.js";
export class AniListListProvider implements TrackingListProvider {
	constructor(private readonly client: AniListListsApi) {}
	async read(
		lease: TrackingLease,
		signal: AbortSignal,
	): Promise<TrackingListEntry[]> {
		try {
			const entries = await this.client.read(
				aniListId(lease.accountId),
				lease.credential,
				signal,
			);
			return entries.map((entry) => ({
				...entry,
				...fromAniListRemote(entry),
				mediaId: aniListWork(entry.mediaId),
			}));
		} catch (error) {
			if (error instanceof AniListError)
				throw new TrackingProviderError(
					error.failure.code,
					error.failure.retryAt,
				);
			throw error;
		}
	}
}
