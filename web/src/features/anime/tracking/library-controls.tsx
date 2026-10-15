import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type {
	AnimeLibraryResponse,
	TrackingAccountResponse,
} from "../../../shared/api/contracts.js";
import { Button } from "../../../shared/components/ui/button.js";
import { refreshTrackingList } from "./queries.js";
import { TrackingFeedback } from "./viewing-state.js";

interface Filters {
	scope?: "local" | "all";
	viewingStatus?: string;
}
export function LibraryTrackingControls({
	filters,
	onChange,
	account,
	snapshot,
}: {
	filters: Filters;
	onChange(key: string, value: string): void;
	account: TrackingAccountResponse | undefined;
	snapshot: AnimeLibraryResponse["tracking"] | undefined;
}) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const refresh = useMutation({
		mutationFn: () => refreshTrackingList(account?.generation ?? ""),
		onSettled: async () => {
			await Promise.all([
				client.invalidateQueries({ queryKey: ["tracking"] }),
				client.invalidateQueries({
					predicate: (query) =>
						query.queryKey[0] === "catalog" && query.queryKey[2] === "list",
				}),
			]);
		},
	});
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-end gap-3">
				<label className="min-w-0 space-y-1 text-sm">
					<span>{t("trackingList.scope")}</span>
					<select
						className="form-select block w-full"
						value={filters.scope ?? "local"}
						onChange={(event) => onChange("scope", event.target.value)}
					>
						<option value="local">{t("trackingList.local")}</option>
						<option value="all">{t("trackingList.all")}</option>
					</select>
				</label>
				<label className="min-w-0 space-y-1 text-sm">
					<span>{t("trackingList.viewingState")}</span>
					<select
						className="form-select block w-full"
						value={filters.viewingStatus ?? ""}
						onChange={(event) => onChange("viewingStatus", event.target.value)}
						disabled={!account?.account}
					>
						<option value="">{t("trackingList.allStatuses")}</option>
						{[
							"CURRENT",
							"PLANNING",
							"COMPLETED",
							"PAUSED",
							"DROPPED",
							"REPEATING",
							"untracked",
						].map((status) => (
							<option key={status} value={status}>
								{t(
									status === "untracked"
										? "trackingList.untracked"
										: `trackingList.statuses.${status}`,
								)}
							</option>
						))}
					</select>
				</label>
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
