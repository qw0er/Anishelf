import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	CompatibilityResult,
	DirectoryResponse,
} from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
import { queryGate } from "../../../shared/lib/query-gate.js";
import {
	checkOriginalMedia,
	compatibilityKeys,
	mediacompatibilityInteractionPolicy,
	originalCompatibilityKey,
} from "../../media-compatibility/public.js";
export type DirectoryCompatibilityState = {
	loading: boolean;
	result: CompatibilityResult | null;
	error: unknown;
};
export function useDirectoryCompatibility(
	listing: DirectoryResponse,
	scope: string,
) {
	const client = useQueryClient();
	const files = listing.children.filter((entry) => entry.kind === "file");
	const identity = JSON.stringify([
		scope,
		files.map((file) => originalCompatibilityKey(file, scope)),
	]);
	// A departed directory cannot occupy the new directory's admission slots.
	// biome-ignore lint/correctness/useExhaustiveDependencies: metadata identifies the negotiation group
	const gate = useMemo(
		() =>
			queryGate(mediacompatibilityInteractionPolicy.compatibilityConcurrency),
		[identity],
	);
	const queries = useQueries({
		queries: files.map((file) => ({
			queryKey: compatibilityKeys.compatibility(
				originalCompatibilityKey(file, scope),
			),
			staleTime: Infinity,
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				gate(signal, () =>
					checkOriginalMedia(
						file.id,
						boundedSignal(
							signal,
							mediacompatibilityInteractionPolicy.compatibilityRequestTimeoutMs,
						),
					),
				),
		})),
	});
	return {
		get: (id: string): DirectoryCompatibilityState => {
			const result = queries[files.findIndex((file) => file.id === id)];
			return {
				loading: result?.isPending ?? true,
				result: result?.data ?? null,
				error: result?.error ?? null,
			};
		},
		retry: () => {
			for (const file of files)
				void client.invalidateQueries({
					queryKey: compatibilityKeys.compatibility(
						originalCompatibilityKey(file, scope),
					),
					exact: true,
				});
		},
	};
}
