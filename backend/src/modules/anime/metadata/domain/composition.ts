import { MetadataError, type WorkDetails } from "./model.js";
import type { ArtworkEvidence } from "./project-document.js";
import type * as Source from "./source-model.js";

/** Inputs are ordered by source preference; identities have already been resolved. */
export function composeDetails(
	values: readonly { content: WorkDetails; evidence: Source.WorkDetails }[],
): { data: WorkDetails; artwork: ArtworkEvidence } {
	const first = values[0];
	if (!first)
		throw new MetadataError({
			code: "unavailable",
			message: "Work information is unavailable.",
			retryAt: null,
		});
	const data = { ...first.content };
	const artwork: ArtworkEvidence = {};
	// Scalar conflicts keep the stable primary source; only missing fields are filled.
	for (const value of values) {
		const next = value.content;
		for (const key of Object.keys(data) as (keyof WorkDetails)[]) {
			if (
				key === "reference" ||
				key === "unavailableFields" ||
				key === "titles"
			)
				continue;
			if (data[key] === null || (Array.isArray(data[key]) && !data[key].length))
				Object.assign(data, { [key]: next[key] });
		}
		for (const kind of ["cover", "banner"] as const)
			if (
				!artwork[kind] &&
				value.evidence[kind === "cover" ? "coverUrl" : "bannerUrl"]
			)
				artwork[kind] = value.evidence;
	}
	data.titles = [
		...new Map(
			values
				.flatMap((value) => value.evidence.titles)
				.map((title) => [JSON.stringify(title), title]),
		).values(),
	];
	data.unavailableFields = [
		...new Set([
			...Object.entries(data)
				.filter(([, value]) => value === null)
				.map(([key]) => key),
			...values.flatMap((value) => value.evidence.unavailableFields),
		]),
	].filter((key) => {
		const value = data[key as keyof WorkDetails];
		return (
			value === null ||
			(Array.isArray(value) && !value.length) ||
			value === "unavailable"
		);
	});
	return { data, artwork };
}
