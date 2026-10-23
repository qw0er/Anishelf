import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Rss } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	DownloadActivity,
	SubscriptionView,
} from "../../shared/api/contracts.js";
import { boundedSignal } from "../../shared/api/queries.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../shared/components/ui/dialog.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../shared/components/ui/dropdown-menu.js";
import { Input } from "../../shared/components/ui/input.js";
import { toast } from "../../shared/components/ui/toast.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";
import { invalidateAnimeQueries } from "../anime/public.js";
import { DownloadActivityPanel } from "./download-activity.js";
import { downloadKeys, getDownloadSettings } from "./downloads-api.js";
import {
	acquisitionProfilesQuery,
	getSubscription,
	refreshSubscription,
	removeSubscription,
	saveSubscription,
	searchSubscriptionSource,
	toggleSubscription,
} from "./subscriptions-api.js";

const key = (workKey: string) =>
	["acquisition", "subscription", workKey] as const;
export function SubscriptionPanel({
	workKey,
	initialView,
	initialActivity,
}: {
	workKey: string;
	initialView?: SubscriptionView;
	initialActivity?: DownloadActivity | null;
}) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const reason = (code: string) =>
		t(reasonKeys[code] ?? "acquisition.reason.fallback");
	const [page, setPage] = useState(1),
		[editing, setEditing] = useState(false);
	const query = useQuery({
		queryKey: [...key(workKey), page],
		enabled: page !== 1 || !initialView,
		initialData: page === 1 ? initialView : undefined,
		queryFn: ({ signal }) =>
			getSubscription(workKey, page, { signal: boundedSignal(signal) }),
		refetchInterval: 30_000,
	});
	const viewData = page === 1 && initialView ? initialView : query.data;
	const subscription = viewData?.subscription;
	function updated() {
		setEditing(false);
		setPage(1);
		void client.invalidateQueries({ queryKey: key(workKey) });
		void client.invalidateQueries({ queryKey: downloadKeys });
		void invalidateAnimeQueries(client, "acquisition");
	}
	const action = useMutation({
		mutationFn: async (command: "toggle" | "refresh" | "remove") => {
			if (!subscription) return;
			if (command === "toggle")
				await toggleSubscription(
					workKey,
					subscription.revision,
					!subscription.enabled,
				);
			else if (command === "refresh")
				await refreshSubscription(workKey, subscription.revision);
			else await removeSubscription(workKey, subscription.revision);
		},
		onSuccess: () => {
			updated();
			toast.add({
				title: t("acquisition.subscription.updated"),
				type: "success",
			});
		},
		onError: () => {
			void client.invalidateQueries({ queryKey: key(workKey) });
			void client.invalidateQueries({ queryKey: downloadKeys });
			void invalidateAnimeQueries(client, "acquisition");
			toast.add({
				title: t("acquisition.subscription.updateFailed"),
				type: "error",
			});
		},
	});
	return (
		<section
			className="space-y-2 border-t pt-3"
			aria-label={t("acquisition.subscription.aria")}
		>
			<Dialog open={editing} onOpenChange={setEditing}>
				<div className="action-row justify-between">
					<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
						<h2 className="flex items-center gap-2 font-medium">
							<Rss
								className="size-4 text-muted-foreground"
								aria-hidden="true"
							/>
							{t("acquisition.subscription.title")}
						</h2>
						{subscription && (
							<span className="text-muted-foreground">
								{t("acquisition.subscription.fromEpisode", {
									episode: subscription.startEpisode,
								})}
							</span>
						)}
					</div>
					<div className="action-row">
						{!query.isPending && !query.isError && (
							<DialogTrigger
								render={<Button variant="ghost" disabled={action.isPending} />}
							>
								{subscription
									? t("acquisition.subscription.manage")
									: t("acquisition.subscription.subscribe")}
							</DialogTrigger>
						)}
						{subscription && (
							<div className="action-row">
								<Tooltip
									openOnClick
									content={t("acquisition.subscription.policyTooltip")}
								>
									<button
										type="button"
										className="text-sm text-muted-foreground underline decoration-dotted"
										aria-label={t("acquisition.subscription.policy")}
									>
										{subscription.enabled
											? t("acquisition.subscription.enabled")
											: t("acquisition.subscription.paused")}
									</button>
								</Tooltip>{" "}
								<DropdownMenu>
									<Tooltip content={t("acquisition.subscription.actions")}>
										<DropdownMenuTrigger
											render={
												<Button
													variant="ghost"
													className="size-9 shrink-0 p-0"
													aria-label={t("acquisition.subscription.actions")}
												/>
											}
										>
											<Ellipsis className="size-4" aria-hidden="true" />
										</DropdownMenuTrigger>
									</Tooltip>
									<DropdownMenuContent>
										<DropdownMenuItem
											disabled={action.isPending}
											onClick={() => action.mutate("toggle")}
										>
											{subscription.enabled
												? t("acquisition.subscription.pause")
												: t("acquisition.subscription.resume")}
										</DropdownMenuItem>
										<DropdownMenuItem
											disabled={action.isPending || !subscription.enabled}
											onClick={() => action.mutate("refresh")}
										>
											{t("acquisition.subscription.checkNow")}
										</DropdownMenuItem>
										<DropdownMenuItem
											disabled={action.isPending}
											onClick={() => setEditing(!editing)}
										>
											{t("acquisition.subscription.edit")}
										</DropdownMenuItem>
										<DropdownMenuItem
											disabled={action.isPending}
											onClick={() => action.mutate("remove")}
										>
											{t("acquisition.subscription.remove")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						)}
					</div>
				</div>
				<DialogContent className="max-h-[85dvh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							{subscription
								? t("acquisition.subscription.manageTitle")
								: t("acquisition.subscription.subscribeTitle")}
						</DialogTitle>
						<DialogDescription>
							{t("acquisition.subscription.dialogDescription")}
						</DialogDescription>
					</DialogHeader>
					<SubscriptionForm
						key={subscription?.revision ?? "new"}
						workKey={workKey}
						current={subscription ?? null}
						onSaved={updated}
					/>
				</DialogContent>
				{query.isPending ? (
					<p role="status">{t("acquisition.subscription.loading")}</p>
				) : query.isError ? (
					<div role="alert">
						{t("acquisition.subscription.unavailable")}{" "}
						<Button variant="outline" onClick={() => void query.refetch()}>
							{t("acquisition.subscription.retry")}
						</Button>
					</div>
				) : (
					<>
						{subscription?.error && (
							<p role="status" className="text-sm">
								{subscription.error === "source_changed"
									? t("acquisition.subscription.sourceChanged")
									: t("acquisition.subscription.candidatesFailed", {
											reason: reason(subscription.error),
										})}
							</p>
						)}
						{viewData && (
							<DownloadActivityPanel
								initialActivity={initialActivity}
								key={workKey}
								workKey={workKey}
								view={viewData}
								reason={reason}
								onConfigure={() => setEditing(true)}
								releasePagination={
									viewData.total > 20 ? (
										<div className="action-row">
											<Button
												variant="outline"
												disabled={page <= 1}
												onClick={() => setPage(page - 1)}
											>
												{t("acquisition.subscription.previousReleases")}
											</Button>
											<span className="text-sm">
												{t("acquisition.subscription.page", { page })}
											</span>
											<Button
												variant="outline"
												disabled={page * 20 >= viewData.total}
												onClick={() => setPage(page + 1)}
											>
												{t("acquisition.subscription.nextReleases")}
											</Button>
										</div>
									) : null
								}
							/>
						)}
					</>
				)}
			</Dialog>
		</section>
	);
}

