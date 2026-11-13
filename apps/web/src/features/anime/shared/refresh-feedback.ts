import type { QueryClient } from "@tanstack/react-query";
import { toast } from "../../../shared/components/ui/toast.js";

interface RefreshFailure {
	code: string;
	retryAt: number | null;
}
const failures = new WeakMap<QueryClient, Map<string, string>>();
const maximumRememberedFailures = 200;

/** Share failure identity across filters and detail views; never notify on polling alone. */
export function reportRefreshFailure(
	client: QueryClient,
	options: {
		id: string;
		failure: RefreshFailure | null;
		fetchedAt: number | null;
		title: string;
		manual?: boolean;
	},
): void {
	let seen = failures.get(client);
	if (!seen) {
		seen = new Map();
		failures.set(client, seen);
		const cache = client.getQueryCache();
		const signatures = seen;
		cache.subscribe((event) => {
			if (event.type === "removed" && cache.getAll().length === 0)
				signatures.clear();
		});
	}
	if (!options.failure) {
		if (seen.delete(options.id)) toast.close(options.id);
		return;
	}
	const signature = JSON.stringify([
		options.failure.code,
		options.failure.retryAt,
		options.fetchedAt,
	]);
	if (!options.manual && seen.get(options.id) === signature) return;
	seen.delete(options.id);
	seen.set(options.id, signature);
	if (seen.size > maximumRememberedFailures) {
		const oldest = seen.keys().next().value;
		if (oldest !== undefined) seen.delete(oldest);
	}
	toast.close(options.id);
	toast.add({
		id: options.id,
		type: "error",
		priority: "high",
		title: options.title,
	});
}
