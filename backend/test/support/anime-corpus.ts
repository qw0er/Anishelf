import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const text = Type.String({ minLength: 1 });
const nullableText = Type.Union([text, Type.Null()]);
const numbers = Type.Array(Type.Number({ minimum: 0 }));
const parsedSchema = Type.Object(
	{
		rawEpisodes: Type.Optional(numbers),
		season: Type.Optional(
			Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
		),
		revision: Type.Optional(Type.Integer({ minimum: 1 })),
		contentType: Type.Optional(
			Type.Union([
				Type.Literal("regular"),
				Type.Literal("special"),
				Type.Literal("movie"),
				Type.Literal("credit"),
				Type.Literal("trailer"),
				Type.Literal("unknown"),
			]),
		),
	},
	{ additionalProperties: false },
);
const decisionSchema = Type.Union([
	Type.Literal("match"),
	Type.Literal("review"),
	Type.Literal("unidentified"),
	Type.Literal("ignore"),
]);
const resultSchema = Type.Object({
	decision: decisionSchema,
	workId: nullableText,
	episodes: Type.Union([numbers, Type.Null()]),
	parsed: parsedSchema,
});
const caseSchema = Type.Object({
	id: text,
	input: Type.Union([
		Type.Object({ kind: Type.Literal("file"), relativePath: text }),
		Type.Object({ kind: Type.Literal("release-title"), text }),
	]),
	provenance: Type.Object({
		kind: Type.Union([
			Type.Literal("torrent-file"),
			Type.Literal("release-title"),
			Type.Literal("synthetic"),
		]),
		sourceId: nullableText,
		note: text,
	}),
	tags: Type.Array(text, { minItems: 1 }),
	requirements: Type.Array(text, { minItems: 1 }),
	expected: resultSchema,
	rationale: text,
});
const corpusSchema = Type.Object({
	schemaVersion: Type.Literal(1),
	version: text,
	collectedAt: text,
	works: Type.Array(Type.Object({ id: text, snapshot: text, title: text }), {
		minItems: 1,
	}),
	sources: Type.Array(
		Type.Object({
			id: text,
			site: Type.Union([
				Type.Literal("mikan"),
				Type.Literal("dmhy"),
				Type.Literal("nyaa"),
			]),
			url: text,
			title: text,
			metadataUrl: Type.Optional(text),
			metadataSha256: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
		}),
	),
	cases: Type.Array(caseSchema, { minItems: 1 }),
	scenarios: Type.Array(
		Type.Object({
			id: text,
			description: text,
			resources: Type.Array(Type.Object({ caseId: text, relativePath: text })),
			acceptance: Type.Array(text, { minItems: 1 }),
		}),
	),
});
export type AnimeCorpus = Static<typeof corpusSchema>;
export type AnimeCase = AnimeCorpus["cases"][number];
const predictionsSchema = Type.Object({
	corpusVersion: text,
	parserVersion: text,
	matcherVersion: text,
	results: Type.Array(
		Type.Intersect([
			resultSchema,
			Type.Object({
				id: text,
				candidateWorkIds: Type.Optional(Type.Array(text)),
			}),
		]),
	),
});
export type AnimePredictions = Static<typeof predictionsSchema>;
const snapshotSchema = Type.Object({
	schemaVersion: Type.Literal(1),
	workId: text,
	collectedAt: text,
	bangumi: Type.Object({
		id: Type.Integer({ minimum: 1 }),
		name: text,
		nameCn: Type.String(),
		date: nullableText,
		platform: text,
		aliases: Type.Array(Type.String()),
		regularEpisodeCount: Type.Integer({ minimum: 0 }),
		totalEpisodeCount: Type.Integer({ minimum: 0 }),
		episodeTotal: Type.Integer({ minimum: 0 }),
		episodes: Type.Array(
			Type.Object({
				id: Type.Integer({ minimum: 1 }),
				type: Type.Integer({ minimum: 0 }),
				sort: Type.Number({ minimum: 0 }),
			}),
		),
	}),
	anilist: Type.Object({
		id: Type.Integer({ minimum: 1 }),
		titles: Type.Object({
			native: nullableText,
			romaji: nullableText,
			english: nullableText,
		}),
		format: text,
		episodes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
		startDate: Type.Object({ year: Type.Union([Type.Integer(), Type.Null()]) }),
	}),
});
const nyaaCaptureSchema = Type.Object({
	schemaVersion: Type.Literal(1),
	collectedAt: text,
	releases: Type.Array(
		Type.Object({
			sourceId: text,
			title: text,
			detailUrl: text,
			torrentUrl: text,
			searches: Type.Array(text, { minItems: 1 }),
			metadata: Type.Object({
				sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
				name: text,
				fileCount: Type.Integer({ minimum: 1 }),
				totalBytes: Type.Integer({ minimum: 0 }),
				files: Type.Array(
					Type.Object({
						path: text,
						filename: text,
						bytes: Type.Integer({ minimum: 0 }),
						kind: Type.Union([
							Type.Literal("video"),
							Type.Literal("subtitle"),
							Type.Literal("other"),
						]),
					}),
				),
			}),
		}),
	),
});
export const corpusDirectory = fileURLToPath(
	new URL("../fixtures/anime-identification/", import.meta.url),
);

