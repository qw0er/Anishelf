import { expect } from "vitest";

/**
 * FFmpeg builds disagree on whether AAC priming and padding frames belong to
 * the container duration. A tolerance slightly wider than the delay added by
 * those frames keeps duration assertions independent of the installed build.
 */
export function expectMediaDuration(
	actual: number | null,
	expected: number | null,
): void {
	if (actual === null || expected === null)
		throw new Error("Media duration is unavailable.");
	expect(Math.abs(actual - expected)).toBeLessThan(0.1);
}
