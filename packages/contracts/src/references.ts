/** Canonical, namespaced identities. External IDs are opaque strings. */
export interface ExternalWorkReference {
	provider: string;
	mediaType: "anime";
	id: string;
}
export function workKey(reference: ExternalWorkReference): string {
	return `${encodeURIComponent(reference.provider)}:${reference.mediaType}:${encodeURIComponent(reference.id)}`;
}
export function workReference(key: string): ExternalWorkReference {
	const parts = key.split(":");
	if (parts.length !== 3 || parts[1] !== "anime")
		throw new Error("Invalid work identity.");
	const reference: ExternalWorkReference = {
		provider: decodeURIComponent(parts[0] ?? ""),
		mediaType: "anime",
		id: decodeURIComponent(parts[2] ?? ""),
	};
	if (!reference.provider || !reference.id || workKey(reference) !== key)
		throw new Error("Noncanonical work identity.");
	return reference;
}