function unique(values: string[], label: string): void {
	if (new Set(values).size !== values.length)
		throw new Error(`Duplicate ${label}.`);
}
function safeId(value: string): void {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(value))
		throw new Error(`Unsafe fixture ID: ${value}`);
}
export function validateResourcePath(value: string): void {
	if (
		value.includes("\\") ||
		/^[a-z]:/i.test(value) ||
		value.split("/").some((part) => !part || part === "." || part === "..") ||
		Array.from(value).some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 32 || code === 127;
		})
	)
		throw new Error(`Unsafe fixture path: ${value}`);
}
export function validateCorpus(value: unknown): AnimeCorpus {
	if (!Check(corpusSchema, value))
		throw new Error("Invalid anime corpus schema.");
	const corpus = value;
	for (const [label, entries] of [
		["work", corpus.works],
		["source", corpus.sources],
		["case", corpus.cases],
		["scenario", corpus.scenarios],
	] as const) {
		unique(
			entries.map((entry) => entry.id),
			label,
		);
		for (const entry of entries) safeId(entry.id);
	}
	const works = new Set(corpus.works.map((work) => work.id));
	const sources = new Set(corpus.sources.map((source) => source.id));
	const cases = new Set(corpus.cases.map((entry) => entry.id));
	for (const work of corpus.works) validateResourcePath(work.snapshot);
	for (const entry of corpus.cases) {
		if (entry.input.kind === "file")
			validateResourcePath(entry.input.relativePath);
		if (entry.expected.workId && !works.has(entry.expected.workId))
			throw new Error(`Unknown work in ${entry.id}.`);
		if (entry.expected.decision === "match" && !entry.expected.workId)
			throw new Error(`Missing confirmed work in ${entry.id}.`);
		if (entry.provenance.kind !== "synthetic" && !entry.provenance.sourceId)
			throw new Error(`Missing source in ${entry.id}.`);
		if (entry.provenance.sourceId && !sources.has(entry.provenance.sourceId))
			throw new Error(`Unknown source in ${entry.id}.`);
	}
	for (const scenario of corpus.scenarios) {
		unique(
			scenario.resources.map((resource) =>
				resource.relativePath.normalize("NFD"),
			),
			`path in ${scenario.id}`,
		);
		for (const resource of scenario.resources) {
			validateResourcePath(resource.relativePath);
			const entry = corpus.cases.find((entry) => entry.id === resource.caseId);
			if (!cases.has(resource.caseId) || entry?.input.kind !== "file")
				throw new Error(`Unknown file case in ${scenario.id}.`);
		}
	}
	return corpus;
}
export function validateNyaaCapture(
	corpus: AnimeCorpus,
	capture: unknown,
): void {
	const nyaaSources = corpus.sources.filter((source) => source.site === "nyaa");
	if (
		!Check(nyaaCaptureSchema, capture) ||
		capture.collectedAt !== corpus.collectedAt
	)
		throw new Error("Invalid Nyaa capture schema or date.");
	unique(
		capture.releases.map((release) => release.sourceId),
		"Nyaa capture source",
	);
	const releases = new Map(
		capture.releases.map((release) => [release.sourceId, release]),
	);
	if (releases.size !== nyaaSources.length)
		throw new Error("Nyaa capture source count differs from corpus.");
	for (const source of nyaaSources) {
		const release = releases.get(source.id);
		if (
			!release ||
			release.title !== source.title ||
			release.detailUrl !== source.url ||
			release.torrentUrl !== source.metadataUrl ||
			release.metadata.sha256 !== source.metadataSha256 ||
			release.metadata.fileCount !== release.metadata.files.length ||
			release.metadata.totalBytes !==
				release.metadata.files.reduce((total, file) => total + file.bytes, 0)
		)
			throw new Error(`Nyaa capture differs from source ${source.id}.`);
	}
	for (const entry of corpus.cases) {
		const release = releases.get(entry.provenance.sourceId ?? "");
		if (!release) continue;
		const input = entry.input;
		if (
			input.kind === "file"
				? !release.metadata.files.some(
						(file) => file.path === input.relativePath,
					)
				: input.text !== release.title
		)
			throw new Error(`Nyaa input differs from capture in ${entry.id}.`);
	}
}

