import { createHash } from "node:crypto";

/** Persist and log budget identities without private URLs or credentials. */
function budgetKey(kind: string, identity: unknown): string {
	return `${kind}:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

export function sourceOriginKey(url: string): string {
	return budgetKey("origin", new URL(url).origin);
}
export function jackettConnectionKey(base: string): string {
	return budgetKey("jackett", base);
}
export function jackettIndexerKey(base: string, indexer: string): string {
	return budgetKey("jackett-indexer", [base, indexer]);
}
