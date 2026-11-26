import { createHash } from "node:crypto";
import { animeNameParser } from "./anitomy-adapter.ts";
import { identificationDefaults } from "./defaults.ts";
import type {
	ExtractionElement,
	ExtractionEvidence,
	ExtractionInput,
} from "./model.ts";
export interface IdentificationSourcePath {
	relativePath: string;
	filename: string;
	ancestors: string[];
}

export interface IdentificationParser {
	readonly version: string;
	extract(paths: readonly IdentificationSourcePath[]): ExtractionEvidence[];
}

function values(elements: ExtractionElement[], kind: string): string[] {
	return elements
		.filter((element) => element.kind === kind)
		.map((element) => element.value);
}
function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}
function contextFingerprint(paths: string[]): string {
	return createHash("sha256")
		.update(JSON.stringify(paths.toSorted()))
		.digest("hex");
}
export class AnitomyIdentificationParser implements IdentificationParser {
	readonly version =
		`anitomy-ng@1.0.10:${identificationDefaults.normalizationVersion}`;
	extractRelease(title: string): ExtractionEvidence {
		return this.extractEvidence(title, title, [], contextFingerprint([title]));
	}
	extract(sources: readonly IdentificationSourcePath[]): ExtractionEvidence[] {
		const directories = new Map<
			string,
			{ source: IdentificationSourcePath; index: number }[]
		>();
		for (const [index, source] of sources.entries()) {
			const key = JSON.stringify(source.ancestors);
			const siblings = directories.get(key) ?? [];
			siblings.push({ source, index });
			directories.set(key, siblings);
		}
		const evidence = new Array<ExtractionEvidence>(sources.length);
		for (const siblings of directories.values()) {
			const paths = siblings.map(({ source }) => source.relativePath);
			const together = animeNameParser.parseTogether(paths);
			const fingerprint = contextFingerprint(paths);
			for (const [offset, { source, index }] of siblings.entries()) {
				evidence[index] = this.extractFile(
					source,
					together[offset] ?? [],
					fingerprint,
				);
			}
		}
		return evidence;
	}

	private extractFile(
		{ relativePath, filename, ancestors }: IdentificationSourcePath,
		together: ExtractionElement[],
		fingerprint: string,
	): ExtractionEvidence {
		return this.extractEvidence(
			relativePath,
			filename,
			[
				...ancestors.map(
					(input): ExtractionInput => ({
						mode: "ancestor",
						input,
						elements: animeNameParser.parse(input),
					}),
				),
				{
					mode: "path",
					input: relativePath,
					elements: animeNameParser.parsePath(relativePath),
				},
				{
					mode: "together",
					input: relativePath,
					elements: together,
				},
			],
			fingerprint,
		);
	}

	private extractEvidence(
		relativePath: string,
		originalName: string,
		contextInputs: ExtractionInput[],
		contextFingerprint: string,
	): ExtractionEvidence {
		const leaf = animeNameParser.parse(originalName);
		const inputs: ExtractionInput[] = [
			{ mode: "basename", input: originalName, elements: leaf },
			...contextInputs,
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
					leaf.find((element) => element.kind === "release_group")?.position ??
					0,
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
			years: unique(inputs.flatMap((input) => values(input.elements, "year"))),
			seasons: unique(
				adapted
					.flatMap((elements) => values(elements, "season"))
					.map((value) => String(Number(value))),
			),
			parts: unique(
				adapted
					.flatMap((elements) => values(elements, "part"))
					.map((value) => String(Number(value))),
			),
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
	}
}
