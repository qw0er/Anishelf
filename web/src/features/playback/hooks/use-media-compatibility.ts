import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CompatibilityResult } from "../../../api/contracts.js";
import { boundedSignal, keys } from "../../../api/queries.js";
import { interactionPolicy } from "../../../config/interaction-policy.js";
import { clearCapabilityCache } from "../../../lib/media-capabilities.js";
import { checkOriginalMedia } from "../../../lib/media-compatibility.js";
export function useMediaCompatibility(
	fileId: string,
	sourceVersion?: string,
	cacheKey?: string,
) {
	const client = useQueryClient();
	const baseKey = keys.compatibility(cacheKey ?? fileId);
	const cached = client.getQueryData<CompatibilityResult>(baseKey);
	const queryKey =
		sourceVersion && cached && cached.sourceVersion !== sourceVersion
			? [...baseKey, sourceVersion]
			: baseKey;
	const query = useQuery({
		queryKey,
		staleTime: Infinity,
		queryFn: ({ signal }) =>
			checkOriginalMedia(
				fileId,
				boundedSignal(signal, interactionPolicy.compatibilityRequestTimeoutMs),
				{ ...(sourceVersion ? { sourceVersion } : {}) },
			),
	});
	const [attempt, setAttempt] = useState(false);
	const [runtimeFailed, setRuntimeFailed] = useState(false);
	return {
		loading: query.isPending,
		result: query.data ?? null,
		error: query.error,
		runtimeFailed,
		canAttempt:
			!query.isPending &&
			(attempt || query.data?.direct.status === "supported"),
		tryDirect: () => {
			setAttempt(true);
			setRuntimeFailed(false);
		},
		retry: () => {
			clearCapabilityCache();
			void query.refetch();
		},
		failed: () => {
			clearCapabilityCache();
			setRuntimeFailed(true);
		},
	};
}
