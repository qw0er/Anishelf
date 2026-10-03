import { createHash } from "node:crypto";
export function sourceIdentityKey(...parts: string[]): string {
	return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}
export function resourceRootId(canonicalRoot: string): string {
	return sourceIdentityKey("root", canonicalRoot);
}
