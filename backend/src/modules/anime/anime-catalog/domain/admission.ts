import { matchingTitle } from "../../identification/public.js";
import { catalogPolicy } from "../policy.js";
import type { ReviewRecord } from "./model.js";

/** The same diagnosis powers admission, Review and offline evaluation. */
export function automaticBlockers(item: ReviewRecord): string[] {
	const blockers: string[] = [];
	const best = item.proposals[0];
	const next = item.proposals[1];
	if (item.decision !== "pending")
		blockers.push("An existing user decision prevents automatic admission.");
	if (!item.available) blockers.push("The source is unavailable.");
	if (item.metadataStatus !== "searched")
		blockers.push("Metadata search is incomplete or unavailable.");
	if (!best) return [...blockers, "No candidate."];
	if (best.candidate.score < catalogPolicy.automaticMinimumScore)
		blockers.push("Ranking score below admission minimum.");
	if (
		next &&
		best.candidate.score - next.candidate.score <
			catalogPolicy.automaticMinimumMargin
	)
		blockers.push("Insufficient ranking margin.");
	blockers.push(...best.candidate.conflicts, ...best.mapping.unresolved);
	if (!best.mapping.targets.length)
		blockers.push("No explicit target mapping is available.");
	if (
		item.evidence.contentKind === "special" ||
		item.evidence.contentKind === "ancillary"
	)
		blockers.push("Special or ancillary content requires explicit review.");
	if (
		!item.evidence.titles.some((title) =>
			best.candidate.work.titles.some((alias) =>
				matchingTitle(title, alias, item.evidence.seasons, item.evidence.parts),
			),
		)
	)
		blockers.push("No exact title match for admission.");
	return [...new Set(blockers)];
}

/** Catalog owns admission; external search ranking alone is not a successful match. */
export function automaticProposal(
	item: ReviewRecord,
): ReviewRecord["proposals"][number] | null {
	return automaticBlockers(item).length ? null : (item.proposals[0] ?? null);
}
