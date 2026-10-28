/** Playback listens to one source track; retention arrays belong to preparation. */
export function parseAudioSelection(value: string | null): {
	valid: boolean;
	index: number | null | undefined;
} {
	if (value === null) return { valid: true, index: undefined };
	if (value === "none") return { valid: true, index: null };
	const index = Number(value);
	const valid = /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(index);
	return { valid, index: valid ? index : undefined };
}
