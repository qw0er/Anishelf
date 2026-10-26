import { createHash } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import type { WorkDetails } from "../../metadata/public.js";
import { catalogDefaults as policy } from "../defaults.js";
import type { EpisodeTarget, MappingSelection } from "./model.js";

/** Short digest of the provider artwork URL; provider CDNs rotate it on re-upload. */
export function artworkVersion(url: string | null): string | null {
	return url
		? createHash("sha256").update(url).digest("hex").slice(0, 16)
		: null;
}
export function invalid(message: string): never {
	throw new DomainError("INVALID_REQUEST", message);
}
export function conflict(
	message = "Catalog changed; create a new preview.",
): never {
	throw new DomainError("CATALOG_CONFLICT", message);
}
export function text(value: string, maximum = 500): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > maximum ||
		value.includes("\0")
	)
		invalid("Supply nonempty bounded text.");
	return value.trim();
}
export function integer(
	value: number,
	minimum: number,
	maximum: number,
): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
		invalid("Supply an integer within the supported range.");
	return value;
}
export function target(
	value: EpisodeTarget,
	count: number | null,
	format: string | null,
): EpisodeTarget {
	const number = text(value.number, 100);
	if (value.kind === "regular") {
		if (!/^\d+$/.test(number))
			invalid(
				"Regular episodes require positive integer numbering; use an explicit special identity for other numbering.",
			);
		const normalized = integer(Number(number), 1, policy.maximumEpisode);
		if (format === "MOVIE" || (count !== null && normalized > count))
			invalid("Target numbering is outside this work's scope.");
		return {
			kind: "regular",
			number: String(normalized),
			...(value.label ? { label: text(value.label) } : {}),
		};
	}
	if (value.kind === "movie") {
		if (format !== "MOVIE" || number !== "whole")
			invalid("Whole-work slots require a movie and the number 'whole'.");
		return {
			kind: "movie",
			number: "whole",
			...(value.label ? { label: text(value.label) } : {}),
		};
	}
	if (value.kind !== "special" || !value.label)
		invalid("Specials require an explicit identity and label.");
	return { kind: "special", number, label: text(value.label) };
}
export function targets(
	row: MappingSelection,
	metadata: WorkDetails,
): EpisodeTarget[] {
	if (!row.targets.length || row.targets.length > policy.maximumTargets)
		invalid("Select between one and 100 explicit targets per source.");
	const offset = integer(
		row.offset ?? 0,
		-policy.maximumEpisode,
		policy.maximumEpisode,
	);
	const values = row.targets.map((value) => {
		if (offset && (value.kind !== "regular" || !/^\d+$/.test(value.number)))
			invalid(
				"Offsets only apply to explicitly selected regular integer targets.",
			);
		return target(
			offset
				? { ...value, number: String(Number(value.number) + offset) }
				: value,
			metadata.episodeCount,
			metadata.format,
		);
	});
	if (
		new Set(values.map((value) => `${value.kind}:${value.number}`)).size !==
		values.length
	)
		invalid("A source cannot map to the same episode twice.");
	return values;
}
