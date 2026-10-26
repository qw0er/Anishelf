import { queryOptions } from "@tanstack/react-query";
import { boundedSignal } from "../../../shared/api/queries.js";
import type { queryGate } from "../../../shared/lib/query-gate.js";
import { checkOriginalMedia } from "./compatibility.js";
import { mediaCompatibilityDefaults } from "./defaults.js";
/** Catalog supplies a confirmed source version instead of a directory's stat identity. */
export function sourceCompatibilityQuery(
	source: { fileId: string; sourceVersion: string },
	gate: ReturnType<typeof queryGate>,
) {
	return queryOptions({
		queryKey: ["compatibility", "source", source.fileId, source.sourceVersion],
		staleTime: Infinity,
		retry: false,
		queryFn: ({ signal }) =>
			gate(signal, () =>
				checkOriginalMedia(
					source.fileId,
					boundedSignal(
						signal,
						mediaCompatibilityDefaults.compatibilityRequestTimeoutMs,
					),
					{ sourceVersion: source.sourceVersion },
				),
			),
	});
}
