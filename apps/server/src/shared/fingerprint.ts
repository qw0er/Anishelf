import { createHash } from "node:crypto";

export function fingerprint(value: unknown): string {
	// Canonical keys make administrator JSON property order irrelevant.
	const canonical = (entry: unknown): unknown =>
		Array.isArray(entry)
			? entry.map(canonical)
			: entry && typeof entry === "object"
				? Object.fromEntries(
						Object.entries(entry)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([key, value]) => [key, canonical(value)]),
					)
				: entry;
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}
