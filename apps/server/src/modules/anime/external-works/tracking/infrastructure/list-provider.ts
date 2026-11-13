import { AniListError, type AniListListsApi } from "../../anilist/public.js";
import type { MetadataTitle } from "../../metadata/public.js";
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
			return entries.map(({ title, ...entry }) => ({
				...entry,
				...fromAniListRemote(entry),
				...(title
					? {
							titleVariants: (["romaji", "english", "native"] as const)
								.flatMap<MetadataTitle>((kind) => {
									const value = title?.[kind];
									return value?.trim()
										? [
												{
													value,
													kind,
													language: kind === "english" ? "en" : null,
												},
											]
										: [];
								})
								.concat(
									entry.titles
										.filter(
											(value) => !Object.values(title ?? {}).includes(value),
										)
										.map((value) => ({
											value,
											kind: "alias" as const,
											language: null,
										})),
								),
						}
					: {}),
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
