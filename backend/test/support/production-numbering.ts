import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { type AnimeCorpus, corpusDirectory } from "./anime-corpus.js";

const text = Type.String({ minLength: 1 });
const schema = Type.Object({
	schemaVersion: Type.Literal(1),
	version: text,
	corpusVersion: text,
	basis: text,
	rows: Type.Array(
		Type.Object({
			caseId: text,
			workId: text,
			snapshot: text,
			providerId: text,
			basis: Type.Union([
				Type.Literal("explicit-season-local-filename"),
				Type.Literal("curated-local-numbering"),
			]),
			expectedSorts: Type.Array(Type.Number()),
			targets: Type.Array(Type.String({ pattern: "^[1-9][0-9]*$" }), {
				minItems: 1,
			}),
		}),
	),
});

/** Independent frozen labels are only read by evaluation, never by production matching. */
export async function productionNumbering(corpus: AnimeCorpus) {
	const labels: unknown = JSON.parse(
		await readFile(join(corpusDirectory, "production-numbering.json"), "utf8"),
	);
	if (!Check(schema, labels) || labels.corpusVersion !== corpus.version)
		throw new Error("Invalid or stale production numbering labels.");
	const result = new Map<string, (typeof labels.rows)[number]>();
	for (const label of labels.rows) {
		const entry = corpus.cases.find((item) => item.id === label.caseId);
		const work = corpus.works.find((item) => item.id === label.workId);
		if (
			result.has(label.caseId) ||
			entry?.expected.decision !== "match" ||
			entry.expected.workId !== label.workId ||
			work?.snapshot !== label.snapshot ||
			JSON.stringify(entry.expected.episodes) !==
				JSON.stringify(label.expectedSorts)
		)
			throw new Error(`Invalid production label ${label.caseId}`);
		const snapshot = JSON.parse(
			await readFile(join(corpusDirectory, work.snapshot), "utf8"),
		) as {
			anilist: { id: number; episodes: number | null };
			bangumi: { episodes: { type: number; sort: number; ep: number }[] };
		};
		const expected = label.expectedSorts.map(
			(sort) =>
				snapshot.bangumi.episodes.find(
					(episode) => episode.type === 0 && episode.sort === sort,
				)?.ep,
		);
		const explicit =
			entry.input.kind === "file"
				? [
						...(entry.input.relativePath.split("/").at(-1) ?? "").matchAll(
							/\bS\d+E(\d+)\b/giu,
						),
					].map((match) => String(Number(match[1])))
				: [];
		const releaseLocal =
			label.basis === "explicit-season-local-filename"
				? explicit
				: entry.expected.parsed.rawEpisodes?.map(String);
		if (JSON.stringify(releaseLocal) !== JSON.stringify(label.targets))
			throw new Error(
				`Production label lacks independent source numbering: ${label.caseId}`,
			);
		if (
			String(snapshot.anilist.id) !== label.providerId ||
			expected.some(
				(number, index) =>
					number === undefined ||
					String(number) !== label.targets[index] ||
					number < 1 ||
					(snapshot.anilist.episodes !== null &&
						number > snapshot.anilist.episodes),
			) ||
			expected.length !== label.targets.length
		)
			throw new Error(`Uncorroborated production label ${label.caseId}`);
		result.set(label.caseId, label);
	}
	return { version: labels.version, basis: labels.basis, rows: result };
}
