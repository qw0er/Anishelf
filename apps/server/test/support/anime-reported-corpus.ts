import {
	automaticBlockers,
	automaticProposal,
} from "../../src/modules/anime/anime-catalog/domain/admission.js";
import type { ReviewRecord } from "../../src/modules/anime/anime-catalog/domain/model.js";
import { IdentificationApplication } from "../../src/modules/anime/identification/application/identification.js";
import { AnitomyIdentificationParser } from "../../src/modules/anime/identification/infrastructure/parser.js";
import type { WorkCandidate } from "../../src/modules/anime/identification/public.js";
import type { ReportedCorpus } from "./anime-reported-cases.js";

export async function evaluateReportedCorpus(corpus: ReportedCorpus) {
	const rows = [];
	for (const scenario of corpus.scenarios) {
		const works: WorkCandidate[] = scenario.candidates.map((candidate) => ({
			reference: { id: candidate.id },
			snapshotId: `reported:${corpus.version}:${scenario.id}`,
			titles: candidate.titles,
			titleVariants: candidate.titles.map((value) => ({
				value,
				kind: "primary",
				language: null,
			})),
			year: candidate.year,
			format: candidate.format,
			episodeCount: null,
			season: null,
			part: null,
		}));
		const queries: string[] = [];
		const engine = new IdentificationApplication({
			parser: new AnitomyIdentificationParser(),
			metadata: {
				search: async (query) => {
					queries.push(query);
					return works;
				},
			},
		});
		const results = await engine.identify(
			scenario.files.map((file) => ({
				scopeId: "/reported-corpus",
				fileId: file.id,
				sourceVersion: corpus.version,
				relativePath: `${scenario.directory}/${file.name}`,
			})),
		);
		for (const [index, result] of results.entries()) {
			const file = scenario.files[index];
			if (!file) throw new Error("Missing reported corpus input.");
			const record: ReviewRecord = {
				...result,
				id: file.id,
				sourceId: file.id,
				rootId: "reported-corpus",
				fileId: file.id,
				relativePath: result.source.relativePath,
				scopeId: result.source.scopeId,
				sourceVersion: corpus.version,
				available: true,
				revision: 1,
				decision: "pending",
				reason: null,
			};
			const proposal = automaticProposal(record);
			const expectedTargets = [
				{ kind: "regular", number: String(file.expected.episode) },
			];
			rows.push({
				id: `${scenario.id}:${file.id}`,
				relativePath: result.source.relativePath,
				expected: file.expected,
				passed:
					proposal?.candidate.work.reference.id === file.expected.workId &&
					JSON.stringify(proposal.mapping.targets) ===
						JSON.stringify(expectedTargets) &&
					JSON.stringify(result.evidence.seasons) ===
						JSON.stringify([String(file.expected.season)]),
				admittedWorkId: proposal?.candidate.work.reference.id ?? null,
				targets: proposal?.mapping.targets ?? [],
				seasons: result.evidence.seasons,
				blockers: automaticBlockers(record),
				assumptions: proposal?.candidate.assumptions ?? [],
				queries: [...queries],
			});
		}
	}
	return {
		version: corpus.version,
		scenarios: corpus.scenarios.length,
		total: rows.length,
		passed: rows.filter((row) => row.passed).length,
		rows,
	};
}