function SubscriptionForm({
	workKey,
	current,
	onSaved,
}: {
	workKey: string;
	current: SubscriptionView["subscription"];
	onSaved(): void;
}) {
	const { t } = useTranslation();
	const reason = (code: string) =>
		t(reasonKeys[code] ?? "acquisition.reason.fallback");
	const profiles = useQuery(acquisitionProfilesQuery());
	const [profileId, setProfileId] = useState(current?.profileId ?? "");
	const [mode, setMode] = useState<"feed" | "search" | "keep">(
		current?.sourceKind === "search" ? "keep" : "feed",
	);
	const search = useMutation({
		mutationFn: () =>
			searchSubscriptionSource({
				workKey,
				revision: current?.revision ?? null,
				startEpisode: Number(start),
				profileId: profileId || null,
			}),
	});
	const id = useId(),
		[url, setUrl] = useState(""),
		[start, setStart] = useState(String(current?.startEpisode ?? 1));
	const destination = useQuery({
		queryKey: [...downloadKeys, "settings"],
		queryFn: ({ signal }) =>
			getDownloadSettings({ signal: boundedSignal(signal) }),
	});
	const target = destination.data?.destination;
	const save = useMutation({
		mutationFn: () => {
			if (!target?.validated)
				throw new Error("Configure and validate a download destination first.");
			if (mode === "search" && (!search.isSuccess || !search.data?.source))
				throw new Error("Find an eligible source first.");
			return saveSubscription({
				workKey,
				source:
					mode === "search"
						? (search.data?.source ?? null)
						: mode === "feed" && url.trim()
							? { kind: "feed", url: url.trim() }
							: null,
				profileId: profileId || null,
				startEpisode: Number(start),
				revision: current?.revision ?? null,
				destinationRevision: target.revision,
				connectionGeneration: target.connectionGeneration,
			});
		},
		onSuccess: () => {
			setUrl("");
			onSaved();
			toast.add({
				title: t("acquisition.subscription.enabledToast"),
				type: "success",
			});
		},
		onError: () => {
			void destination.refetch();
			toast.add({
				title: t("acquisition.subscription.saveFailed"),
				type: "error",
			});
		},
	});
	const busy = save.isPending || search.isPending;
	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			{current && (
				<p className="break-all text-sm text-muted-foreground">
					{current.source}
				</p>
			)}
			<label htmlFor={`${id}-mode`} className="block space-y-2">
				<span className="text-sm font-medium">
					{t("acquisition.subscription.source")}
				</span>
				<select
					id={`${id}-mode`}
					value={mode}
					disabled={busy}
					className="w-full rounded-md border bg-background p-2 text-sm"
					onChange={(event) => {
						setMode(event.target.value as "feed" | "search" | "keep");
						search.reset();
					}}
				>
					{current && (
						<option value="keep">
							{t("acquisition.subscription.keepCurrent")}
						</option>
					)}
					<option value="feed">{t("acquisition.subscription.rssUrl")}</option>
					<option value="search">
						{t("acquisition.subscription.searchSites")}
					</option>
				</select>
			</label>
			{mode === "feed" && (
				<label htmlFor={`${id}-url`} className="block space-y-2">
					<span className="text-sm font-medium">
						{t("acquisition.subscription.rssUrl")}
					</span>
					<Input
						id={`${id}-url`}
						type="url"
						required={current?.sourceKind !== "feed"}
						maxLength={4096}
						value={url}
						onChange={(event) => {
							setUrl(event.target.value);
						}}
						disabled={busy}
						placeholder={
							current
								? t("acquisition.subscription.leaveBlank")
								: t("acquisition.subscription.rssPlaceholder")
						}
					/>
				</label>
			)}
			{mode === "search" && (
				<div className="space-y-2 text-sm">
					<p>{t("acquisition.subscription.searchHelp")}</p>
					<Button
						type="button"
						variant="outline"
						disabled={
							busy ||
							profiles.isPending ||
							profiles.isError ||
							!Number.isInteger(Number(start)) ||
							Number(start) < 1 ||
							Number(start) > 10000
						}
						onClick={() => search.mutate()}
					>
						{search.isPending
							? t("acquisition.subscription.searchingSites")
							: t("acquisition.subscription.findSource")}
					</Button>
					{search.isError && (
						<p role="alert">{t("acquisition.subscription.discoveryFailed")}</p>
					)}
					{search.isSuccess && search.data && (
						<>
							<ul aria-label={t("acquisition.subscription.sourceResults")}>
								{search.data.attempts.map((attempt) => (
									<li key={attempt.providerId}>
										{attempt.providerId}:{" "}
										{attempt.outcome === "matched"
											? t("acquisition.subscription.matched")
											: attempt.outcome === "no_match"
												? t("acquisition.subscription.noMatch")
												: attempt.outcome === "no_eligible"
													? t("acquisition.subscription.noEligible")
													: t("acquisition.subscription.unavailableSite", {
															code: attempt.code,
														})}
										{attempt.reasons?.length
											? ` · ${attempt.reasons.map(reason).join(", ")}`
											: ""}
										{attempt.limited
											? t("acquisition.subscription.limitedCoverage")
											: ""}
									</li>
								))}
							</ul>
							{search.data.source?.kind === "search" ? (
								<p role="status">
									{t("acquisition.subscription.selectedSite", {
										site: search.data.source.providerId,
									})}
								</p>
							) : (
								<p role="status">
									{t("acquisition.subscription.noEligibleLong")}
								</p>
							)}
							<ul aria-label={t("acquisition.subscription.matchingReleases")}>
								{search.data.releases.map((release) => (
									<li key={release.id}>
										{t("acquisition.subscription.releaseLine", {
											title: release.title,
											episode: release.episode,
										})}
										{release.waiting
											? t("acquisition.subscription.waitingForPreference")
											: ""}
									</li>
								))}
							</ul>
						</>
					)}
				</div>
			)}
			<label htmlFor={`${id}-start`} className="block space-y-2">
				<span className="text-sm font-medium">
					{t("acquisition.subscription.startingEpisode")}
				</span>
				<Input
					id={`${id}-start`}
					type="number"
					min={1}
					max={10000}
					required
					value={start}
					onChange={(event) => {
						setStart(event.target.value);
						search.reset();
					}}
					disabled={busy}
				/>
			</label>
			<label htmlFor={`${id}-profile`} className="block space-y-2">
				<span className="text-sm font-medium">
					{t("acquisition.subscription.releaseProfile")}
				</span>
				<select
					id={`${id}-profile`}
					className="w-full rounded-md border bg-background p-2 text-sm"
					value={profileId}
					disabled={busy || profiles.isPending || profiles.isError}
					onChange={(event) => {
						setProfileId(event.target.value);
						search.reset();
					}}
				>
					<option value="">
						{t("acquisition.subscription.followDefault")}
						{profiles.data
							? ` (${profiles.data.profiles.find((profile) => profile.id === profiles.data.selectedProfileId)?.name ?? t("acquisition.subscription.unavailableLabel")})`
							: ""}
					</option>
					{profileId &&
						!profiles.data?.profiles.some(
							(profile) => profile.id === profileId,
						) && (
							<option value={profileId}>
								{t("acquisition.subscription.unavailableName", {
									name: profileId,
								})}
							</option>
						)}
					{profiles.data?.profiles.map((profile) => (
						<option key={profile.id} value={profile.id}>
							{profile.name}
							{profile.source === "custom" ? t("acquisition.rss.custom") : ""}
						</option>
					))}
				</select>
			</label>
			{profiles.isError && (
				<p role="alert">
					{t("acquisition.subscription.loadProfilesFailed")}{" "}
					<Button
						type="button"
						variant="outline"
						onClick={() => void profiles.refetch()}
					>
						{t("acquisition.subscription.retryProfiles")}
					</Button>
				</p>
			)}
			<p className="text-sm text-muted-foreground">
				{
					profiles.data?.profiles.find(
						(profile) =>
							profile.id === (profileId || profiles.data.selectedProfileId),
					)?.description
				}
			</p>
			{mode === "feed" && (
				<p className="text-sm text-muted-foreground">
					{t("acquisition.subscription.feedHelp")}
				</p>
			)}
			{destination.isPending ? (
				<p role="status">{t("acquisition.subscription.loadingDestination")}</p>
			) : target?.validated ? (
				<p className="wrap-break-word text-sm">
					{t("acquisition.subscription.destinationInfo", {
						path: target.path,
						episode: start || "1",
					})}
				</p>
			) : (
				<p role="alert">
					{t("acquisition.subscription.destinationRequiredBefore")}{" "}
					<a className="underline" href="/settings">
						{t("acquisition.subscription.settings")}
					</a>{" "}
					{t("acquisition.subscription.destinationRequiredAfter")}{" "}
					<Button
						type="button"
						variant="outline"
						onClick={() => void destination.refetch()}
					>
						{t("acquisition.subscription.retryDestination")}
					</Button>
				</p>
			)}
			<Button
				type="submit"
				disabled={
					busy ||
					!target?.validated ||
					profiles.isPending ||
					profiles.isError ||
					(mode === "search" && (!search.isSuccess || !search.data?.source))
				}
			>
				{save.isPending
					? t("acquisition.subscription.saving")
					: t("acquisition.subscription.save")}
			</Button>
		</form>
	);
}

