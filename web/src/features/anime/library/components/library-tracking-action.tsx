import { Link2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type {
	AnimeLibraryResponse,
	TrackingAccountResponse,
} from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import { TrackingRefreshHint } from "../../tracking/public.js";

export function LibraryTrackingAction({
	account,
	snapshot,
	refresh,
}: {
	account: TrackingAccountResponse | undefined;
	snapshot: AnimeLibraryResponse["tracking"] | undefined;
	refresh: { isPending: boolean; mutate(): void };
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	if (!account?.account)
		return (
			<Tooltip content={t("trackingList.connect")}>
				<Button
					variant="outline"
					className="shrink-0 px-2 sm:px-4"
					aria-label={t("trackingList.connect")}
					onClick={() => void navigate("/settings")}
				>
					<Link2 className="size-4" aria-hidden="true" />
					<span className="hidden sm:inline">{t("trackingList.connect")}</span>
				</Button>
			</Tooltip>
		);
	const refreshing = refresh.isPending || Boolean(snapshot?.refreshing);
	return (
		<Tooltip
			content={
				<TrackingRefreshHint snapshot={snapshot} refreshing={refreshing} />
			}
		>
			<Button
				variant="outline"
				className="size-9 shrink-0 p-0"
				disabled={refreshing || account.state !== "connected"}
				onClick={() => refresh.mutate()}
				aria-label={t("trackingList.refresh")}
				aria-busy={refreshing}
			>
				<RefreshCw
					className={refreshing ? "size-4 animate-spin" : "size-4"}
					aria-hidden="true"
				/>
			</Button>
		</Tooltip>
	);
}
