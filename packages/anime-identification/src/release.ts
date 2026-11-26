import { proposeMapping } from "./mapping.ts";
import { rankCandidates } from "./matching.ts";
import type { ExtractionEvidence, WorkCandidate } from "./model.ts";
import type { IdentificationParser } from "./parser.ts";
import {
	type ReleaseAttributes,
	releaseAttributes,
} from "./release-attributes.ts";
import { matchingTitle } from "./title-evidence.ts";

export interface ReleaseParser extends Pick<IdentificationParser, "extract"> {
	extractRelease(title: string): ExtractionEvidence;
}

export interface ReleaseAssessment {
	attributes?: ReleaseAttributes;
	/** The title plausibly identifies a publication whose files could be useful. */
	inspectionCandidate: boolean;
	episode: number | null;
	/** Only a confirmed single regular episode can enter the single-video flow. */
	eligible: boolean;
	reasons: string[];
	version: string;
}

const localizedPackLabel = /(?:合[集辑輯]|全集)版?(?!\p{Script=Han})/u;
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
	work: WorkCandidate,
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

export function assessReleaseTitle(
	parser: ReleaseParser,
	title: string,
	work: WorkCandidate,
): ReleaseAssessment {
	const evidence = parser.extractRelease(title);
	const publication = publicationRangeEvidence(parser, evidence);
	const candidate = rankCandidates(publication, [work])[0];
	const version = `${evidence.parserVersion}:${evidence.normalizationVersion}:${candidate?.matcherVersion ?? "unknown"}:rss-single-v2`;
	const titleMatches = publication.titles.some((value) =>
		matchesPublicationTitle(
			value,
			work,
			publication.seasons,
			publication.parts,
		),
	);
	const possiblePack =
		publication.numbering === "range" ||
		(publication.numbering === "ambiguous" &&
			publication.rawEpisodes.length > 1) ||
		(publication.numbering === "unknown" && publication.seasons.length > 0) ||
		localizedPackLabel.test(title) ||
		evidence.inputs.some((input) =>
			input.elements.some(
				(element) =>
					element.kind === "release_information" &&
					/^(batch|complete)$/iu.test(element.value),
			),
		);
	const plausibleIdentity = Boolean(
		titleMatches &&
			candidate &&
			!candidate.identityConflicts?.length &&
			!candidate.identityUnresolved?.length,
	);
	const inspectionCandidate =
		plausibleIdentity &&
		work.format !== "MOVIE" &&
		(publication.contentKind === "regular" ||
			publication.contentKind === "unknown") &&
		(possiblePack || publication.numbering === "single");
	const reasons: string[] = [];
	let episode: number | null = null;
	if (!plausibleIdentity || (!possiblePack && candidate?.conflicts.length))
		reasons.push("identity_unconfirmed");
	if (possiblePack && inspectionCandidate) {
		reasons.push("pack_requires_inspection");
	} else {
		if (publication.contentKind !== "regular")
			reasons.push("unsupported_content");
		if (!possiblePack && publication.numbering === "single") {
			const mapping = proposeMapping(publication, work);
			const mapped = mapping.targets[0];
			if (
				mapping.targets.length === 1 &&
				!mapping.unresolved.length &&
				mapped?.kind === "regular"
			)
				episode = Number(mapped.number);
		}
		if (!episode || !Number.isSafeInteger(episode))
			reasons.push("episode_unconfirmed");
	}
	return {
		episode,
		inspectionCandidate,
		attributes: releaseAttributes(evidence),
		eligible: reasons.length === 0,
		reasons,
		version,
	};
}

/** Only explicit single-episode filenames corroborate a previously accepted target. */
export function releaseFilenameMatchesEpisode(
	evidence: ExtractionEvidence,
	titles: readonly string[],
	episode: number,
): boolean {
	const [episodeToken] = evidence.rawEpisodes;
	return (
		evidence.numbering === "single" &&
		evidence.rawEpisodes.length === 1 &&
		episodeToken !== undefined &&
		/^\d+$/.test(episodeToken) &&
		Number(episodeToken) === episode &&
		evidence.titles.some((title) =>
			titles.some((alias) =>
				matchingTitle(title, alias, evidence.seasons, evidence.parts),
			),
		)
	);
}
