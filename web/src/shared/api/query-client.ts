import {
	type FetchQueryOptions,
	hashKey,
	QueryClient,
	type QueryKey,
} from "@tanstack/react-query";

export function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				retry: false,
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
			},
			mutations: { retry: false },
		},
	});
}
export const queryClient = createQueryClient();

const consumers = new WeakMap<QueryClient, Map<string, number>>();
/** A departing router consumer stops waiting without cancelling other observers/loaders. */
export async function loadQuery<T, K extends QueryKey>(
	options: FetchQueryOptions<T, Error, T, K>,
	signal: AbortSignal,
	client: QueryClient = queryClient,
) {
	signal.throwIfAborted();
	let counts = consumers.get(client);
	if (!counts) {
		counts = new Map();
		consumers.set(client, counts);
	}
	const hash = hashKey(options.queryKey);
	counts.set(hash, (counts.get(hash) ?? 0) + 1);
	let abort = () => {};
	const cancelled = new Promise<never>((_resolve, reject) => {
		abort = () => {
			const query = client
				.getQueryCache()
				.find({ queryKey: options.queryKey, exact: true });
			if (!query?.getObserversCount() && (counts.get(hash) ?? 0) <= 1)
				void client.cancelQueries({ queryKey: options.queryKey, exact: true });
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([client.fetchQuery(options), cancelled]);
	} finally {
		signal.removeEventListener("abort", abort);
		const remaining = (counts.get(hash) ?? 1) - 1;
		if (remaining) counts.set(hash, remaining);
		else {
			counts.delete(hash);
			if (
				signal.aborted &&
				!client
					.getQueryCache()
					.find({ queryKey: options.queryKey, exact: true })
					?.getObserversCount()
			)
				void client.cancelQueries({ queryKey: options.queryKey, exact: true });
		}
	}
}

/** Commands execute once; progress writes use their own serial protocol instead. */
export function executeMutation<T>(action: () => Promise<T>) {
	return queryClient
		.getMutationCache()
		.build(queryClient, { mutationFn: action, retry: false })
		.execute(undefined);
}
