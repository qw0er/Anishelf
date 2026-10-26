import { createHash } from "node:crypto";
import { posix } from "node:path";
import { animeNameParser } from "../anitomy-adapter.js";
import { identificationDefaults } from "../defaults.js";
import type {
	ExtractionElement,
	ExtractionEvidence,
	ExtractionInput,
} from "../domain/model.js";
import type { IdentificationParser } from "../ports.js";

function values(elements: ExtractionElement[], kind: string): string[] {
	return elements
		.filter((element) => element.kind === kind)
		.map((element) => element.value);
}
function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}
export class AnitomyIdentificationParser implements IdentificationParser {
	readonly version =
		`anitomy-ng@1.0.10:${identificationDefaults.normalizationVersion}`;
	extractRelease(title: string): ExtractionEvidence {
		const result = this.extract([title], true)[0];
		if (!result) throw new Error("Missing release extraction.");
		return result;
	}
	extract(paths: string[], release = false): ExtractionEvidence[] {
		const together = release ? [] : animeNameParser.parseTogether(paths);
		const contextFingerprint = createHash("sha256")
			.update(JSON.stringify([...paths].sort()))
			.digest("hex");
		return paths.map((relativePath, index) => {
			const originalName = release
				? relativePath
				: posix.basename(relativePath);
			const leaf = animeNameParser.parse(originalName);
			const inputs: ExtractionInput[] = [
				{ mode: "basename", input: originalName, elements: leaf },
				...(release
					? []
					: relativePath
							.split("/")
							.slice(0, -1)
							.map(
								(input): ExtractionInput => ({
									mode: "ancestor",
									input,
									elements: animeNameParser.parse(input),
								}),
							)),
				...(release
					? []
					: [
							{
								mode: "path" as const,
								input: relativePath,
								elements: animeNameParser.parsePath(relativePath),
							},
							{
								mode: "together",
								input: relativePath,
								elements: together[index] ?? [],
							} as ExtractionInput,
						]),
			];
			const adapted = inputs.map((input) =>
				animeNameParser.adapt(input.input, input.elements),
			);
			const rawEpisodes = values(leaf, "episode");
			const selected = animeNameParser.numbering(originalName, leaf);
			// Recover only a repeated bracket label in a numbered file and its parent.
			// This supplies a search candidate; metadata must still establish identity.
			const group = values(leaf, "release_group")[0];
			if (
				!values(leaf, "title").length &&
				rawEpisodes.length &&
				group &&
				inputs.some(
					(input) =>
						input.mode === "ancestor" &&
						!values(input.elements, "title").length &&
						values(input.elements, "release_group").includes(group),
				)
			)
				adapted[0]?.push({
					kind: "title",
					value: group,
					position:
						leaf.find((element) => element.kind === "release_group")
							?.position ?? 0,
				});
			const types = values(adapted[0] ?? [], "type").map((value) =>
				value.toUpperCase(),
			);
			const menuDirectory = inputs.some(
				(input) => input.mode === "ancestor" && /^menu$/iu.test(input.input),
			);
			const ancillary =
				menuDirectory ||
				types.some((type) =>
					[
						"ANCILLARY",
						"NCOP",
						"NCED",
						"OP",
						"ED",
						"PV",
						"CM",
						"TRAILER",
					].includes(type),
				);
			const special = types.some((type) =>
				["OVA", "OAD", "SP", "SPECIAL"].includes(type),
			);
			const numbering = selected.kind;
			const ancestorCount = inputs.filter(
				(input) => input.mode === "ancestor",
			).length;
			const titleSources = inputs.flatMap((input, inputIndex) =>
				values(adapted[inputIndex] ?? [], "title").map((title) => ({
					title,
					mode: input.mode,
					distance: input.mode === "ancestor" ? ancestorCount - inputIndex : 0,
				})),
			);
			const titleInputs = [
				adapted[0] ?? [],
				...inputs
					.flatMap((input, index) =>
						input.mode === "ancestor" ? [adapted[index] ?? []] : [],
					)
					.reverse(),
				...inputs.flatMap((input, index) =>
					input.mode === "path" || input.mode === "together"
						? [adapted[index] ?? []]
						: [],
				),
			];
			return {
				parser: "anitomy-ng",
				parserVersion: "1.0.10",
				normalizationVersion: identificationDefaults.normalizationVersion,
				contextFingerprint,
				originalName,
				relativePath,
				inputs,
				titles: unique(
					titleInputs.flatMap((elements) => values(elements, "title")),
				),
				titleSources,
				years: unique(
					inputs.flatMap((input) => values(input.elements, "year")),
				),
				seasons: unique(
					adapted.flatMap((elements) => values(elements, "season")),
				),
				parts: unique(adapted.flatMap((elements) => values(elements, "part"))),
				rawEpisodes,
				selectedEpisodes: selected.tokens,
				numbering,
				contentKind: ancillary
					? "ancillary"
					: special
						? "special"
						: rawEpisodes.length
							? "regular"
							: "unknown",
			};
		});
	}
}
