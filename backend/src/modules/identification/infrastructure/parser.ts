import { createHash } from "node:crypto";
import { posix } from "node:path";
import { parse, parse_path, parse_together } from "anitomy-ng";
import type {
	ExtractionElement,
	ExtractionEvidence,
	ExtractionInput,
} from "../domain/model.js";
import { identificationPolicy } from "../policy.js";
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
		`anitomy-ng@1.0.10:${identificationPolicy.normalizationVersion}`;
	extract(paths: string[]): ExtractionEvidence[] {
		const together = parse_together(paths);
		const contextFingerprint = createHash("sha256")
			.update(JSON.stringify([...paths].sort()))
			.digest("hex");
		return paths.map((relativePath, index) => {
			const originalName = posix.basename(relativePath);
			const leaf = parse(originalName);
			const inputs: ExtractionInput[] = [
				{ mode: "basename", input: originalName, elements: leaf },
				...relativePath
					.split("/")
					.slice(0, -1)
					.map(
						(input): ExtractionInput => ({
							mode: "ancestor",
							input,
							elements: parse(input),
						}),
					),
				{
					mode: "path",
					input: relativePath,
					elements: parse_path(relativePath),
				},
				{
					mode: "together",
					input: relativePath,
					elements: together[index] ?? [],
				},
			];
			const rawEpisodes = values(leaf, "episode");
			const types = values(leaf, "type").map((value) => value.toUpperCase());
			const ancillary = types.some((type) =>
				["NCOP", "NCED", "OP", "ED", "PV", "CM", "TRAILER"].includes(type),
			);
			const special = types.some((type) =>
				["OVA", "OAD", "SP", "SPECIAL"].includes(type),
			);
			const numbering =
				rawEpisodes.length === 1
					? "single"
					: rawEpisodes.length
						? "ambiguous"
						: "unknown";
			return {
				parser: "anitomy-ng",
				parserVersion: "1.0.10",
				normalizationVersion: identificationPolicy.normalizationVersion,
				contextFingerprint,
				originalName,
				relativePath,
				inputs,
				titles: unique(
					inputs.flatMap((input) => values(input.elements, "title")),
				),
				years: unique(
					inputs.flatMap((input) => values(input.elements, "year")),
				),
				seasons: unique(
					inputs.flatMap((input) => values(input.elements, "season")),
				),
				parts: unique(
					inputs.flatMap((input) => values(input.elements, "part")),
				),
				rawEpisodes,
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
