import { Type } from "typebox";
import { Check } from "typebox/value";
import { type AniListClient, AniListError } from "../domain/model.js";
import type { AniListAccount, AniListAccountApi } from "../domain/provider.js";

const viewerSchema = Type.Object({
	Viewer: Type.Object({
		id: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
		name: Type.String({ minLength: 1, maxLength: 256 }),
	}),
});
export class AniListAccountClient implements AniListAccountApi {
	constructor(private readonly client: AniListClient) {}
	async viewer(token: string, signal: AbortSignal): Promise<AniListAccount> {
		const raw = await this.client.request(
			"query ConnectedAniListAccount { Viewer { id name } }",
			{},
			{ token, signal, priority: true },
		);
		if (!Check(viewerSchema, raw))
			throw new AniListError({
				code: "invalid-response",
				message: "AniList returned an invalid account.",
				retryAt: null,
			});
		return { id: raw.Viewer.id, name: raw.Viewer.name };
	}
}
