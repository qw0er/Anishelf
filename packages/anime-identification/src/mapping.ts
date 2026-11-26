import { identificationDefaults } from "./defaults.ts";
import type {
	ExtractionEvidence,
	MappingProposal,
	WorkCandidate,
} from "./model.ts";

export function proposeMapping(
	evidence: Pick<
		ExtractionEvidence,
		"contentKind" | "numbering" | "rawEpisodes" | "selectedEpisodes"
	>,
	work: Pick<WorkCandidate, "format" | "episodeCount">,
): MappingProposal {
	const episodes = evidence.selectedEpisodes ?? evidence.rawEpisodes;
	const result: MappingProposal = {
		targets: [],
		reasons: [],
		unresolved: [],
	};
	if (evidence.contentKind === "ancillary")
		result.unresolved.push(
			"Credits, trailers and ancillary resources require explicit review.",
		);
	else if (work.format === "MOVIE" && !evidence.rawEpisodes.length) {
		result.targets = [{ kind: "movie", number: "whole" }];
		result.reasons.push("Selected movie uses a whole-work playback slot.");
	} else if (evidence.contentKind === "special")
		result.unresolved.push("Confirm an explicit special identity and label.");
	else if (evidence.numbering === "ambiguous")
		result.unresolved.push(
			"Multiple numbering systems or tokens require an explicit choice.",
		);
	else if (!evidence.rawEpisodes.length)
		result.unresolved.push("Episode numbering is unknown.");
	else if (evidence.rawEpisodes.some((token) => !/^\d+$/.test(token)))
		result.unresolved.push(
			"Non-integer episode identifiers require an explicit correction.",
		);
	else if (episodes.length === 1 && Number(episodes[0]) === 0) {
		result.targets = [{ kind: "special", number: "0" }];
		result.unresolved.push(
			"Episode zero requires an explicit special identity and label, or selection of its separate provider work.",
		);
	} else {
		const numbers = episodes.map(Number);
		const start = numbers[0] ?? 0;
		const end = numbers.at(-1) ?? start;
		if (
			start < 1 ||
			end < start ||
			end > identificationDefaults.maximumEpisode ||
			end - start >= identificationDefaults.maximumRange
		)
			result.unresolved.push(
				"The episode range is descending, invalid or too large.",
			);
		else if (work.format === "MOVIE")
			result.unresolved.push(
				"Numbered movie resources require an explicit whole-work mapping.",
			);
		else if (work.episodeCount !== null && end > work.episodeCount)
			result.unresolved.push(
				"Release numbering exceeds the known count; preview an explicit offset or correct it.",
			);
		else {
			result.targets = Array.from({ length: end - start + 1 }, (_, i) => ({
				kind: "regular",
				number: String(start + i),
			}));
			result.reasons.push(
				evidence.numbering === "range"
					? "Leaf filename contains a bounded contiguous range; no seek boundaries are implied."
					: "Leaf filename supplies the regular episode number.",
			);
			if (work.episodeCount === null)
				result.reasons.push("Total episode count remains unknown.");
		}
	}
	return result;
}

/** Preview accepts the original episode numbers and applies the offset itself. */
export function mappingSelection(
	mapping: Pick<MappingProposal, "targets" | "numbering">,
) {
	const offset = mapping.numbering?.offset ?? 0;
	return {
		offset,
		targets: offset
			? mapping.targets.map((target) =>
					target.kind === "regular"
						? { ...target, number: String(Number(target.number) - offset) }
						: target,
				)
			: mapping.targets,
	};
}
