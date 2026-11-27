import type { QueryClient } from "@tanstack/react-query";
import { downloadKeys } from "./downloads-api.js";
import { subscriptionKeys } from "./subscriptions-api.js";
import { watchingKey } from "./watching-api.js";

export async function refreshAcquisitionState(queryClient: QueryClient) {
	await Promise.all(
		[subscriptionKeys, downloadKeys, watchingKey].map((queryKey) =>
			queryClient.invalidateQueries({ queryKey }, { throwOnError: true }),
		),
	);
}
