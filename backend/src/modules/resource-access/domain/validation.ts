import { DomainError } from "../../../shared/errors.js";
import type { FileSourceIdentity } from "./model.js";

export function assertSourceVersion(expected: string, current: string): void {
	if (expected !== current)
		throw new DomainError("PLAYBACK_CONFLICT", "The source file changed.");
}

export function assertFileSource(
	expected: FileSourceIdentity,
	current: FileSourceIdentity,
): void {
	if (
		expected.canonicalRoot !== current.canonicalRoot ||
		expected.relativePath !== current.relativePath
	)
		throw new DomainError("PLAYBACK_CONFLICT", "The source file changed.");
	assertSourceVersion(expected.sourceVersion, current.sourceVersion);
}
