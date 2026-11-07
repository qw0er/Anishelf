import { identificationDefaults } from "../defaults.js";
import type { ExtractionEvidence } from "./model.js";

/** Shared by production identification and the small offline search replay. */
export function identificationSearchQueries(
	evidence: Pick<ExtractionEvidence, "titles" | "seasons" | "parts">,
): string[] {
	const titles = [...evidence.titles];
	if (evidence.seasons.length === 1 && Number(evidence.seasons[0]) > 1) {
		const title = evidence.titles[0];
		if (title)
			titles.splice(1, 0, `${title} Season ${Number(evidence.seasons[0])}`);
	}
	if (evidence.parts.length === 1 && evidence.titles[0])
		titles.splice(
			2,
			0,
			`${evidence.titles[0]} Part ${Number(evidence.parts[0])}`,
		);
	return [...new Set(titles)].slice(0, identificationDefaults.maximumQueries);
}
