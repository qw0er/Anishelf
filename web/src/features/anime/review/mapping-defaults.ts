import type { CatalogReviewItem } from "../../../shared/api/contracts.js";

/** Candidate-specific suggestions; submitting still requires preview and confirmation. */
export function mappingDefaults(
	item: CatalogReviewItem,
	reference: { provider?: string; id: string },
	format: string | null,
	count: number | null,
) {
	const sameReference = (value?: { provider?: string; id: string }) =>
		value?.provider === reference.provider && value?.id === reference.id;
	const existing = item.associations.filter((link) =>
		sameReference(link.reference),
	);
	const proposal = item.proposals.find(({ candidate }) =>
		sameReference(candidate.work.reference),
	);
	const suggested = proposal?.mapping.targets ?? [];
	const zero =
		(item.evidence.selectedEpisodes ?? item.evidence.rawEpisodes).length ===
			1 &&
		Number((item.evidence.selectedEpisodes ?? item.evidence.rawEpisodes)[0]) ===
			0;
	const kind =
		existing[0]?.kind ??
		(format === "MOVIE"
			? "movie"
			: (suggested[0]?.kind ?? (zero ? "special" : "regular")));
	const offset = !existing.length
		? (proposal?.mapping.numbering?.offset ?? 0)
		: 0;
	let numbers = existing.length
		? existing.map((link) => link.number)
		: kind === "movie"
			? ["whole"]
			: suggested.map((target) =>
					target.kind === "regular"
						? String(Number(target.number) - offset)
						: target.number,
				);
	if (!numbers.length && zero) numbers = ["0"];
	// Manual provider lookup may have no stored proposal. Use only bounded parsed numbers.
	if (!numbers.length && item.evidence.numbering !== "ambiguous") {
		const parsed = (
			item.evidence.selectedEpisodes ?? item.evidence.rawEpisodes
		).map(Number);
		if (
			parsed.length &&
			parsed.every(
				(value) =>
					Number.isSafeInteger(value) &&
					value > 0 &&
					value <= 10000 &&
					(count === null || value <= count),
			)
		) {
			const first = parsed[0] ?? 0;
			const last = parsed.at(-1) ?? first;
			if (last >= first && last - first < 100)
				numbers =
					item.evidence.numbering === "range"
						? Array.from({ length: last - first + 1 }, (_, index) =>
								String(first + index),
							)
						: parsed.map(String);
		}
	}
	return {
		kind,
		numbers: numbers.join(", "),
		offset,
		label: existing[0]?.kind === "special" ? existing[0].label : "",
		reasons: proposal
			? [...proposal.candidate.conflicts, ...proposal.mapping.unresolved]
			: item.unresolved,
		mappingReasons: proposal?.mapping.reasons ?? [],
	};
}
