import { useEffect, useRef, useState } from "react";
import type { CompatibilityResult } from "../../../api/contracts.js";
import { interactionPolicy } from "../../../config/interaction-policy.js";
import { clearCapabilityCache } from "../../../lib/media-capabilities.js";
import { checkOriginalMedia } from "../../../lib/media-compatibility.js";
export function useMediaCompatibility(
	fileId: string,
	sourceVersion?: string,
	cacheKey?: string,
) {
	const [revision, setRevision] = useState(0);
	const identity = JSON.stringify([fileId, cacheKey, revision]);
	const [state, setState] = useState<{
		identity: string;
		loading: boolean;
		result: CompatibilityResult | null;
		error: unknown;
	}>({ identity, loading: true, result: null, error: null });
	const resolved = useRef<{
		identity: string;
		result: CompatibilityResult;
	} | null>(null);
	const [attempt, setAttempt] = useState(false);
	const [runtimeFailed, setRuntimeFailed] = useState(false);
	useEffect(() => {
		if (
			resolved.current?.identity === identity &&
			(!sourceVersion ||
				resolved.current.result.sourceVersion === sourceVersion)
		)
			return;
		const controller = new AbortController();
		const signal = AbortSignal.any([
			controller.signal,
			AbortSignal.timeout(interactionPolicy.compatibilityRequestTimeoutMs),
		]);
		setState({ identity, loading: true, result: null, error: null });
		setAttempt(false);
		setRuntimeFailed(false);
		void checkOriginalMedia(fileId, signal, {
			...(sourceVersion ? { sourceVersion } : {}),
			...(cacheKey ? { cacheKey } : {}),
			fresh: revision > 0,
		})
			.then((result) => {
				if (!controller.signal.aborted) {
					resolved.current = { identity, result };
					setState({ identity, loading: false, result, error: null });
				}
			})
			.catch((error) => {
				if (!controller.signal.aborted)
					setState({ identity, loading: false, result: null, error });
			});
		return () => controller.abort();
	}, [identity, fileId, sourceVersion, cacheKey, revision]);
	const current =
		state.identity === identity &&
		(!sourceVersion ||
			!state.result ||
			state.result.sourceVersion === sourceVersion)
			? state
			: { identity, loading: true, result: null, error: null };
	return {
		...current,
		runtimeFailed,
		canAttempt:
			!current.loading &&
			(attempt || current.result?.direct.status === "supported"),
		tryDirect: () => {
			setAttempt(true);
			setRuntimeFailed(false);
		},
		retry: () => {
			clearCapabilityCache();
			setRevision((value) => value + 1);
		},
		failed: () => {
			clearCapabilityCache();
			setRuntimeFailed(true);
		},
	};
}
