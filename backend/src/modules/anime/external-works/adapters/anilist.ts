import { AniListAccountClient } from "../anilist/infrastructure/account-client.js";
import { AniListListsClient } from "../anilist/infrastructure/lists-client.js";
import { AniListMetadataClient } from "../anilist/infrastructure/metadata-client.js";
import { AniListUpdatesClient } from "../anilist/infrastructure/updates-client.js";
import type { AniListClient } from "../anilist/public.js";
import { AniListProvider } from "../metadata/infrastructure/anilist.js";
import { AniListAccountProvider } from "../tracking/infrastructure/account-provider.js";
import { AniListListProvider } from "../tracking/infrastructure/list-provider.js";
import { aniListTracking } from "../tracking/infrastructure/provider-mapping.js";
import { AniListUpdateProvider } from "../tracking/infrastructure/update-provider.js";
export function createAniListTracking(client: AniListClient) {
	return {
		descriptor: aniListTracking,
		accountProvider: new AniListAccountProvider(
			new AniListAccountClient(client),
		),
		listProvider: new AniListListProvider(new AniListListsClient(client)),
		updateProvider: new AniListUpdateProvider(new AniListUpdatesClient(client)),
	};
}

export function createAniListMetadata(client: AniListClient) {
	return {
		providers: [new AniListProvider(new AniListMetadataClient(client))],
		defaultProvider: "anilist",
		artworkHosts: ["s4.anilist.co"],
	};
}
