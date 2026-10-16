import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { ApiClientError } from "../../../shared/api/client.js";
import type {
	TrackingAccountResponse,
	TrackingOperationResponse,
	TrackingOperationsResponse,
} from "../../../shared/api/contracts.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { operationsQuery, reportTrackingOperations } from "./operations.js";
import { accountQuery, type TrackingIdentity } from "./queries.js";

/** One command lifecycle for detail edits and player actions, including ambiguous retries. */
export function useTrackingMutation<T>(
	identity: TrackingIdentity,
	send: (input: T, commandId: string) => Promise<TrackingOperationResponse>,
	requestKey?: unknown,
) {
	const client = useQueryClient();
	const request = useRef<{ key: string; id: string } | null>(null);
	return useMutation({
		mutationFn: (input: T) => {
			const key = JSON.stringify([identity, input, requestKey]);
			if (request.current?.key !== key)
				request.current = { key, id: crypto.randomUUID() };
			return send(input, request.current.id);
		},
		onSuccess: (result) => {
			request.current = null;
			const current = client.getQueryData<TrackingAccountResponse>(
				accountQuery().queryKey,
			);
			if (current && current.generation !== identity.generation) return;
			client.setQueryData<TrackingOperationsResponse>(
				operationsQuery(identity).queryKey,
				(previous) => [
					...(previous ?? []).filter((op) => op.id !== result.id),
					result,
				],
			);
			reportTrackingOperations(client, identity, [result]);
			void client.invalidateQueries({ queryKey: ["tracking", "operations"] });
			void client.invalidateQueries({ queryKey: ["tracking", "entry"] });
			void client.invalidateQueries({ queryKey: ["anime-library"] });
		},
		onError: (error: Error) => {
			if (
				!(
					error instanceof ApiClientError &&
					(error.status === 400 || error.status === 409)
				)
			)
				toast.add({ type: "error", title: error.message });
		},
	});
}
