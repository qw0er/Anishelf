import {
	type ExtractionEvidence,
	matchingTitle,
} from "../identification/public.js";
import type { AcquisitionTarget, ReleaseParser } from "./public.js";

export const localizedPackLabel = /(?:合[集辑輯]|全集)版?(?!\p{Script=Han})/u;
const episodeRangeSeparator =
	/(?<![\p{L}\p{N}]|\b(?:season|part|cour)\s+)((?:s\d+e|ep?\s*)?\d+)(?:\s*[-‐‑‒–—−~～至]\s*|\s+to\s+)(?:ep?\s*)?(?=\d)/giu;

export function publicationRangeEvidence(
	parser: ReleaseParser,
	evidence: ExtractionEvidence,
) {
	// Some range delimiters are read as title text and a single endpoint.
	if (evidence.numbering === "range") return evidence;
	const normalized = evidence.originalName.replace(
		episodeRangeSeparator,
		"$1-",
	);
	if (normalized === evidence.originalName) return evidence;
	const variant = parser.extractRelease(normalized);
	return variant.numbering === "range" ? variant : evidence;
}

export function matchesPublicationTitle(
	value: string,
	work: AcquisitionTarget["work"],
	seasons: string[],
	parts: string[],
) {
	const stripped = value.replace(localizedPackLabel, " ").trim();
	return work.titles.some(
		(alias) =>
			matchingTitle(value, alias, seasons, parts) ||
			(stripped !== value && matchingTitle(stripped, alias, seasons, parts)),
	);
}
