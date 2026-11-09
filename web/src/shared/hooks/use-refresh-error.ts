import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { isRequestCancelled } from "../api/client.js";
import { toast } from "../components/ui/toast.js";

interface Failure {
	signature: string;
	retryAfter?: number;
}
const failures = new WeakMap<object, Map<string, Failure>>();
const scopes = new WeakMap<object, Map<string, number>>();

/** Keep polling failures quiet across navigation until recovery or an explicit retry. */
export function useRefreshError(
	id: string,
	error: unknown,
	updatedAt: number,
	retry?: () => void,
	options?: { scoped?: boolean; title?: string },
) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const scoped = options?.scoped;
	const title = options?.title;
	useEffect(() => {
		if (!scoped) return;
		let active = scopes.get(client);
		if (!active) {
			active = new Map();
			scopes.set(client, active);
		}
		active.set(id, (active.get(id) ?? 0) + 1);
		return () => {
			const remaining = (active.get(id) ?? 1) - 1;
			if (remaining) active.set(id, remaining);
			else {
				active.delete(id);
				toast.close(id);
			}
		};
	}, [client, id, scoped]);
	useEffect(() => {
		let seen = failures.get(client);
		if (!seen) {
			seen = new Map();
			failures.set(client, seen);
			const remembered = seen;
			const cache = client.getQueryCache();
			cache.subscribe((event) => {
				if (event.type === "removed" && cache.getAll().length === 0) {
					for (const id of remembered.keys()) toast.close(id);
					remembered.clear();
				}
			});
		}
		if (!error) {
			seen.delete(id);
			toast.close(id);
			return;
		}
		if (isRequestCancelled(error)) return;
		const signature = error instanceof Error ? error.message : String(error);
		const previous = seen.get(id);
		if (previous?.retryAfter !== undefined && updatedAt <= previous.retryAfter)
			return;
		if (previous?.signature === signature && previous.retryAfter === undefined)
			return;
		seen.set(id, { signature });
		if (seen.size > 100) {
			const oldest = seen.keys().next().value;
			if (oldest !== undefined) seen.delete(oldest);
		}
		console.warn("UI background refresh failed", { operation: id, updatedAt });
		toast.add({
			id,
			type: "error",
			title: title ?? t("errors.requestFailed"),
			...(retry
				? {
						actionProps: {
							children: t("actions.retry"),
							onClick: () => {
								seen.set(id, { signature, retryAfter: updatedAt });
								toast.close(id);
								retry();
							},
						},
					}
				: {}),
		});
	}, [client, id, error, updatedAt, t, retry, title]);
}
