import { Type } from "typebox";
import { Check } from "typebox/value";
import { type AniListClient, AniListError } from "../domain/model.js";
import type {
	AniListDesiredState,
	AniListRemoteState,
	AniListUpdateApi,
} from "../domain/provider.js";

const fields = "id userId mediaId progress status updatedAt media { type }";
const state = Type.Object({
	id: Type.Integer({ minimum: 1 }),
	userId: Type.Integer({ minimum: 1 }),
	mediaId: Type.Integer({ minimum: 1 }),
	progress: Type.Integer({ minimum: 0 }),
	updatedAt: Type.Integer({ minimum: 0 }),
	status: Type.Union([
		Type.Literal("CURRENT"),
		Type.Literal("PLANNING"),
		Type.Literal("COMPLETED"),
		Type.Literal("PAUSED"),
		Type.Literal("DROPPED"),
		Type.Literal("REPEATING"),
	]),
	media: Type.Object({ type: Type.Literal("ANIME") }),
});
function decode(
	raw: unknown,
	accountId: number,
	mediaId: number,
): AniListRemoteState {
	if (!Check(state, raw) || raw.userId !== accountId || raw.mediaId !== mediaId)
		throw new AniListError({
			code: "invalid-response",
			message: "AniList returned inconsistent viewing state.",
			retryAt: null,
		});
	return {
		id: raw.id,
		progress: raw.progress,
		status: raw.status,
		updatedAt: raw.updatedAt,
	};
}
export class AniListUpdatesClient implements AniListUpdateApi {
	constructor(private readonly client: AniListClient) {}
	async get(
		accountId: number,
		mediaId: number,
		token: string,
		signal: AbortSignal,
	): Promise<AniListRemoteState | null> {
		try {
			const raw = await this.client.execute({ token, signal }, (sdk) =>
				sdk.graphql.request(
					`query TrackingEntry($userId: Int!, $mediaId: Int!) { MediaList(userId: $userId, mediaId: $mediaId, type: ANIME) { ${fields} } }`,
					{ userId: accountId, mediaId },
				),
			);
			if (typeof raw !== "object" || raw === null || !("MediaList" in raw))
				return decode(raw, accountId, mediaId);
			return raw.MediaList === null
				? null
				: decode(raw.MediaList, accountId, mediaId);
		} catch (error) {
			if (error instanceof AniListError && error.failure.code === "not-found")
				return null;
			throw error;
		}
	}
	async save(
		accountId: number,
		mediaId: number,
		entryId: number | null,
		desired: AniListDesiredState,
		token: string,
		signal: AbortSignal,
	): Promise<AniListRemoteState> {
		if (entryId === null) {
			const target = await this.client.execute({ token, signal }, (sdk) =>
				sdk.graphql.request(
					"query TrackingTarget($id: Int!) { Media(id: $id, type: ANIME) { id type } }",
					{ id: mediaId },
				),
			);
			const schema = Type.Object({
				Media: Type.Object({ id: Type.Integer(), type: Type.Literal("ANIME") }),
			});
			if (!Check(schema, target) || target.Media.id !== mediaId)
				throw new AniListError({
					code: "invalid-request",
					message: "Select a valid anime target.",
					retryAt: null,
				});
		}
		const raw = await this.client.execute({ token, signal }, (sdk) =>
			sdk.mediaList.saveEntry(
				{ ...(entryId === null ? { mediaId } : { id: entryId }), ...desired },
				{
					select: {
						mediaList: {
							id: true,
							userId: true,
							mediaId: true,
							progress: true,
							status: true,
							updatedAt: true,
							media: { type: true },
						},
					},
				},
			),
		);
		return decode(raw.mediaList, accountId, mediaId);
	}
}
