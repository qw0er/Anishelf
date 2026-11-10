import { createHash } from "node:crypto";
export function subtitleTrackId(parts: readonly unknown[]): string {
	return `subtitle_${createHash("sha256").update(JSON.stringify(parts)).digest("base64url")}`;
}
