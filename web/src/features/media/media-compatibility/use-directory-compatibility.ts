import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	CompatibilityResult,
	DirectoryResponse,
} from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
import { queryGate } from "../../../shared/lib/query-gate.js";
import { removeCompatibility } from "./cache.js";
import { clearCapabilityCache } from "./capabilities.js";
import {
	checkOriginalMedia,
	originalCompatibilityKey,
} from "./compatibility.js";
import { mediacompatibilityInteractionPolicy } from "./policy.js";
import { compatibilityKeys } from "./queries.js";
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
		files.map((file) => originalCompatibilityKey(file)),
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
			queryKey: compatibilityKeys.compatibility(originalCompatibilityKey(file)),
			staleTime: Infinity,
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				gate(signal, () =>
					checkOriginalMedia(
						file.id,
						boundedSignal(
							signal,
							mediacompatibilityInteractionPolicy.compatibilityRequestTimeoutMs,
						),
						file.sourceVersion ? { sourceVersion: file.sourceVersion } : {},
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
		retry: async () => {
			clearCapabilityCache();
			for (const file of files) {
				await removeCompatibility(file.id);
				void client.invalidateQueries({
					queryKey: compatibilityKeys.compatibility(
						originalCompatibilityKey(file),
					),
					exact: true,
				});
			}
		},
	};
}
