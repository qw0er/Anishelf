import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	DownloadActivity,
	SubscriptionView,
} from "../../shared/api/contracts.js";
import { Button, buttonStyles } from "../../shared/components/ui/button.js";
import { toast } from "../../shared/components/ui/toast.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";
import { invalidateAnimeQueries } from "../anime/public.js";
import { settingsQuery } from "../settings/public.js";
import { activityStatus } from "./activity-status.js";
import {
	downloadKeys,
	getDownloadActivity,
	retryDownload,
} from "./downloads-api.js";
import { getSubscription } from "./subscriptions-api.js";

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
	view,
	reason,
	onConfigure,
	onCheckUpdates,
	checking = false,
}: {
	workKey: string;
	view: Pick<SubscriptionView, "subscription">;
	reason(code: string): string;
	onConfigure(): void;
	onCheckUpdates?: () => void;
	checking?: boolean;
	releasePagination?: ReactNode;
}) {
	const { t, i18n } = useTranslation(),
		client = useQueryClient();
	const [page, setPage] = useState(1),
		[diagnostics, setDiagnostics] = useState(false),
		[releasePage, setReleasePage] = useState(1);
	const settings = useQuery(settingsQuery());
	const query = useQuery({
		queryKey: [...downloadKeys, workKey, page],
		staleTime: 5_000,
		queryFn: ({ signal }) => getDownloadActivity(workKey, page, { signal }),
		refetchInterval: (query) => (query.state.data?.active ? 5000 : 60000),
	});
	const releases = useQuery({
		queryKey: [
			"acquisition",
			"subscription",
			workKey,
			"diagnostics",
			releasePage,
		],
		enabled: diagnostics,
		refetchInterval: diagnostics ? 30000 : false,
		queryFn: ({ signal }) =>
			getSubscription(workKey, releasePage, { signal }, true),
	});
	const retry = useMutation({
		mutationFn: ({
			item,
			kind,
		}: {
			item: DownloadActivity["items"][number];
			kind: "import" | "acquisition";
		}) => retryDownload(item.id, item.revision, kind),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: [...downloadKeys, workKey] });
			void invalidateAnimeQueries(client, "acquisition", workKey);
			toast.add({
				type: "success",
				title: t("acquisition.activity.retryQueued"),
			});
		},
		onError: () =>
			toast.add({
				type: "error",
				title: t("acquisition.activity.retryFailed"),
			}),
	});
	const activity = query.data,
		tasks = activity?.items ?? [];
	const historical = (item: (typeof tasks)[number]) =>
		item.state === "available" || (item.state === "missing" && !item.error);
	const ids = new Set(
		activity?.managedCandidateIds ?? tasks.map((item) => item.candidateId),
	);
	const candidates =
		releases.data?.candidates.filter((candidate) => !ids.has(candidate.id)) ??
		[];
	const groups = new Map<string, typeof candidates>();
	for (const candidate of candidates) {
		const key = candidate.reasons.join(",") || candidate.status;
		groups.set(key, [...(groups.get(key) ?? []), candidate]);
	}
	const row = (item: (typeof tasks)[number]) => (
		<div key={item.id} className="space-y-2 border-b py-3 text-sm">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span>
					{t("acquisition.activity.candidateEpisode", {
						episode: item.episode,
					})}
				</span>
				<span>{activityStatus(item, t)}</span>
			</div>
			{item.progress !== null &&
				item.state === "bound" &&
				item.progress < 1 && (
					<progress
						className="h-1 w-full"
						aria-label={t("acquisition.activity.episodeProgress", {
							episode: item.episode,
						})}
						max={1}
						value={item.progress}
					/>
				)}
			{item.error && (
				<p role="status" className="text-muted-foreground">
					{t(errorKeys[item.error] ?? "acquisition.activity.errorFallback")}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{item.ingestion === "review" && (
					<a className={buttonStyles("outline")} href="/review">
						{t("acquisition.activity.openReview")}
					</a>
				)}
				{item.ingestion === "failed" && (
					<Button
						variant="outline"
						disabled={retry.isPending}
						onClick={() => retry.mutate({ item, kind: "import" })}
					>
						{t("acquisition.activity.retryImport")}
					</Button>
				)}
				{(["missing", "blocked", "unknown"].includes(item.state) ||
					(item.state === "pending" && item.error)) && (
					<Button
						variant="outline"
						disabled={retry.isPending || !activity?.authorized || !item.title}
						onClick={() => retry.mutate({ item, kind: "acquisition" })}
					>
						{t("acquisition.activity.retryAcquisition")}
					</Button>
				)}
				{item.error &&
					[
						"downloader_configuration_changed",
						"source_changed",
						"incomplete_directory_required",
					].includes(item.error) && (
						<a
							className={buttonStyles("ghost")}
							href="/settings?section=downloads"
						>
							{t("acquisition.activity.settings")}
						</a>
					)}
			</div>
		</div>
	);
	return (
		<div className="space-y-3">
			{query.isPending && !activity && (
				<p role="status">{t("acquisition.activity.loading")}</p>
			)}
			{query.isError && (
				<p role="alert">
					{t("acquisition.activity.statusUnavailable")}{" "}
					<Button variant="ghost" onClick={() => void query.refetch()}>
						{t("acquisition.activity.retryStatus")}
					</Button>
				</p>
			)}
			{view.subscription?.error &&
				view.subscription.error !== "no_eligible_source" && (
					<p role="status" className="text-sm">
						{reason(view.subscription.error)}{" "}
						{view.subscription.error === "authorization_required" ? (
							<Button variant="outline" onClick={onConfigure}>
								{t("acquisition.subscription.edit")}
							</Button>
						) : ["source_changed", "source_disabled"].includes(
								view.subscription.error,
							) ? (
							<a className="underline" href="/settings?section=downloads">
								{t("acquisition.activity.settings")}
							</a>
						) : onCheckUpdates && view.subscription.enabled ? (
							<Button
								variant="outline"
								disabled={checking}
								onClick={onCheckUpdates}
							>
								{t("acquisition.subscription.checkNow")}
							</Button>
						) : null}
					</p>
				)}
			{activity?.planningError && (
				<p role="status" className="text-sm">
					{t("acquisition.activity.planningFailed")}
				</p>
			)}
			{tasks.filter((item) => !historical(item)).map(row)}
			{!tasks.some((item) => !historical(item)) &&
				!query.isPending &&
				!query.isError && (
					<p className="text-sm text-muted-foreground">
						{t("acquisition.activity.noActiveTasks")}
					</p>
				)}
			{tasks.some(historical) && (
				<details>
					<summary className="cursor-pointer text-sm">
						{t("acquisition.activity.history")}
					</summary>
					{tasks.filter(historical).map(row)}
				</details>
			)}
			{(activity?.total ?? 0) > 20 && (
				<div className="action-row">
					<Button
						variant="ghost"
						disabled={page <= 1}
						onClick={() => setPage(page - 1)}
					>
						{t("acquisition.activity.previous")}
					</Button>
					<span className="text-sm">
						{t("acquisition.activity.page", { page })}
					</span>
					<Button
						variant="ghost"
						disabled={page * 20 >= (activity?.total ?? 0)}
						onClick={() => setPage(page + 1)}
					>
						{t("acquisition.activity.next")}
					</Button>
				</div>
			)}
			<details onToggle={(event) => setDiagnostics(event.currentTarget.open)}>
				<summary className="cursor-pointer text-sm">
					{t("acquisition.activity.diagnostics")}
				</summary>
				<div className="space-y-3 pt-3">
					{view.subscription && (
						<p className="text-sm text-muted-foreground">
							{view.subscription.source} ·{" "}
							{t("acquisition.subscription.fromEpisode", {
								episode: view.subscription.startEpisode,
							})}
						</p>
					)}
					{releases.data?.discovery && (
						<div className="space-y-2 text-sm">
							<p className="text-muted-foreground">
								{t("acquisition.subscription.lastDiscovery", {
									time: new Date(
										releases.data.discovery.checkedAt,
									).toLocaleString(i18n.language),
								})}
							</p>
							{releases.data.discovery.attempts.map((attempt) => (
								<div key={attempt.providerId}>
									<p>
										{attempt.providerId} ·{" "}
										{t(`acquisition.subscription.attempt.${attempt.outcome}`)}
										{attempt.limited &&
											t("acquisition.subscription.limitedCoverage")}
									</p>
									{attempt.reasons.length > 0 && (
										<p className="text-muted-foreground">
											{attempt.reasons.map(reason).join(" · ")}
										</p>
									)}
								</div>
							))}
							{releases.data.discovery.attempts.length === 0 && (
								<p>{t("acquisition.subscription.discoveryUnavailable")}</p>
							)}
						</div>
					)}
					{releases.isPending ? (
						<p role="status">{t("acquisition.subscription.loading")}</p>
					) : releases.isError ? (
						<p role="alert">
							{t("acquisition.subscription.unavailable")}{" "}
							<Button variant="ghost" onClick={() => void releases.refetch()}>
								{t("acquisition.subscription.retry")}
							</Button>
						</p>
					) : (
						[...groups].map(([group, entries]) => (
							<details key={group}>
								<summary className="cursor-pointer text-sm">
									{entries[0]?.reasons.length
										? entries[0].reasons.map(reason).join(" · ")
										: t("acquisition.activity.selected")}{" "}
									· {entries.length}
								</summary>
								{entries.map((candidate) => (
									<div className="border-b py-2 text-sm" key={candidate.id}>
										<Tooltip content={candidate.title} openOnClick>
											<button
												type="button"
												className="block max-w-full truncate text-left"
												aria-label={candidate.title}
											>
												{candidate.title}
											</button>
										</Tooltip>
									</div>
								))}
							</details>
						))
					)}
					{(releases.data?.total ?? 0) > 20 && (
						<div className="action-row">
							<Button
								variant="ghost"
								disabled={releasePage <= 1}
								onClick={() => setReleasePage(releasePage - 1)}
							>
								{t("acquisition.subscription.previousReleases")}
							</Button>
							<span className="text-sm">
								{t("acquisition.subscription.page", { page: releasePage })}
							</span>
							<Button
								variant="ghost"
								disabled={releasePage * 20 >= (releases.data?.total ?? 0)}
								onClick={() => setReleasePage(releasePage + 1)}
							>
								{t("acquisition.subscription.nextReleases")}
							</Button>
						</div>
					)}
				</div>
			</details>
			{settings.data?.qbittorrentWebUiUrl && (
				<a
					className={buttonStyles("ghost")}
					href={settings.data.qbittorrentWebUiUrl}
					target="_blank"
					rel="noopener noreferrer"
				>
					{t("acquisition.activity.openWebui")}
				</a>
			)}
		</div>
	);
}
