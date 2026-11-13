import { useSearchParams } from "react-router";
import { SubscriptionPanel } from "../../features/acquisition/ui.js";
import type { AnimeStatusState } from "../../features/anime/public.js";

/** App owns the detail URL action used by acquisition notifications. */
export function WorkAcquisitionPanel({
	workKey,
	status,
}: {
	workKey: string;
	status: AnimeStatusState;
}) {
	const [params, setParams] = useSearchParams();
	return (
		<SubscriptionPanel
			workKey={workKey}
			status={status}
			activityRequested={params.get("activity") === "downloads"}
			onActivityClose={() =>
				setParams(
					(previous) => {
						const next = new URLSearchParams(previous);
						next.delete("activity");
						return next;
					},
					{ replace: true },
				)
			}
		/>
	);
}
