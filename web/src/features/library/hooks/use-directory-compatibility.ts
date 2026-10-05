import { useEffect, useState } from "react";
import type {
	CompatibilityResult,
	DirectoryResponse,
} from "../../../api/contracts.js";
import { interactionPolicy } from "../../../config/interaction-policy.js";
import {
	checkOriginalMedia,
	originalCompatibilityKey,
} from "../../../lib/media-compatibility.js";

export type DirectoryCompatibilityState = {
	loading: boolean;
	result: CompatibilityResult | null;
	error: unknown;
};
const checking: DirectoryCompatibilityState = {
	loading: true,
	result: null,
	error: null,
};
export function useDirectoryCompatibility(
	listing: DirectoryResponse,
	scope: string,
) {
	const [revision, setRevision] = useState(0);
	const files = listing.children.filter((entry) => entry.kind === "file");
	const identity = JSON.stringify([
		listing.directory.id,
		files.map((file) => originalCompatibilityKey(file, scope)),
		revision,
	]);
	const [state, setState] = useState<{
		identity: string;
		entries: Record<string, DirectoryCompatibilityState>;
	}>({ identity, entries: {} });
	// biome-ignore lint/correctness/useExhaustiveDependencies: identity binds directory scope and file metadata
	useEffect(() => {
		const controller = new AbortController();
		let next = 0;
		setState({ identity, entries: {} });
		async function work() {
			while (!controller.signal.aborted) {
				const file = files[next++];
				if (!file) return;
				const signal = AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(interactionPolicy.compatibilityRequestTimeoutMs),
				]);
				let entry: DirectoryCompatibilityState;
				try {
					const result = await checkOriginalMedia(file.id, signal, {
						cacheKey: originalCompatibilityKey(file, scope),
						fresh: revision > 0,
					});
					entry = { loading: false, result, error: null };
				} catch (error) {
					entry = { loading: false, result: null, error };
				}
				if (controller.signal.aborted) return;
				setState((current) =>
					current.identity === identity
						? { identity, entries: { ...current.entries, [file.id]: entry } }
						: current,
				);
			}
		}
		void Promise.all(
			Array.from(
				{
					length: Math.min(
						files.length,
						interactionPolicy.compatibilityConcurrency,
					),
				},
				work,
			),
		);
		return () => controller.abort();
	}, [identity]);
	return {
		get: (id: string) =>
			state.identity === identity ? (state.entries[id] ?? checking) : checking,
		retry: () => setRevision((value) => value + 1),
	};
}
