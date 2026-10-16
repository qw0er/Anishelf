import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import type { queryGate } from "../../../shared/lib/query-gate.js";
import { checkOriginalMedia } from "./compatibility.js";
import { mediacompatibilityInteractionPolicy } from "./policy.js";
/** Catalog supplies a confirmed source version instead of a directory's stat identity. */
export function sourceCompatibilityQuery(
	source: { fileId: string; sourceVersion: string },
	scope: string,
	gate: ReturnType<typeof queryGate>,
) {
	return queryOptions({
		queryKey: [
			"compatibility",
			"source",
			scope,
			source.fileId,
			source.sourceVersion,
		],
		staleTime: Infinity,
		retry: false,
		queryFn: ({ signal }) =>
			gate(signal, () =>
				checkOriginalMedia(
					source.fileId,
					boundedSignal(
						signal,
						mediacompatibilityInteractionPolicy.compatibilityRequestTimeoutMs,
					),
					{ sourceVersion: source.sourceVersion },
				),
			),
	});
}
