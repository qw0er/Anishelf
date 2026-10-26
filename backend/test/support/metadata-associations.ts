import type { MetadataAssociations } from "../../src/modules/anime/metadata/associations.js";
/** Explicit identity bridge for isolated tests without the Metadata repository. */
export function fixtureAssociations(
	provider = "fixture",
): MetadataAssociations {
	return {
		referenceForExternal: (reference) => ({ id: reference.id }),
		externalReference: (reference, requested) =>
			requested && requested !== provider
				? null
				: { provider, mediaType: "anime", id: reference.id },
	};
}
