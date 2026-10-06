export function parseAudioSelection(value: string | null): {
	valid: boolean;
	indices: number[] | undefined;
} {
	if (value === null) return { valid: true, indices: undefined };
	if (value === "") return { valid: true, indices: [] };
	const parts = value.split(",");
	const indices = parts.map(Number);
	const valid =
		parts.every((part) => /^(0|[1-9]\d*)$/.test(part)) &&
		indices.every(Number.isSafeInteger) &&
		new Set(indices).size === indices.length &&
		indices.length <= 128;
	return { valid, indices: valid ? indices : undefined };
}
