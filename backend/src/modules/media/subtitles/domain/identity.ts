import { createHash } from "node:crypto";

export const subtitleIdentity = Object.freeze({
	trackPrefix: "subtitle_",
	assetPrefix: "subtitle_asset_",
	processingVersion: "text-extraction-v1",
	fallbackName: "Subtitle",
});
export function subtitleTrackId(parts: readonly unknown[]): string {
	return `${subtitleIdentity.trackPrefix}${digest(parts)}`;
}
export function subtitleAssetId(parts: readonly unknown[]): string {
	return `${subtitleIdentity.assetPrefix}${digest([...parts, subtitleIdentity.processingVersion])}`;
}
export function isSubtitleAssetId(id: string): boolean {
	return (
		id.startsWith(subtitleIdentity.assetPrefix) &&
		/^[A-Za-z0-9_-]+$/.test(id.slice(subtitleIdentity.assetPrefix.length))
	);
}
function digest(parts: readonly unknown[]): string {
	return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}

export function defaultSubtitleName(index: number): string {
	return `${subtitleIdentity.fallbackName} ${index}`;
}
