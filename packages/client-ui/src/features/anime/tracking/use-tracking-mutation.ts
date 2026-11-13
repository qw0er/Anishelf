import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isRequestCancelled } from "../../../shared/api/client.js";
import type {
	TrackingAccountResponse,
	TrackingOperationResponse,
	TrackingOperationsResponse,
} from "../../../shared/api/contracts.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";
import { invalidateAnimeQueries } from "../shared/query-keys.js";
import { operationsQuery, reportTrackingOperations } from "./operations.js";
import { accountQuery, type TrackingIdentity } from "./queries.js";

/** One command lifecycle for detail edits and player actions, including ambiguous retries. */
export function useTrackingMutation<T>(
	identity: TrackingIdentity,
	send: (input: T, commandId: string) => Promise<TrackingOperationResponse>,
	requestKey?: unknown,
) {
	const { t } = useTranslation();
	const controlId = useId();
	const noticeId = `tracking-command:${identity.generation}:${controlId}`;
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			toast.close(noticeId);
		};
	}, [noticeId]);
	const client = useQueryClient();
	const request = useRef<{ key: string; id: string } | null>(null);
	const mutation = useMutation({
		onMutate: () => toast.close(noticeId),
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
			// Report the merged queue, not just this command: unrelated pending work
			// must keep its state.
			const operations = client.getQueryData<TrackingOperationsResponse>(
				operationsQuery(identity).queryKey,
			);
			reportTrackingOperations(client, identity, operations ?? [result]);
			void invalidateAnimeQueries(client, "viewing");
		},
		onError: (error: Error, input) => {
			if (isRequestCancelled(error) || !mounted.current) return;
			console.warn("[Tracking] Command submission failed.", {
				generation: identity.generation,
			});
			toast.add({
				id: noticeId,
				type: "error",
				title: t("playbackCompletion.submitFailed"),
				description: t(getErrorTranslationKey(error) ?? "errors.requestFailed"),
				actionProps: {
					children: t("actions.retry"),
					onClick: () => mutation.mutate(input),
				},
			});
		},
	});
	return mutation;
}