const reasonKeys: Record<string, string> = {
	acquisition_unavailable: "acquisition.reason.acquisition_unavailable",
	identity_unconfirmed: "acquisition.reason.identity_unconfirmed",
	unsupported_content: "acquisition.reason.unsupported_content",
	episode_unconfirmed: "acquisition.reason.episode_unconfirmed",
	download_unavailable: "acquisition.reason.download_unavailable",
	outside_scope: "acquisition.reason.outside_scope",
	already_available: "acquisition.reason.already_available",
	existing_download: "acquisition.reason.existing_download",
	episode_downloading: "acquisition.reason.episode_downloading",
	downloader_unavailable: "acquisition.reason.downloader_unavailable",
	another_version_selected: "acquisition.reason.another_version_selected",
	newer_revision_available: "acquisition.reason.newer_revision_available",
	waiting_for_level: "acquisition.reason.waiting_for_level",
	requirements_not_met: "acquisition.reason.requirements_not_met",
	no_matching_level: "acquisition.reason.no_matching_level",
	profile_unavailable: "acquisition.reason.profile_unavailable",
	episode_reserved: "acquisition.reason.episode_reserved",
	fetch_failed: "acquisition.reason.fetch_failed",
	invalid_xml: "acquisition.reason.invalid_xml",
	storage_limit: "acquisition.reason.storage_limit",
	assessment_unavailable: "acquisition.reason.assessment_unavailable",
};
