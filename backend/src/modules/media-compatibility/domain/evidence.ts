import { Check } from "typebox/value";
import type {
	CompatibilityEvidence,
	CompatibilityQuery,
	CompatibilityResult,
} from "../../../contracts/http.js";
import { CompatibilityEvidenceListSchema } from "../../../contracts/schemas/compatibility.js";
import { DomainError } from "../../../shared/errors.js";

/** Both original and profile-specific negotiation use the same evidence rules. */
export function validateCompatibilityEvidence(
	queries: CompatibilityQuery[],
	evidence: CompatibilityEvidence[],
): void {
	if (!Check(CompatibilityEvidenceListSchema, evidence))
		throw new DomainError("INVALID_REQUEST", "Invalid compatibility evidence.");
	const ids = new Set(queries.map((query) => query.id));
	const seen = new Set<string>();
	for (const entry of evidence) {
		if (
			!ids.has(entry.id) ||
			seen.has(entry.id) ||
			(entry.status === "supported") !==
				(entry.reason === "browser-supported") ||
			(entry.status === "unsupported") !== (entry.reason === "browser-rejected")
		)
			throw new DomainError(
				"INVALID_REQUEST",
				"Invalid compatibility evidence.",
			);
		seen.add(entry.id);
	}
}

export function compatibilityDecision(
	queries: CompatibilityQuery[],
	evidence: CompatibilityEvidence[],
	id: string,
): CompatibilityResult["direct"] {
	const query = queries.find((query) => query.id === id);
	if (!query?.contentType)
		return { status: "unknown", reason: "incomplete-description" };
	const report = evidence.find((entry) => entry.id === id);
	return report
		? { status: report.status, reason: report.reason }
		: { status: "unknown", reason: "missing-evidence" };
}

export function compatibilityStatus(
	queries: CompatibilityQuery[],
	evidence: CompatibilityEvidence[],
	id: string,
): CompatibilityEvidence["status"] {
	return compatibilityDecision(queries, evidence, id).status;
}

/** Every track must be supported; one rejected track rejects the aggregate. */
export function aggregateCompatibility(
	decisions: CompatibilityResult["audio"][],
): CompatibilityResult["audio"] {
	return (
		decisions.find((decision) => decision.status === "unsupported") ??
		decisions.find((decision) => decision.status === "unknown") ??
		decisions[0] ?? { status: "supported", reason: "no-audio-stream" }
	);
}
