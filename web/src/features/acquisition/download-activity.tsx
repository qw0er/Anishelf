import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type {
	DownloadActivity,
	SubscriptionView,
} from "../../shared/api/contracts.js";
import { boundedSignal } from "../../shared/api/queries.js";
import { Button, buttonStyles } from "../../shared/components/ui/button.js";
import { toast } from "../../shared/components/ui/toast.js";
import { settingsQuery } from "../settings/public.js";
import {
	downloadKeys,
	getDownloadActivity,
	retryDownload,
} from "./downloads-api.js";

const notificationErrors = new Map<string, string>();
function status(item: DownloadActivity["items"][number]) {
	if (item.error && item.state !== "missing")
		return item.ingestion === "failed"
			? "Import failed"
			: item.ingestion === "review"
				? "Review required"
				: "Acquisition needs attention";
	if (item.state === "available") return "Available";
	if (item.state === "missing") return "Removed in qBittorrent";
	if (item.ingestion === "validating") return "Importing";
	if (item.state === "unknown" || item.state === "submitting")
		return "Confirming submission";
	if (item.state === "pending") return "Waiting to submit";
	if (/paused|stopped/i.test(item.transfer ?? ""))
		return "Paused in qBittorrent";
	if (/error|missing/i.test(item.transfer ?? ""))
		return "Download error · Open WebUI";
	if (/checking/i.test(item.transfer ?? "")) return "Checking in qBittorrent";
	if (/meta/i.test(item.transfer ?? "")) return "Fetching torrent metadata";
	if (/queued/i.test(item.transfer ?? "")) return "Queued in qBittorrent";
	if (item.progress === 1) return "Downloaded · Awaiting verification";
	return item.progress === null
		? "Downloading"
		: `Downloading ${Math.round(item.progress * 100)}%`;
}
const errors: Record<string, string> = {
	downloader_configuration_changed:
		"Save and validate the destination for the new API connection, confirm the subscription scope, then retry acquisition to reconcile the saved task.",
	release_evidence_changed:
		"Current metadata no longer confirms this release and episode. Refresh the subscription scope.",
	episode_downloading:
		"Another download already covers this episode. Check WebUI before retrying.",
	selection_changed:
		"The selected release changed. Confirm the current subscription scope and retry acquisition.",
	association_changed:
		"The library association changed. Check local Review before retrying import.",
	torrent_reserved: "This torrent is already reserved by another acquisition.",
	torrent_identity_conflict:
		"The torrent identity differs from the feed evidence.",
	invalid_file_path: "The torrent contains an unsupported file path.",
	torrent_unavailable:
		"The torrent could not be read. Acquisition will retry automatically.",
	externally_removed: "Use Retry acquisition to add this episode again.",
	external_task_conflict:
		"An existing task is not managed by Anishelf. Resolve it in WebUI.",
	submission_unconfirmed:
		"The submission result is uncertain. Automatic resubmission is stopped; check WebUI before retrying.",
	unsupported_file_layout:
		"The downloaded files are not a supported single-episode layout.",
	association_requires_review:
		"The actual file needs local Review before it can be linked.",
	source_changed:
		"The source file changed. Verify the files before retrying import.",
	file_size_conflict:
		"The local file size differs from the completed download.",
	task_path_changed:
		"The task save path changed in qBittorrent. Restore it before retrying.",
	incomplete_directory_required:
		"Configure a separate incomplete directory and validate the destination in Settings.",
};
export function DownloadActivityPanel({
	workKey,
	view,
	reason,
	onConfigure,
}: {
	workKey: string;
	view: SubscriptionView;
	reason(code: string): string;
	onConfigure(): void;
}) {
	const client = useQueryClient(),
		[page, setPage] = useState(1);
	const settings = useQuery(settingsQuery());
	const query = useQuery({
		queryKey: [...downloadKeys, workKey, page],
		queryFn: ({ signal }) =>
			getDownloadActivity(workKey, page, { signal: boundedSignal(signal) }),
		refetchInterval: 5_000,
	});

	useEffect(() => {
		for (const item of query.data?.items ?? []) {
			if (!item.error) {
				notificationErrors.delete(item.id);
				continue;
			}
			if (notificationErrors.get(item.id) === item.error) continue;
			notificationErrors.set(item.id, item.error);
			if (notificationErrors.size > 2000)
				notificationErrors.delete(notificationErrors.keys().next().value ?? "");
			toast.add({
				title: `Episode ${item.episode}: ${status(item)}.`,
				type: "error",
			});
		}
	}, [query.data]);
	const retry = useMutation({
		mutationFn: (input: {
			id: string;
			revision: string;
			kind: "import" | "acquisition";
		}) => retryDownload(input.id, input.revision, input.kind),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: downloadKeys });
			toast.add({ title: "Retry queued.", type: "success" });
		},
		onError: () => {
			void client.invalidateQueries({ queryKey: downloadKeys });
			toast.add({
				title: "Could not retry. Refresh and check configuration.",
				type: "error",
			});
		},
	});
	const tasks = query.data?.items ?? [],
		ids = new Set(
			query.data?.managedCandidateIds ?? tasks.map((item) => item.candidateId),
		);
	const webui = settings.data?.qbittorrentWebUiUrl;
	return (
		<div className="space-y-2">
			<div className="action-row justify-between text-sm">
				<span>
					{query.data?.active
						? `${query.data.active} active`
						: "Automatic acquisition"}
				</span>
				{webui && (
					<a
						className={buttonStyles("outline")}
						href={webui}
						target="_blank"
						rel="noopener noreferrer"
					>
						Open WebUI
					</a>
				)}
			</div>
			{query.isError && (
				<p role="alert" className="text-sm">
					Acquisition status unavailable.{" "}
					<Button variant="outline" onClick={() => void query.refetch()}>
						Retry status
					</Button>
				</p>
			)}
			{view.subscription &&
				query.data &&
				!query.data.authorized &&
				view.subscription.enabled && (
					<p className="text-sm">
						Discovery only.{" "}
						<Button variant="outline" onClick={onConfigure}>
							Confirm download scope
						</Button>
					</p>
				)}
			<details>
				<summary className="cursor-pointer text-sm">
					Activity · {query.data?.total ?? 0} acquisitions · {view.total}{" "}
					releases
					{query.data?.attention
						? ` · ${query.data.attention} need attention`
						: ""}
				</summary>
				<div className="space-y-3 pt-3">
					{tasks.map((item) => (
						<div className="space-y-1 border-b py-2 text-sm" key={item.id}>
							<p>
								Episode {item.episode} · {status(item)}
							</p>
							{item.title && (
								<p
									className="truncate text-muted-foreground"
									title={item.title}
								>
									{item.title}
								</p>
							)}
							{item.observedAt !== null &&
								Date.now() - item.observedAt > 60_000 &&
								item.state === "bound" && (
									<p className="text-muted-foreground">
										Downloader observation is stale.
									</p>
								)}
							{item.error && (
								<p role="status">
									{errors[item.error] ??
										"Check the downloader connection and mapped files, then retry."}
								</p>
							)}
							<div className="action-row">
								{item.ingestion === "review" && (
									<Link className={buttonStyles("outline")} to="/review">
										Open Review
									</Link>
								)}
								{item.error && (
									<Link className={buttonStyles("outline")} to="/settings">
										Settings
									</Link>
								)}
								{(item.ingestion === "failed" ||
									item.ingestion === "review") && (
									<Button
										variant="outline"
										disabled={retry.isPending}
										onClick={() =>
											retry.mutate({
												id: item.id,
												revision: item.revision,
												kind: "import",
											})
										}
									>
										Retry import
									</Button>
								)}
								{(["missing", "blocked", "unknown"].includes(item.state) ||
									(item.state === "pending" && item.error !== null)) && (
									<Button
										variant="outline"
										disabled={
											retry.isPending || !query.data?.authorized || !item.title
										}
										onClick={() =>
											retry.mutate({
												id: item.id,
												revision: item.revision,
												kind: "acquisition",
											})
										}
									>
										Retry acquisition
									</Button>
								)}
							</div>
						</div>
					))}
					{(query.data?.total ?? 0) > 20 && (
						<div className="action-row">
							<Button
								variant="outline"
								disabled={page === 1}
								onClick={() => setPage(page - 1)}
							>
								Previous acquisitions
							</Button>
							<span>Page {page}</span>
							<Button
								variant="outline"
								disabled={page * 20 >= (query.data?.total ?? 0)}
								onClick={() => setPage(page + 1)}
							>
								Next acquisitions
							</Button>
						</div>
					)}
					{view.candidates
						.filter((candidate) => !ids.has(candidate.id))
						.map((candidate) => (
							<div className="border-b py-2 text-sm" key={candidate.id}>
								<p className="truncate" title={candidate.title}>
									{candidate.title}
								</p>
								<p className="text-muted-foreground">
									{candidate.episode ? `Episode ${candidate.episode} · ` : ""}
									{candidate.status === "selected"
										? "Selected"
										: `Skipped · ${candidate.reasons.map(reason).join("; ")}`}
								</p>
							</div>
						))}
				</div>
			</details>
		</div>
	);
}
