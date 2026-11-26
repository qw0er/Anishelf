import {
	mappingSelection,
	proposeMapping,
} from "@anishelf/anime-identification/mapping";
import type { CatalogReviewItem } from "../../../shared/api/contracts.js";

/** Candidate-specific suggestions; submitting still requires preview and confirmation. */
export function mappingDefaults(
	item: CatalogReviewItem,
	reference: { id: string },
	format: string | null,
	episodeCount: number | null,
) {
	const sameReference = (value?: { id: string }) => value?.id === reference.id;
	const existing = item.associations.filter((link) =>
		sameReference(link.reference),
	);
	const proposal = item.proposals.find(({ candidate }) =>
		sameReference(candidate.work.reference),
	);
	const suggested = mappingSelection(
		proposal?.mapping.targets.length
			? proposal.mapping
			: proposeMapping(item.evidence, { format, episodeCount }),
	);
	const parsedEpisodes =
		item.evidence.selectedEpisodes ?? item.evidence.rawEpisodes;
	const zero = parsedEpisodes.length === 1 && Number(parsedEpisodes[0]) === 0;
	const kind =
		existing[0]?.kind ??
		(format === "MOVIE"
			? "movie"
			: (suggested.targets[0]?.kind ?? (zero ? "special" : "regular")));
	const numbers = existing.length
		? existing.map((link) => link.number)
		: kind === "movie"
			? ["whole"]
			: suggested.targets.map((target) => target.number);
	return {
		kind,
		numbers: numbers.join(", ") || (zero ? "0" : ""),
		offset: existing.length ? 0 : suggested.offset,
		label: existing[0]?.kind === "special" ? existing[0].label : "",
		reasons: proposal
			? [...proposal.candidate.conflicts, ...proposal.mapping.unresolved]
			: item.unresolved,
		mappingReasons: proposal?.mapping.reasons ?? [],
	};
}
