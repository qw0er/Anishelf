import { catalogPolicy } from "../policy.js";
import type { ReviewRecord } from "./model.js";

const normalized = (value: string) =>
	value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
/** Catalog owns admission; an external search ranking alone is not a successful match. */
export function automaticProposal(
	item: ReviewRecord,
): ReviewRecord["proposals"][number] | null {
	const best = item.proposals[0];
	const next = item.proposals[1];
	if (
		item.decision !== "pending" ||
		!item.available ||
		item.metadataStatus !== "searched" ||
		!best
	)
		return null;
	if (
		best.candidate.score < catalogPolicy.automaticMinimumScore ||
		(next &&
			best.candidate.score - next.candidate.score <
				catalogPolicy.automaticMinimumMargin)
	)
		return null;
	if (
		best.candidate.conflicts.length ||
		best.mapping.unresolved.length ||
		!best.mapping.targets.length
	)
		return null;
	if (
		item.evidence.contentKind === "special" ||
		item.evidence.contentKind === "ancillary"
	)
		return null;
	if (
		!item.evidence.titles.some((title) =>
			best.candidate.work.titles.some(
				(alias) => normalized(title) && normalized(title) === normalized(alias),
			),
		)
	)
		return null;
	return best;
}
