import { createHash } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import { DomainError } from "../errors.js";
import type { ResourceAccess } from "../resources/access.js";
import {
	externalSubtitleFormat,
	maximumSubtitleBytes,
	type SubtitleDiscovery,
} from "./model.js";

const collator = new Intl.Collator("en", {
	numeric: true,
	sensitivity: "base",
});
function languageFromLabel(label: string | null): string | null {
	const token = label?.split(".")[0];
	if (!token || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(token)) return null;
	try {
		return Intl.getCanonicalLocales(token)[0] ?? null;
	} catch {
		return null;
	}
}

/** On-demand sidecar discovery; no contents, persistence or renderer claims. */
export async function discoverExternalSubtitles(
	resources: ResourceAccess,
	videoPath: string,
	sourceVersion: string,
): Promise<SubtitleDiscovery> {
	const directory = dirname(videoPath);
	const stem = basename(videoPath, extname(videoPath));
	const entries = await resources.readDirectory(
		directory === "." ? "" : directory,
	);
	entries.sort(
		(a, b) =>
			collator.compare(a.name, b.name) ||
			(a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
	);
	const result: SubtitleDiscovery = { sourceVersion, tracks: [], warnings: [] };
	for (const entry of entries) {
		const format = externalSubtitleFormat(entry.name);
		if (!format || entry.isDirectory()) continue;
		const candidateStem = basename(entry.name, extname(entry.name));
		if (candidateStem !== stem && !candidateStem.startsWith(`${stem}.`))
			continue;
		const label =
			candidateStem === stem ? null : candidateStem.slice(stem.length + 1);
		if (label === "" || label?.split(".").some((part) => part === "")) continue;
		const path = join(directory, entry.name);
		try {
			const metadata = await resources.inspectSubtitleSource(path);
			if (metadata.sizeBytes > maximumSubtitleBytes) {
				result.warnings.push({ name: entry.name, code: "SUBTITLE_TOO_LARGE" });
				continue;
			}
			const id = `subtitle_${createHash("sha256")
				.update(JSON.stringify([resources.canonicalRoot, videoPath, path]))
				.digest("base64url")}`;
			result.tracks.push({
				id,
				name: entry.name,
				format,
				label,
				language: languageFromLabel(label),
				sizeBytes: metadata.sizeBytes,
				sourceVersion: metadata.sourceVersion,
			});
		} catch (error) {
			if (
				!(error instanceof DomainError) ||
				![
					"RESOURCE_MISSING",
					"RESOURCE_UNREADABLE",
					"RESOURCE_ACCESS_DENIED",
				].includes(error.code)
			)
				throw error;
			result.warnings.push({
				name: entry.name,
				code: error.code as
					| "RESOURCE_MISSING"
					| "RESOURCE_UNREADABLE"
					| "RESOURCE_ACCESS_DENIED",
			});
		}
	}
	return result;
}
