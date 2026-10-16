import { AniListError, type AniListListsApi } from "../../anilist/public.js";
import type { TrackingLease, TrackingListEntry } from "../domain/list.js";
import { TrackingListError } from "../domain/list.js";
import type { TrackingListProvider } from "../ports.js";
export class AniListListProvider implements TrackingListProvider {
	constructor(private readonly client: AniListListsApi) {}
	async read(
		lease: TrackingLease,
		signal: AbortSignal,
	): Promise<TrackingListEntry[]> {
		try {
			return await this.client.read(lease.accountId, lease.token, signal);
		} catch (error) {
			if (error instanceof AniListError)
				throw new TrackingListError(error.failure.code, error.failure.retryAt);
			throw error;
		}
	}
}
