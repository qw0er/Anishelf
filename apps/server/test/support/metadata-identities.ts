import type { MetadataIdentitiesApi } from "../../src/modules/anime/external-works/metadata/identities.js";
/** Explicit identity bridge for isolated tests without the Metadata repository. */
export function fixtureIdentities(provider = "fixture"): MetadataIdentitiesApi {
	return {
		referenceForExternal: (reference) => ({ id: reference.id }),
		externalReference: (reference, requested) =>
			requested && requested !== provider
				? null
				: { provider, mediaType: "anime", id: reference.id },
	};
}
