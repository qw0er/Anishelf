import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import {
	automaticBlockers,
	automaticProposal,
} from "../../src/modules/anime/anime-catalog/domain/admission.js";
import type { ReviewRecord } from "../../src/modules/anime/anime-catalog/domain/model.js";
import { IdentificationApplication } from "../../src/modules/anime/identification/application/identification.js";
import { AnitomyIdentificationParser } from "../../src/modules/anime/identification/infrastructure/parser.js";
import type { WorkCandidate } from "../../src/modules/anime/identification/public.js";
import { corpusDirectory, validateResourcePath } from "./anime-corpus.js";

const text = Type.String({ minLength: 1 });
const id = Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$" });
const positive = Type.Integer({ minimum: 1 });
const schema = Type.Object({
	schemaVersion: Type.Literal(1),
	version: text,
	scenarios: Type.Array(
		Type.Object({
			id,
			reportedAt: text,
			provenance: Type.Object({
				kind: Type.Literal("user-report"),
				note: text,
			}),
			directory: text,
			candidates: Type.Array(
				Type.Object({
					id,
					titles: Type.Array(text, { minItems: 1 }),
					year: Type.Union([Type.Integer(), Type.Null()]),
					format: Type.Union([text, Type.Null()]),
				}),
				{ minItems: 1 },
			),
			files: Type.Array(
				Type.Object({
					id,
					name: text,
					expected: Type.Object({
						workId: id,
						season: positive,
						episode: positive,
					}),
				}),
				{ minItems: 1 },
			),
		}),
		{ minItems: 1 },
	),
});
type ReportedCorpus = Static<typeof schema>;

/** Screenshot-only reproductions never fabricate provider IDs or episode catalogs. */
export async function loadReportedCorpus(): Promise<ReportedCorpus> {
	const value: unknown = JSON.parse(
		await readFile(join(corpusDirectory, "reported-cases.json"), "utf8"),
	);
	if (!Check(schema, value)) throw new Error("Invalid reported anime corpus.");
	const unique = (values: string[]) => {
		if (new Set(values).size !== values.length)
			throw new Error("Duplicate reported corpus identity or path.");
	};
	unique(value.scenarios.map((scenario) => scenario.id));
	for (const scenario of value.scenarios) {
		validateResourcePath(scenario.directory);
		unique(scenario.candidates.map((candidate) => candidate.id));
		unique(scenario.files.map((file) => file.id));
		unique(scenario.files.map((file) => file.name.normalize("NFD")));
		for (const file of scenario.files) {
			validateResourcePath(file.name);
			if (
				file.name.includes("/") ||
				!scenario.candidates.some(
					(candidate) => candidate.id === file.expected.workId,
				)
			)
				throw new Error(`Invalid reported file ${scenario.id}:${file.id}.`);
		}
	}
	return value;
}

export function reportedResources(corpus: ReportedCorpus) {
	return corpus.scenarios.flatMap((scenario) =>
		scenario.files.map((file) => ({
			id: `${scenario.id}:${file.id}`,
			path: `reported/${scenario.id}/${scenario.directory}/${file.name}`,
		})),
	);
}

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
