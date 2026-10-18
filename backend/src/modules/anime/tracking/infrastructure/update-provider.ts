import { AniListError, type AniListUpdateApi } from "../../anilist/public.js";
import type { TrackingLease } from "../domain/list.js";
import { TrackingProviderError } from "../domain/list.js";
import type { TrackingDesiredState } from "../domain/operation.js";
import type { TrackingUpdateProvider } from "../ports.js";
import {
	aniListId,
	fromAniListRemote,
	toAniListStatus,
} from "./provider-mapping.js";
export class AniListUpdateProvider implements TrackingUpdateProvider {
	constructor(private readonly client: AniListUpdateApi) {}
	private async adapt<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if (error instanceof AniListError)
				throw new TrackingProviderError(
					error.failure.code,
					error.failure.retryAt,
				);
			throw error;
		}
	}
	async get(lease: TrackingLease, mediaId: string, signal: AbortSignal) {
		const remote = await this.adapt(() =>
			this.client.get(
				aniListId(lease.accountId),
				aniListId(mediaId, true),
				lease.credential,
				signal,
			),
		);
		return remote ? fromAniListRemote(remote) : null;
	}
	async save(
		lease: TrackingLease,
		mediaId: string,
		entryId: string | null,
		desired: TrackingDesiredState,
		signal: AbortSignal,
	) {
		const remote = await this.adapt(() =>
			this.client.save(
				aniListId(lease.accountId),
				aniListId(mediaId, true),
				entryId === null ? null : aniListId(entryId),
				{
					...(desired.progress !== undefined
						? { progress: desired.progress }
						: {}),
					...(desired.status
						? { status: toAniListStatus(desired.status) }
						: {}),
				},
				lease.credential,
				signal,
			),
		);
		return fromAniListRemote(remote);
	}
}
