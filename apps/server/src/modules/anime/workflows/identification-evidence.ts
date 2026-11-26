import { createHash } from "node:crypto";
import type { IdentificationResult } from "@anishelf/anime-identification";
import type { SourceIdentity } from "../../resources/public.js";

export function identificationFingerprint(
	version: string,
	metadataContext: unknown,
	sources: readonly SourceIdentity[],
): string {
	return createHash("sha256")
		.update(JSON.stringify([version, metadataContext, sources]))
		.digest("hex");
}

export function sourcesNeedingIdentification(
	sources: readonly SourceIdentity[],
	reusable: readonly IdentificationResult[],
): SourceIdentity[] {
	const sourceKey = (source: SourceIdentity) =>
		`${source.fileId}:${source.sourceVersion}`;
	const reused = new Set(reusable.map((result) => sourceKey(result.source)));
	return sources.filter((source) => !reused.has(sourceKey(source)));
}
