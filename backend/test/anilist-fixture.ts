import { Anilist } from "@api-wrappers/anilist-wrapper";
import { AniListAccountClient as AccountClient } from "../src/modules/anime/anilist/infrastructure/account-client.js";
import { AniListListsClient as ListsClient } from "../src/modules/anime/anilist/infrastructure/lists-client.js";
import { AniListUpdatesClient as UpdatesClient } from "../src/modules/anime/anilist/infrastructure/updates-client.js";
import type {
	AniListRequestOptions,
	AniListClient as SdkClient,
} from "../src/modules/anime/anilist/public.js";
import { createAniListTracking as createTracking } from "../src/modules/anime/integration/anilist.js";

/** In-memory GraphQL fixture adapter. Production always uses the SDK transport. */
export interface AniListClient {
	request(
		query: string,
		variables: Record<string, unknown>,
		options: AniListRequestOptions,
	): Promise<unknown>;
}
function fixture(client: AniListClient): SdkClient {
	return {
		async execute(options, operation) {
			let failure: { error: unknown } | undefined;
			const sdk = new Anilist({
				core: {
					retry: { maxAttempts: 1 },
					transport: {
						async execute(ctx) {
							const body = ctx.body as {
								query: string;
								variables?: Record<string, unknown>;
							};
							try {
								return Response.json({
									data: await client.request(
										body.query,
										body.variables ?? {},
										options,
									),
								});
							} catch (error) {
								failure = { error };
								throw error;
							}
						},
					},
				},
			});
			try {
				return await operation(sdk);
			} catch (error) {
				if (failure) throw failure.error;
				throw error;
			}
		},
	};
}
export class AniListAccountClient extends AccountClient {
	constructor(client: AniListClient) {
		super(fixture(client));
	}
}
export class AniListUpdatesClient extends UpdatesClient {
	constructor(client: AniListClient) {
		super(fixture(client));
	}
}
export function createAniListTracking(client: AniListClient) {
	return createTracking(fixture(client));
}

export class AniListListsClient extends ListsClient {
	constructor(client: AniListClient) {
		super(fixture(client));
	}
}