export async function loadCorpus(): Promise<AnimeCorpus> {
	const corpus = validateCorpus(
		JSON.parse(await readFile(join(corpusDirectory, "corpus.json"), "utf8")),
	);
	const snapshots = new Map<string, Static<typeof snapshotSchema>>();
	if (corpus.sources.some((source) => source.site === "nyaa"))
		validateNyaaCapture(
			corpus,
			JSON.parse(
				await readFile(join(corpusDirectory, "nyaa/releases.json"), "utf8"),
			),
		);
	for (const work of corpus.works) {
		const snapshot: unknown = JSON.parse(
			await readFile(join(corpusDirectory, work.snapshot), "utf8"),
		);
		if (
			!Check(snapshotSchema, snapshot) ||
			snapshot.workId !== work.id ||
			snapshot.collectedAt !== corpus.collectedAt
		)
			throw new Error(`Invalid provider snapshot for ${work.id}.`);
		if (snapshot.bangumi.episodes.length !== snapshot.bangumi.episodeTotal)
			throw new Error(`Incomplete episode snapshot for ${work.id}.`);
		snapshots.set(work.id, snapshot);
	}
	for (const entry of corpus.cases) {
		if (entry.expected.decision !== "match") continue;
		const snapshot = snapshots.get(entry.expected.workId ?? "");
		if (
			!snapshot ||
			!entry.expected.episodes?.length ||
			entry.expected.episodes.some(
				(number) =>
					!snapshot.bangumi.episodes.some(
						(episode) => episode.type === 0 && episode.sort === number,
					),
			)
		)
			throw new Error(`Unverified episode expectation in ${entry.id}.`);
	}
	return corpus;
}

/** Creates a new directory exclusively; never merges into an existing library. */
export async function materializeCorpus(
	corpus: AnimeCorpus,
	destination: string,
): Promise<{ files: number; destination: string }> {
	validateCorpus(corpus);
	const entries = corpus.cases.flatMap((entry, index) =>
		entry.input.kind === "file"
			? [
					{
						id: entry.id,
						path: `cases/case-${String(index + 1).padStart(4, "0")}/${entry.input.relativePath}`,
					},
				]
			: [],
	);
	for (const scenario of corpus.scenarios)
		for (const resource of scenario.resources)
			entries.push({
				id: resource.caseId,
				path: `scenarios/${scenario.id}/${resource.relativePath}`,
			});
	await mkdir(destination);
	for (const entry of entries) {
		const path = join(destination, entry.path);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			`Anishelf identification placeholder: ${entry.id}\n`,
			{
				flag: "wx",
			},
		);
	}
	await writeFile(
		join(destination, "fixture-manifest.json"),
		JSON.stringify(
			{ corpusVersion: corpus.version, playable: false, resources: entries },
			null,
			2,
		),
		{ flag: "wx" },
	);
	return { files: entries.length, destination };
}

