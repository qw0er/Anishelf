import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { request } from "../../../shared/api/client.js";
import type { TrackingOperationsResponse } from "../../../shared/api/contracts.js";
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
		const state = `${op.revision}:${op.state}:${op.error}`;
		const previous = states.get(key);
		if (previous === state) continue;
		states.set(key, state);
		const id = `tracking-operation:${op.id}`;
		if (
			op.origin === "manual-detail" &&
			(["pending", "submitting"].includes(op.state) ||
				(previous && ["succeeded", "cancelled"].includes(op.state)))
		) {
			toast.close(id);
			toast.add({
				id,
				type:
					op.state === "succeeded" || op.state === "cancelled"
						? "success"
						: "loading",
				title: i18n.t(`trackingUpdate.states.${op.state}`),
				...(op.state === "pending" || op.state === "submitting"
					? { timeout: 0 }
					: {}),
			});
			if (op.state === "succeeded")
				void invalidateAnimeQueries(client, "viewing");
			continue;
		}
		if (op.state === "cancelled") {
			toast.close(id);
			continue;
		}
		if (op.state === "succeeded" || op.state === "authorization-required") {
			void invalidateAnimeQueries(client, "viewing");
		}
		if (
			![
				"failed",
				"authorization-required",
				"conflict",
				"decision-required",
			].includes(op.state)
		) {
			toast.close(id);
			continue;
		}
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
