import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type {
	AnimeLibraryResponse,
	TrackingAccountResponse,
} from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { TrackingFeedback } from "../../tracking/public.js";

export function LibraryTrackingControls({
	account,
	snapshot,
	refresh,
}: {
	account: TrackingAccountResponse | undefined;
	snapshot: AnimeLibraryResponse["tracking"] | undefined;
	refresh: { isPending: boolean; error: Error | null; mutate(): void };
}) {
	const { t } = useTranslation();
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-end gap-3">
				{account?.account ? (
					<Button
						variant="outline"
						disabled={
							refresh.isPending ||
							snapshot?.refreshing ||
							account.state !== "connected"
						}
						onClick={() => refresh.mutate()}
					>
						{t("trackingList.refresh")}
					</Button>
				) : (
					<Link to="/settings" className="text-sm underline">
						{t("trackingList.connect")}
					</Link>
				)}
			</div>
			{snapshot && <TrackingFeedback snapshot={snapshot} />}
			{refresh.error && (
				<p role="alert" className="text-sm">
					{t("trackingList.failed")}
				</p>
			)}
		</div>
	);
}
