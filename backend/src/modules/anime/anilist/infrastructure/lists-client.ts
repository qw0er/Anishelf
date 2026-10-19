import { Type } from "typebox";
import { Check } from "typebox/value";
import { type AniListClient, AniListError } from "../domain/model.js";
import type { AniListListEntry, AniListListsApi } from "../domain/provider.js";

import { withAniList } from "./wrapper.js";

const nullable = <
	T extends ReturnType<typeof Type.String> | ReturnType<typeof Type.Integer>,
>(
	value: T,
) => Type.Union([value, Type.Null()]);
const text = nullable(Type.String());
const integer = nullable(Type.Integer({ minimum: 0 }));
const entry = Type.Object({
	id: Type.Integer({ minimum: 1 }),
	userId: Type.Integer({ minimum: 1 }),
	mediaId: Type.Integer({ minimum: 1 }),
	progress: Type.Integer({ minimum: 0 }),
	status: Type.Union([
		Type.Literal("CURRENT"),
		Type.Literal("PLANNING"),
		Type.Literal("COMPLETED"),
		Type.Literal("PAUSED"),
		Type.Literal("DROPPED"),
		Type.Literal("REPEATING"),
	]),
	updatedAt: Type.Integer({ minimum: 0 }),
	media: Type.Object({
		id: Type.Integer({ minimum: 1 }),
		type: Type.Literal("ANIME"),
		title: Type.Object({ romaji: text, english: text, native: text }),
		synonyms: Type.Array(Type.String()),
		format: text,
		startDate: Type.Object({ year: integer }),
		seasonYear: integer,
		episodes: integer,
		coverImage: Type.Object({ large: text }),
	}),
});
const chunk = Type.Object({
	MediaListCollection: Type.Object({
		hasNextChunk: Type.Boolean(),
		lists: Type.Array(Type.Object({ entries: Type.Array(entry) })),
	}),
});
const query = `query AccountAnimeLists($userId: Int!, $chunk: Int!) { MediaListCollection(userId: $userId, type: ANIME, chunk: $chunk, perChunk: 100, sort: MEDIA_ID) { hasNextChunk lists { entries { id userId mediaId progress status updatedAt media { id type title { romaji english native } synonyms format startDate { year } seasonYear episodes coverImage { large } } } } } }`;
function invalid(): never {
	throw new AniListError({
		code: "invalid-response",
		message: "AniList returned incomplete or inconsistent list data.",
		retryAt: null,
	});
}
function cover(value: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			url.hostname === "s4.anilist.co"
			? url.href
			: null;
	} catch {
		return null;
	}
}
/** Provider-specific decoding only; no credentials, cache or Catalog ownership. */
export class AniListListsClient implements AniListListsApi {
	constructor(private readonly client: AniListClient) {}
	async read(
		accountId: number,
		token: string,
		signal: AbortSignal,
	): Promise<AniListListEntry[]> {
		const entries = new Map<number, AniListListEntry>();
		for (let page = 1; page <= 1000; page++) {
			signal.throwIfAborted();
			const raw = await withAniList(this.client, { signal, token }, (sdk) =>
				sdk.graphql.request(query, { userId: accountId, chunk: page }),
			);
			if (!Check(chunk, raw)) invalid();
			let added = 0;
			for (const group of raw.MediaListCollection.lists)
				for (const value of group.entries) {
					if (value.userId !== accountId || value.mediaId !== value.media.id)
						invalid();
					const titles = [
						...new Set(
							[
								value.media.title.romaji,
								value.media.title.english,
								value.media.title.native,
								...value.media.synonyms,
							].filter((title): title is string => Boolean(title?.trim())),
						),
					];
					if (!titles.length) invalid();
					const item: AniListListEntry = {
						id: value.id,
						mediaId: value.mediaId,
						progress: value.progress,
						status: value.status,
						updatedAt: value.updatedAt,
						titles,
						format: value.media.format,
						year: value.media.startDate.year ?? value.media.seasonYear,
						episodeCount: value.media.episodes,
						coverUrl: cover(value.media.coverImage.large),
					};
					const previous = entries.get(item.mediaId);
					if (previous && JSON.stringify(previous) !== JSON.stringify(item))
						invalid();
					if (!previous) {
						entries.set(item.mediaId, item);
						added++;
					}
				}
			// The upstream collection silently caps results at 11,000 unique entries.
			if (entries.size >= 11_000) invalid();
			if (!raw.MediaListCollection.hasNextChunk) return [...entries.values()];
			if (!added) invalid();
		}
		invalid();
	}
}
