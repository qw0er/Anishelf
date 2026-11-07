import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
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
export type ReportedCorpus = Static<typeof schema>;

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
