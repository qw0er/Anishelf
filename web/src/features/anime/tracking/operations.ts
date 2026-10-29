import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { request } from "../../../shared/api/client.js";
import type {
	TrackingEpisodeTargetResponse,
	TrackingOperationResponse,
	TrackingOperationsResponse,
} from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
import { toast } from "../../../shared/components/ui/toast.js";
import i18n from "../../../shared/i18n.js";
import { invalidateAnimeQueries } from "../shared/query-keys.js";
import type { TrackingIdentity } from "./queries.js";

const seen = new WeakMap<QueryClient, Map<string, string>>();
export const operationsQuery = (
	identity: TrackingIdentity,
	watchForNew = false,
) =>
	queryOptions({
		queryKey: [
			"tracking",
			"operations",
			identity.accountId,
			identity.generation,
		],
		queryFn: async ({ signal, client }) => {
			const operations = await request<TrackingOperationsResponse>(
				`/api/tracking/operations?${new URLSearchParams({ generation: identity.generation })}`,
				"GET",
				{ signal: boundedSignal(signal) },
			);
			signal.throwIfAborted();
			reportTrackingOperations(client, identity, operations);
			return operations;
		},
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			query.state.data?.some(
				(op) =>
					op.state === "pending" ||
					op.state === "submitting" ||
					(op.state === "failed" && op.retryAt !== null),
			)
				? 1500
				: watchForNew
					? 10000
					: 60_000,
		retry: false,
	});
/** Results are announced once and then leave the controls; history is never replayed. */
export function isResultState(
	state: TrackingOperationResponse["state"],
): boolean {
	return state === "succeeded" || state === "cancelled";
}
/** Detail edits apply to the whole work; player commands only to their own episode. */
export function appliesToEpisode(
	operation: TrackingOperationResponse,
	target: Pick<TrackingEpisodeTargetResponse, "fileId" | "sourceVersion">,
): boolean {
	return (
		operation.target === null ||
		(operation.target.fileId === target.fileId &&
			operation.target.sourceVersion === target.sourceVersion)
	);
}
function resultTitle(operation: TrackingOperationResponse): string {
	if (operation.state === "cancelled")
		return i18n.t("trackingUpdate.states.cancelled");
	const episode = operation.target?.episode;
	if (episode !== undefined)
		return i18n.t("trackingUpdate.results.episode", { episode });
	const progress = operation.desired.progress ?? operation.remote?.progress;
	return progress === undefined
		? i18n.t("trackingUpdate.states.succeeded")
		: i18n.t("trackingUpdate.results.progress", { progress });
}
export function reportTrackingOperations(
	client: QueryClient,
	identity: TrackingIdentity,
	operations: TrackingOperationsResponse,
): void {
	let states = seen.get(client);
	if (!states) {
		states = new Map();
		seen.set(client, states);
	}
	const current = new Set(
		operations.map((op) => `${identity.generation}:${op.id}`),
	);
	for (const key of states.keys())
		if (!current.has(key)) {
			toast.close(`tracking-operation:${key.slice(key.indexOf(":") + 1)}`);
			states.delete(key);
		}
	for (const op of operations) {
		const key = `${identity.generation}:${op.id}`;
		const observed = `${op.revision}:${op.state}:${op.error}`;
		const previous = states.get(key);
		if (previous === observed) continue;
		states.set(key, observed);
		const id = `tracking-operation:${op.id}`;
		if (op.state === "pending" || op.state === "submitting") {
			toast.close(id);
			// An automatic handoff never asks for attention; only commands the user
			// issued keep an in-flight notice alive.
			if (op.origin === "automatic") continue;
			toast.add({
				id,
				type: "loading",
				title: i18n.t(`trackingUpdate.states.${op.state}`),
				timeout: 0,
			});
			continue;
		}
		if (isResultState(op.state)) {
			toast.close(id);
			if (op.state === "succeeded")
				void invalidateAnimeQueries(client, "viewing");
			// Reading stored results on mount is not a new result: stay silent.
			if (!previous || op.origin === "automatic") continue;
			console.debug("[Tracking] Operation result notified.", {
				operationId: op.id,
				origin: op.origin,
				state: op.state,
				revision: op.revision,
			});
			toast.add({ id, type: "success", title: resultTitle(op) });
			continue;
		}
		if (op.state === "authorization-required")
			void invalidateAnimeQueries(client, "viewing");
		const notice = {
			id,
			type: "error" as const,
			title: i18n.t(`trackingUpdate.states.${op.state}`),
			timeout: 10000,
			actionProps: {
				children: i18n.t("trackingUpdate.edit"),
				onClick: () => window.location.assign(`/anime/tracked/${op.mediaId}`),
			},
		};
		toast.add(notice);
		if (op.state === "authorization-required")
			void client.invalidateQueries({ queryKey: ["tracking", "account"] });
	}
}
export function clearTrackingOperationNotices(
	client: QueryClient,
	generation: string,
): void {
	const states = seen.get(client);
	if (!states) return;
	for (const key of states.keys())
		if (key.startsWith(`${generation}:`)) {
			toast.close(`tracking-operation:${key.slice(generation.length + 1)}`);
			states.delete(key);
		}
}
