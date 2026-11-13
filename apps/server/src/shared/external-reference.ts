export function externalId(provider: string, id: string): string {
	if (!provider || !id) throw new Error("Empty external identity.");
	return `${encodeURIComponent(provider)}:${encodeURIComponent(id)}`;
}
export function externalIdParts(key: string): { provider: string; id: string } {
	const parts = key.split(":");
	if (parts.length !== 2) throw new Error("Invalid external identity.");
	const provider = decodeURIComponent(parts[0] ?? ""),
		id = decodeURIComponent(parts[1] ?? "");
	if (externalId(provider, id) !== key)
		throw new Error("Noncanonical external identity.");
	return { provider, id };
}