function equal(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
export function evaluateCorpus(corpus: AnimeCorpus, value: unknown) {
	validateCorpus(corpus);
	if (!Check(predictionsSchema, value))
		throw new Error("Invalid predictions schema.");
	if (value.corpusVersion !== corpus.version)
		throw new Error("Predictions use a different corpus version.");
	unique(
		value.results.map((entry) => entry.id),
		"prediction ID",
	);
	const known = new Set(corpus.cases.map((entry) => entry.id));
	if (value.results.some((entry) => !known.has(entry.id)))
		throw new Error("Predictions contain unknown case IDs.");
	const results = new Map(value.results.map((entry) => [entry.id, entry]));
	const rows = corpus.cases.map((entry) => {
		const actual = results.get(entry.id);
		const failures: string[] = [];
		if (!actual) failures.push("missing");
		else {
			for (const key of ["decision", "workId", "episodes"] as const)
				if (!equal(entry.expected[key], actual[key])) failures.push(key);
			for (const key of Object.keys(entry.expected.parsed) as Array<
				keyof typeof entry.expected.parsed
			>)
				if (!equal(entry.expected.parsed[key], actual.parsed[key]))
					failures.push(`parsed.${key}`);
		}
		return {
			id: entry.id,
			tags: entry.tags,
			passed: failures.length === 0,
			failures,
			unsafeConfirmation:
				actual?.decision === "match" &&
				(entry.expected.decision !== "match" ||
					!equal(actual.workId, entry.expected.workId) ||
					!equal(actual.episodes, entry.expected.episodes)),
			expected: entry.expected,
			actual: actual ?? null,
		};
	});
	const tags = [...new Set(corpus.cases.flatMap((entry) => entry.tags))].sort();
	const confirmed = rows.filter((row) => row.expected.decision === "match");
	const candidateRows = confirmed.filter((row) => row.actual?.candidateWorkIds);
	const parsedRows = rows.filter(
		(row) => Object.keys(row.expected.parsed).length > 0,
	);
	return {
		corpusVersion: corpus.version,
		parserVersion: value.parserVersion,
		matcherVersion: value.matcherVersion,
		providerSnapshotDate: corpus.collectedAt,
		total: rows.length,
		passed: rows.filter((row) => row.passed).length,
		missing: rows.filter((row) => row.failures.includes("missing")).length,
		unsafeConfirmations: rows.filter((row) => row.unsafeConfirmation).length,
		metrics: {
			decision: {
				total: rows.length,
				correct: rows.filter(
					(row) => row.actual?.decision === row.expected.decision,
				).length,
			},
			work: {
				total: confirmed.length,
				correct: confirmed.filter(
					(row) => row.actual?.workId === row.expected.workId,
				).length,
			},
			episodes: {
				total: confirmed.length,
				correct: confirmed.filter((row) =>
					equal(row.actual?.episodes, row.expected.episodes),
				).length,
			},
			parsed: {
				total: parsedRows.length,
				correct: parsedRows.filter(
					(row) =>
						row.actual &&
						!row.failures.some((failure) => failure.startsWith("parsed.")),
				).length,
			},
			candidates: {
				evaluated: candidateRows.length,
				notSupplied: confirmed.length - candidateRows.length,
				top1: candidateRows.filter(
					(row) => row.actual?.candidateWorkIds?.[0] === row.expected.workId,
				).length,
				top5: candidateRows.filter((row) =>
					row.actual?.candidateWorkIds
						?.slice(0, 5)
						.includes(row.expected.workId ?? ""),
				).length,
			},
		},
		byTag: Object.fromEntries(
			tags.map((tag) => {
				const group = rows.filter((row) => row.tags.includes(tag));
				return [
					tag,
					{
						total: group.length,
						passed: group.filter((row) => row.passed).length,
					},
				];
			}),
		),
		rows,
	};
}
export function summarizeCorpus(corpus: AnimeCorpus) {
	return {
		version: corpus.version,
		works: corpus.works.length,
		cases: corpus.cases.length,
		files: corpus.cases.filter((entry) => entry.input.kind === "file").length,
		scenarios: corpus.scenarios.length,
		provenance: Object.fromEntries(
			["torrent-file", "release-title", "synthetic"].map((kind) => [
				kind,
				corpus.cases.filter((entry) => entry.provenance.kind === kind).length,
			]),
		),
		tags: [...new Set(corpus.cases.flatMap((entry) => entry.tags))].sort(),
	};
}
export function fixtureBasename(entry: AnimeCase): string {
	if (entry.input.kind !== "file") throw new Error("Not a file case.");
	return basename(entry.input.relativePath);
}
