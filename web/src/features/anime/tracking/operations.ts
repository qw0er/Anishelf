import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { request } from "../../../shared/api/client.js";
import type { TrackingOperationsResponse } from "../../../shared/api/contracts.js";
import { boundedSignal } from "../../../shared/api/queries.js";
import { toast } from "../../../shared/components/ui/toast.js";
import i18n from "../../../shared/i18n.js";
import type { TrackingIdentity } from "./queries.js";

const seen = new WeakMap<QueryClient, Map<string, string>>();
export const operationsQuery = (identity: TrackingIdentity) =>
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
		refetchInterval: (query) =>
			query.state.data?.some(
				(op) =>
					op.state === "pending" ||
					op.state === "submitting" ||
					(op.state === "failed" && op.retryAt !== null),
			)
				? 1500
				: 10000,
		retry: false,
	});
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
	for (const op of operations) {
		const key = `${identity.generation}:${op.id}`;
		const state = `${op.revision}:${op.state}:${op.error}`;
		if (states.get(key) === state) continue;
		const prior = states.get(key);
		states.set(key, state);
		const id = `tracking-operation:${op.id}`;
		if (op.state === "cancelled") {
			toast.close(id);
			continue;
		}
		if (op.state === "succeeded" && !prior) continue;
		const notice = {
			id,
			type:
				op.state === "succeeded"
					? ("success" as const)
					: op.state === "pending" || op.state === "submitting"
						? ("loading" as const)
						: ("error" as const),
			title: i18n.t(`trackingUpdate.states.${op.state}`),
			timeout: op.state === "pending" || op.state === "submitting" ? 0 : 10000,
			actionProps: {
				children: i18n.t("trackingUpdate.edit"),
				onClick: () => window.location.assign(`/anime/tracked/${op.mediaId}`),
			},
		};
		if (prior) toast.update(id, notice);
		else toast.add(notice);
		if (op.state === "succeeded" || op.state === "authorization-required") {
			if (op.state === "authorization-required")
				void client.invalidateQueries({ queryKey: ["tracking", "account"] });
			void client.invalidateQueries({ queryKey: ["anime-library"] });
			void client.invalidateQueries({ queryKey: ["tracking", "entry"] });
		}
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
