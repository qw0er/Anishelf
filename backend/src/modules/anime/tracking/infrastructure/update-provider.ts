import { AniListError, type AniListUpdateApi } from "../../anilist/public.js";
import type { TrackingLease } from "../domain/list.js";
import { TrackingListError } from "../domain/list.js";
import type { TrackingDesiredState } from "../domain/operation.js";
import type { TrackingUpdateProvider } from "../ports.js";
export class AniListUpdateProvider implements TrackingUpdateProvider {
	constructor(private readonly client: AniListUpdateApi) {}
	private async adapt<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if (error instanceof AniListError)
				throw new TrackingListError(error.failure.code, error.failure.retryAt);
			throw error;
		}
	}
	get(lease: TrackingLease, mediaId: number, signal: AbortSignal) {
		return this.adapt(() =>
			this.client.get(lease.accountId, mediaId, lease.token, signal),
		);
	}
	save(
		lease: TrackingLease,
		mediaId: number,
		entryId: number | null,
		desired: TrackingDesiredState,
		signal: AbortSignal,
	) {
		return this.adapt(() =>
			this.client.save(
				lease.accountId,
				mediaId,
				entryId,
				desired,
				lease.token,
				signal,
			),
		);
	}
}
