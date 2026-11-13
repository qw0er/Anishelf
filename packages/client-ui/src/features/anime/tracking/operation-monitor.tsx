import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
	clearTrackingOperationNotices,
	operationsQuery,
} from "./operations.js";
import { accountQuery, trackingIdentity } from "./queries.js";
/** Continues result/failure notifications after leaving the editing page. */
export function TrackingOperationMonitor() {
	const client = useQueryClient();
	const account = useQuery(accountQuery());
	const generation = account.data?.generation;
	useEffect(
		() => () => {
			if (generation) clearTrackingOperationNotices(client, generation);
		},
		[client, generation],
	);
	useQuery({
		...operationsQuery(
			account.data
				? trackingIdentity(account.data)
				: { accountId: null, generation: "" },
		),
		enabled: Boolean(account.data?.account),
	});
	return null;
}
