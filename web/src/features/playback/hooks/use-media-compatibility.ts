import { useEffect, useRef, useState } from "react";
import {
	checkMediaCompatibility,
	inspectMediaCompatibility,
} from "../../../api/client.js";
import type { CompatibilityResult } from "../../../api/contracts.js";
import {
	clearCapabilityCache,
	queryCapabilities,
} from "../../../lib/media-capabilities.js";
export function useMediaCompatibility(fileId: string, sourceVersion?: string) {
	const identity = fileId;
	const expectedVersion = useRef(sourceVersion);
	expectedVersion.current = sourceVersion;
	const [revision, setRevision] = useState(0);
	const [state, setState] = useState<{
		identity: string;
		loading: boolean;
		result: CompatibilityResult | null;
		error: unknown;
	}>({ identity, loading: true, result: null, error: null });
	const [attempt, setAttempt] = useState(false);
	const [runtimeFailed, setRuntimeFailed] = useState(false);
	useEffect(() => {
		const controller = new AbortController();
		const signal = AbortSignal.any([
			controller.signal,
			AbortSignal.timeout(30000),
		]);
		setState({ identity, loading: true, result: null, error: null });
		setAttempt(false);
		setRuntimeFailed(false);
		void (async () => {
			try {
				const description = await inspectMediaCompatibility(
					{ fileId },
					{ signal },
				);
				if (
					expectedVersion.current &&
					description.sourceVersion !== expectedVersion.current
				)
					throw new Error("The source changed. Reopen playback.");
				const evidence = await queryCapabilities(
					description.queries,
					signal,
					revision > 0,
				);
				const result = await checkMediaCompatibility(
					{
						fileId,
						sourceVersion: description.sourceVersion,
						descriptionId: description.descriptionId,
						output: description.output
							? {
									profileId: description.output.profileId,
									target: description.output.target,
								}
							: null,
						evidence,
					},
					{ signal },
				);
				if (!controller.signal.aborted)
					setState({ identity, loading: false, result, error: null });
			} catch (error) {
				if (!controller.signal.aborted)
					setState({ identity, loading: false, result: null, error });
			}
		})();
		return () => controller.abort();
	}, [fileId, revision, identity]);
	const conflict =
		state.result &&
		sourceVersion &&
		state.result.sourceVersion !== sourceVersion;
	const current =
		state.identity === identity
			? conflict
				? {
						...state,
						result: null,
						error: new Error("The source changed. Reopen playback."),
					}
				: state
			: { identity, loading: true, result: null, error: null };
	return {
		...current,
		runtimeFailed,
		canAttempt:
			state.identity === identity &&
			!conflict &&
			(attempt ||
				(!current.loading && current.result?.direct.status === "supported")),
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
