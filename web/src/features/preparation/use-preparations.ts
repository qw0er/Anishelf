import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keys, tasksQuery, useQueryScope } from "../../api/queries.js";
import { toast } from "../../components/ui/toast.js";
import { interactionPolicy } from "../../config/interaction-policy.js";
import { preparationPolicy } from "../../config/media-policy.js";
import { getErrorTranslationKey } from "../../lib/error-translation.js";

export function usePreparations(fileId?: string, enabled = true) {
	const scope = useQueryScope();
	const client = useQueryClient();
	const [expandedScope, setExpandedScope] = useState<string | null>(null);
	const more = expandedScope === scope;
	const query = useQuery({
		...tasksQuery(scope, fileId, more),
		enabled,
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[1] === scope &&
			previousQuery?.queryKey[3] === (fileId ?? null)
				? keepPreviousData(previous)
				: undefined,
	});
	return {
		tasks: enabled ? (query.data?.tasks ?? []) : [],
		loading: enabled && query.isPending,
		loadingMore: more && query.isFetching,
		canLoadMore:
			(!more &&
				(query.data?.tasks.length ?? 0) >=
					preparationPolicy.initialListLimit) ||
			(more && query.isError),
		loadMore: () => {
			if (more) void query.refetch();
			else setExpandedScope(scope);
		},
		error: query.error,
		refresh: useCallback(() => {
			void client.invalidateQueries({ queryKey: keys.tasks(scope, fileId) });
		}, [client, scope, fileId]),
	};
}

/** Abort client requests on departure; server jobs are cancelled only explicitly. */
export function usePreparationAction() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const mutation = useMutation({
		mutationFn: (action: () => Promise<void>) => action(),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: keys.preparations });
		},
	});
	const notificationId = `preparation-action:${useId()}`;
	const active = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			active.current?.abort();
			toast.close(notificationId);
		};
	}, [notificationId]);
	async function run(action: (signal: AbortSignal) => Promise<void>) {
		if (active.current) return;
		const controller = new AbortController();
		active.current = controller;
		toast.close(notificationId);
		try {
			await mutation.mutateAsync(() =>
				action(
					AbortSignal.any([
						controller.signal,
						AbortSignal.timeout(interactionPolicy.preparationRequestTimeoutMs),
					]),
				),
			);
		} catch (cause) {
			if (!controller.signal.aborted && mounted.current)
				toast.add({
					id: notificationId,
					type: "error",
					priority: "high",
					title: t(getErrorTranslationKey(cause) ?? "errors.requestFailed"),
				});
		} finally {
			if (active.current === controller) active.current = null;
		}
	}
	return { busy: mutation.isPending, run };
}
