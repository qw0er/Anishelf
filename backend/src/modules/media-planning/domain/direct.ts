import type {
	CompatibilityEvidence,
	CompatibilityResult,
} from "../../../shared/media-negotiation.js";
import { aggregateCompatibility, compatibilityDecision } from "./evidence.js";
import type { OriginalMediaDescription } from "./model.js";

export function checkDirectCompatibility(
	description: OriginalMediaDescription,
	evidence: CompatibilityEvidence[],
): CompatibilityResult["direct"] {
	const decision = (id: string) =>
		compatibilityDecision(description.queries, evidence, id);
	let direct = aggregateCompatibility(
		description.queries
			.filter((query) => /^original(-\d+)?$/.test(query.id))
			.map((query) => decision(query.id)),
	);
	if (decision("original-container").status === "unsupported")
		direct = { status: "unsupported", reason: "container-rejected" };
	if (!description.video)
		direct = { status: "unsupported", reason: "no-video-stream" };
	if (description.multipleTracks && direct.status === "supported")
		direct = { status: "unknown", reason: "native-track-selection-uncertain" };
	if (description.video?.hdr && direct.status === "supported")
		direct = { status: "unknown", reason: "hdr-display-unverified" };
	return direct;
}
