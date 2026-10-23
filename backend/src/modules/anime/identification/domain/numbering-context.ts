import { proposeMapping } from "./mapping.js";
import { rankCandidates } from "./matching.js";
import type { IdentificationResult, WorkCandidate } from "./model.js";
import { matchingTitle } from "./title-evidence.js";

function scope(result: IdentificationResult, work: WorkCandidate) {
	const seasons = [...new Set(result.evidence.seasons.map(Number))];
	if (
		seasons.length !== 1 ||
		!Number.isSafeInteger(seasons[0]) ||
		(seasons[0] ?? 0) < 1
	)
		return null;
	const path = result.source.relativePath;
	return JSON.stringify([
		result.source.scopeId,
		path.slice(0, path.lastIndexOf("/") + 1),
		seasons[0],
		work.reference,
	]);
}

function leafMatches(result: IdentificationResult, work: WorkCandidate) {
	const leaf = result.evidence.inputs
		.find((input) => input.mode === "basename")
		?.elements.find((element) => element.kind === "title")?.value;
	return Boolean(
		leaf &&
			work.titles.some((alias) =>
				matchingTitle(
					leaf,
					alias,
					result.evidence.seasons,
					result.evidence.parts,
				),
			),
	);
}

/** Publication-local rules corroborated by explicit local numbers, never relation order. */
export function applyNumberingContext(results: IdentificationResult[]): void {
	const anchors = new Map<
		string,
		{
			offset: number;
			continuous: number;
			fileId: string;
			sourceVersion: string;
		}[]
	>();
	for (const result of results) {
		const { evidence } = result;
		if (
			evidence.rawEpisodes.length !== 2 ||
			evidence.numbering !== "single" ||
			evidence.selectedEpisodes?.length !== 1 ||
			evidence.contentKind !== "regular" ||
			result.metadataStatus !== "searched"
		)
			continue;
		const continuous = Number(evidence.rawEpisodes[0]);
		const local = Number(evidence.selectedEpisodes[0]);
		if (
			!Number.isSafeInteger(continuous) ||
			!Number.isSafeInteger(local) ||
			local < 1 ||
			continuous < local
		)
			continue;
		const eligible = result.proposals.filter(
			({ candidate, mapping }) =>
				!candidate.conflicts.length &&
				!mapping.unresolved.length &&
				mapping.targets.length &&
				evidence.titles.some((title) =>
					candidate.work.titles.some((alias) =>
						matchingTitle(title, alias, evidence.seasons, evidence.parts),
					),
				),
		);
		if (eligible.length !== 1) continue;
		const proposal = eligible[0];
		if (
			!proposal ||
			proposal !== result.proposals[0] ||
			!leafMatches(result, proposal.candidate.work)
		)
			continue;
		const key = scope(result, proposal.candidate.work);
		if (!key) continue;
		const values = anchors.get(key) ?? [];
		values.push({
			offset: local - continuous,
			continuous,
			fileId: result.source.fileId,
			sourceVersion: result.source.sourceVersion,
		});
		anchors.set(key, values);
	}
	for (const result of results) {
		const { evidence } = result;
		if (
			evidence.rawEpisodes.length !== 1 ||
			evidence.numbering !== "single" ||
			evidence.contentKind !== "regular"
		)
			continue;
		const raw = Number(evidence.rawEpisodes[0]);
		if (!Number.isSafeInteger(raw) || raw < 1) continue;
		result.proposals = result.proposals
			.map((proposal) => {
				if (!leafMatches(result, proposal.candidate.work)) return proposal;
				const key = scope(result, proposal.candidate.work);
				const values = key ? anchors.get(key) : undefined;
				if (
					!values ||
					values.length < 2 ||
					new Set(values.map((anchor) => anchor.continuous)).size < 2 ||
					new Set(values.map((anchor) => anchor.offset)).size !== 1
				)
					return proposal;
				const offset = values[0]?.offset ?? 0;
				// A valid local number needs no conversion. Require an out-of-scope source number.
				const count = proposal.candidate.work.episodeCount;
				if (count === null || offset === 0) return proposal;
				const adjusted = {
					...evidence,
					selectedEpisodes: [String(raw + offset)],
				};
				const candidate = rankCandidates(adjusted, [
					proposal.candidate.work,
				])[0];
				if (!candidate || candidate.conflicts.length) return proposal;
				const mapping = proposeMapping(adjusted, candidate.work);
				if (mapping.unresolved.length || !mapping.targets.length)
					return proposal;
				mapping.numbering = {
					source: "directory-anchors",
					offset,
					anchors: values.map(({ fileId, sourceVersion }) => ({
						fileId,
						sourceVersion,
					})),
				};
				mapping.reasons = [
					"Other files in this directory explicitly pair release numbers with season-local numbers; the pairs agree on this conversion.",
				];
				if (raw <= count)
					mapping.unresolved.push(
						"Both release and converted numbering are within this work's scope; confirm the numbering system explicitly.",
					);
				return { candidate, mapping };
			})
			.sort(
				(a, b) =>
					b.candidate.score - a.candidate.score ||
					JSON.stringify(a.candidate.work.reference).localeCompare(
						JSON.stringify(b.candidate.work.reference),
					),
			);
	}
}
