import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type {
	DownloadActivity,
	SubscriptionView,
} from "../../shared/api/contracts.js";
import { boundedSignal } from "../../shared/api/queries.js";
import { Button, buttonStyles } from "../../shared/components/ui/button.js";
import { toast } from "../../shared/components/ui/toast.js";
import { invalidateAnimeQueries } from "../anime/public.js";
import { settingsQuery } from "../settings/public.js";
import {
	downloadKeys,
	getDownloadActivity,
	retryDownload,
} from "./downloads-api.js";

const notificationErrors = new Map<string, string>();
function status(item: DownloadActivity["items"][number], t: TFunction): string {
	if (item.error && item.state !== "missing")
		return item.ingestion === "failed"
			? t("acquisition.activity.importFailed")
			: item.ingestion === "review"
				? t("acquisition.activity.reviewRequired")
				: t("acquisition.activity.needsAttention");
	if (item.state === "available") return t("acquisition.activity.available");
	if (item.state === "missing")
		return t("acquisition.activity.removedInQbittorrent");
	if (item.ingestion === "validating")
		return t("acquisition.activity.importing");
	if (item.state === "unknown" || item.state === "submitting")
		return t("acquisition.activity.confirmingSubmission");
	if (item.state === "pending")
		return t("acquisition.activity.waitingToSubmit");
	if (/paused|stopped/i.test(item.transfer ?? ""))
		return t("acquisition.activity.paused");
	if (/error|missing/i.test(item.transfer ?? ""))
		return t("acquisition.activity.downloadError");
	if (/checking/i.test(item.transfer ?? ""))
		return t("acquisition.activity.checking");
	if (/meta/i.test(item.transfer ?? ""))
		return t("acquisition.activity.fetchingMetadata");
	if (/queued/i.test(item.transfer ?? ""))
		return t("acquisition.activity.queued");
	if (item.progress === 1) return t("acquisition.activity.downloaded");
	return item.progress === null
		? t("acquisition.activity.downloading")
		: t("acquisition.activity.downloadingPercent", {
				percent: Math.round(item.progress * 100),
			});
}
const errorKeys: Record<string, string> = {
	downloader_configuration_changed:
		"acquisition.activity.errors.downloader_configuration_changed",
	release_evidence_changed:
		"acquisition.activity.errors.release_evidence_changed",
	episode_downloading: "acquisition.activity.errors.episode_downloading",
	selection_changed: "acquisition.activity.errors.selection_changed",
	association_changed: "acquisition.activity.errors.association_changed",
	torrent_reserved: "acquisition.activity.errors.torrent_reserved",
	torrent_identity_conflict:
		"acquisition.activity.errors.torrent_identity_conflict",
	invalid_file_path: "acquisition.activity.errors.invalid_file_path",
	torrent_unavailable: "acquisition.activity.errors.torrent_unavailable",
	externally_removed: "acquisition.activity.errors.externally_removed",
	external_task_conflict: "acquisition.activity.errors.external_task_conflict",
	submission_unconfirmed: "acquisition.activity.errors.submission_unconfirmed",
	unsupported_file_layout:
		"acquisition.activity.errors.unsupported_file_layout",
	association_requires_review:
		"acquisition.activity.errors.association_requires_review",
	source_changed: "acquisition.activity.errors.source_changed",
	file_size_conflict: "acquisition.activity.errors.file_size_conflict",
	task_path_changed: "acquisition.activity.errors.task_path_changed",
	incomplete_directory_required:
		"acquisition.activity.errors.incomplete_directory_required",
};
export function DownloadActivityPanel({
	workKey,
	initialActivity,
	view,
	reason,
	onConfigure,
	releasePagination,
}: {
	workKey: string;
	view: SubscriptionView;
	reason(code: string): string;
	onConfigure(): void;
	releasePagination?: ReactNode;
	initialActivity?: DownloadActivity | null | undefined;
}) {
	const { t } = useTranslation();
	const client = useQueryClient(),
		[page, setPage] = useState(1);
	const settings = useQuery(settingsQuery());
	const query = useQuery({
		queryKey: [...downloadKeys, workKey, page],
		enabled:
			initialActivity !== null && (page !== 1 || initialActivity === undefined),
		initialData: page === 1 ? (initialActivity ?? undefined) : undefined,
		queryFn: ({ signal }) =>
			getDownloadActivity(workKey, page, { signal: boundedSignal(signal) }),
		refetchInterval: 5_000,
	});

	const activity =
		page === 1 && initialActivity !== undefined
			? (initialActivity ?? undefined)
			: query.data;
	useEffect(() => {
		for (const item of activity?.items ?? []) {
			if (!item.error) {
				notificationErrors.delete(item.id);
				continue;
			}
			if (notificationErrors.get(item.id) === item.error) continue;
			notificationErrors.set(item.id, item.error);
			if (notificationErrors.size > 2000)
				notificationErrors.delete(notificationErrors.keys().next().value ?? "");
			toast.add({
				title: t("acquisition.activity.toastEpisode", {
					episode: item.episode,
					status: status(item, t),
				}),
				type: "error",
			});
		}
	}, [activity, t]);
	const retry = useMutation({
		mutationFn: (input: {
			id: string;
			revision: string;
			kind: "import" | "acquisition";
		}) => retryDownload(input.id, input.revision, input.kind),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: downloadKeys });
			void invalidateAnimeQueries(client, "acquisition");
			toast.add({
				title: t("acquisition.activity.retryQueued"),
				type: "success",
			});
		},
		onError: () => {
			void client.invalidateQueries({ queryKey: downloadKeys });
			void invalidateAnimeQueries(client, "acquisition");
			toast.add({
				title: t("acquisition.activity.retryFailed"),
				type: "error",
			});
		},
	});
	const tasks = activity?.items ?? [],
		ids = new Set(
			activity?.managedCandidateIds ?? tasks.map((item) => item.candidateId),
		);
	const webui = settings.data?.qbittorrentWebUiUrl;
	return (
		<div className="space-y-2">
			{activity?.planningError && (
				<p role="status" className="text-sm">
					{t("acquisition.activity.planningFailed")}
				</p>
			)}
			{(view.subscription || tasks.length > 0 || query.isError) && (
				<div className="action-row justify-between text-sm">
					<span>
						{activity?.active
							? t("acquisition.activity.active", {
									count: activity.active,
								})
							: initialActivity === null
								? t("acquisition.activity.statusUnavailable")
								: query.isPending
									? t("acquisition.activity.loading")
									: query.isError
										? t("acquisition.activity.statusUnavailable")
										: activity?.authorized && view.subscription?.enabled
											? t("acquisition.activity.automaticDownload")
											: view.subscription?.enabled
												? t("acquisition.activity.discoveryOnly")
												: t("acquisition.activity.pausedStatus")}
					</span>
					{webui && (
						<a
							className={buttonStyles("ghost")}
							href={webui}
							target="_blank"
							rel="noopener noreferrer"
						>
							{t("acquisition.activity.openWebui")}
						</a>
					)}
				</div>
			)}
			{query.isError && (
				<p role="alert" className="text-sm">
					{t("acquisition.activity.statusUnavailable")}{" "}
					<Button variant="outline" onClick={() => void query.refetch()}>
						{t("acquisition.activity.retryStatus")}
					</Button>
				</p>
			)}
			{view.subscription &&
				activity &&
				!activity.authorized &&
				view.subscription.enabled && (
					<p className="text-sm">
						{t("acquisition.activity.discoveryOnlyHint")}{" "}
						<Button variant="outline" onClick={onConfigure}>
							{t("acquisition.activity.enableAutomatic")}
						</Button>
					</p>
				)}
			{(view.subscription || (activity?.total ?? 0) > 0 || view.total > 0) && (
				<details>
					<summary className="cursor-pointer text-sm">
						{t("acquisition.activity.summary", {
							acquisitions: activity?.total ?? 0,
							releases: view.total,
						})}
						{activity?.attention
							? ` · ${t("acquisition.activity.attention", {
									count: activity.attention,
								})}`
							: ""}
					</summary>
					<div className="space-y-3 pt-3">
						{tasks.map((item) => (
							<div className="space-y-1 border-b py-2 text-sm" key={item.id}>
								<p>
									{t("acquisition.activity.episodeLine", {
										episode: item.episode,
										status: status(item, t),
									})}
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
											{t("acquisition.activity.staleObservation")}
										</p>
									)}
								{item.error && (
									<p role="status">
										{t(
											errorKeys[item.error] ??
												"acquisition.activity.errorFallback",
										)}
									</p>
								)}
								<div className="action-row">
									{item.ingestion === "review" && (
										<Link className={buttonStyles("outline")} to="/review">
											{t("acquisition.activity.openReview")}
										</Link>
									)}
									{item.error && (
										<Link className={buttonStyles("outline")} to="/settings">
											{t("acquisition.activity.settings")}
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
											{t("acquisition.activity.retryImport")}
										</Button>
									)}
									{(["missing", "blocked", "unknown"].includes(item.state) ||
										(item.state === "pending" && item.error !== null)) && (
										<Button
											variant="outline"
											disabled={
												retry.isPending || !activity?.authorized || !item.title
											}
											onClick={() =>
												retry.mutate({
													id: item.id,
													revision: item.revision,
													kind: "acquisition",
												})
											}
										>
											{t("acquisition.activity.retryAcquisition")}
										</Button>
									)}
								</div>
							</div>
						))}
						{(activity?.total ?? 0) > 20 && (
							<div className="action-row">
								<Button
									variant="outline"
									disabled={page === 1}
									onClick={() => setPage(page - 1)}
								>
									{t("acquisition.activity.previous")}
								</Button>
								<span>{t("acquisition.activity.page", { page })}</span>
								<Button
									variant="outline"
									disabled={page * 20 >= (activity?.total ?? 0)}
									onClick={() => setPage(page + 1)}
								>
									{t("acquisition.activity.next")}
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
										{candidate.episode
											? t("acquisition.activity.candidateEpisode", {
													episode: candidate.episode,
												})
											: ""}
										{candidate.status === "selected"
											? t("acquisition.activity.selected")
											: candidate.reasons.includes("waiting_for_level")
												? t("acquisition.activity.waitingForPreferred")
												: t("acquisition.activity.skipped", {
														reasons: candidate.reasons.map(reason).join("; "),
													})}
										{candidate.selection && (
											<>
												{" "}
												·{" "}
												{candidate.selection.level ??
													t("acquisition.activity.noMatchingLevel")}
												{candidate.reasons.includes("waiting_for_level") &&
												candidate.selection.eligibleAt !== null
													? ` · ${t("acquisition.activity.eligibleAfter", {
															date: new Date(
																candidate.selection.eligibleAt,
															).toLocaleString(),
														})}`
													: ""}
											</>
										)}
									</p>
								</div>
							))}
						{releasePagination}
					</div>
				</details>
			)}
		</div>
	);
}
