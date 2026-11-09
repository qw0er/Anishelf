import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Rss, Search, Settings } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type { WatchingAutomationStatus } from "../../shared/api/contracts.js";
import { EmptyState } from "../../shared/components/empty-state.js";
import { PageHeader } from "../../shared/components/page-header.js";
import { Button, buttonStyles } from "../../shared/components/ui/button.js";
import { Checkbox } from "../../shared/components/ui/checkbox.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../shared/components/ui/collapsible.js";
import { Input } from "../../shared/components/ui/input.js";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../shared/components/ui/native-select.js";
import { toast } from "../../shared/components/ui/toast.js";
import { useRefreshError } from "../../shared/hooks/use-refresh-error.js";
import { invalidateAnimeQueries } from "../anime/public.js";
import { SubscriptionPanel } from "./subscription-panel.js";
import { subscriptionStatus } from "./subscription-status.js";
import { subscriptionListQuery } from "./subscriptions-api.js";
import {
	overrideWatching,
	watchingKey,
	watchingQuery,
} from "./watching-api.js";
import { watchingReason } from "./watching-reason.js";

export function SubscriptionsPage() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const watching = useQuery(watchingQuery());
	useRefreshError(
		`watching-automation`,
		watching.data ? watching.error : null,
		watching.errorUpdatedAt,
		() => void watching.refetch(),
	);
	const membership = useMutation({
		mutationFn: (work: WatchingAutomationStatus["works"][number]) => {
			if (!watching.data?.accountId)
				throw Error("Connect a tracking account first");
			return overrideWatching({
				accountId: watching.data.accountId,
				trackingGeneration: watching.data.trackingGeneration,
				workKey: work.workKey,
				revision: work.revision,
				excluded: !work.excluded,
				paused: false,
			});
		},
		onSuccess: (status, work) => {
			console.info("[acquisition] Automation membership updated.", {
				workKey: work.workKey,
				excluded: !work.excluded,
			});
			toast.add({
				type: "success",
				title: t(
					work.excluded
						? "acquisition.manager.restored"
						: "acquisition.manager.excludedSuccess",
				),
			});
			client.setQueryData(watchingKey, status);
			void client.invalidateQueries({ queryKey: watchingKey });
			void client.invalidateQueries({
				queryKey: ["acquisition", "subscription"],
			});
			void invalidateAnimeQueries(client, "acquisition");
		},
		onError: (_error, work) => {
			console.warn("[acquisition] Automation membership update failed.", {
				workKey: work.workKey,
			});
			toast.add({
				type: "error",
				title: t("acquisition.watching.updateFailed"),
			});
		},
	});
	const attentionId = useId();
	const managementId = useId();
	const [params, setParams] = useSearchParams();
	const search = params.get("search") ?? "";
	const requestedType = params.get("type");
	const filter =
		requestedType === "automatic" || requestedType === "manual"
			? requestedType
			: "all";
	const attention = params.get("attention") === "true";
	function changeFilter(key: string, value: string) {
		const next = new URLSearchParams(params);
		if (value) next.set(key, value);
		else next.delete(key);
		setParams(next, { replace: key === "search" });
	}
	const query = useQuery(subscriptionListQuery());
	useRefreshError(
		"subscriptions-inventory",
		query.data ? query.error : null,
		query.errorUpdatedAt,
		() => void query.refetch(),
	);
	const filtered = search.trim() !== "" || filter !== "all" || attention;
	const clearFilters = () => {
		const next = new URLSearchParams(params);
		for (const key of ["search", "type", "attention"]) next.delete(key);
		setParams(next);
	};
	const excluded =
		watching.data?.works.filter(
			(work) =>
				work.excluded &&
				filter !== "manual" &&
				!attention &&
				work.title
					.toLocaleLowerCase()
					.includes(search.trim().toLocaleLowerCase()),
		) ?? [];
	const managed = new Map(
		watching.data?.works
			.filter((work) => work.managed && !work.excluded)
			.map((work) => [work.workKey, work]),
	);
	const membershipButton = (
		work: WatchingAutomationStatus["works"][number],
	) => (
		<Button
			variant="ghost"
			aria-label={t(
				work.excluded
					? "acquisition.watching.include"
					: "acquisition.watching.exclude",
			)}
			disabled={membership.isPending || !watching.data?.accountId}
			aria-busy={
				membership.isPending && membership.variables?.workKey === work.workKey
			}
			onClick={() => membership.mutate(work)}
		>
			{t(
				work.excluded
					? "acquisition.manager.restore"
					: "acquisition.manager.exclude",
			)}
		</Button>
	);
	const rows = query.data?.filter(
		({ title, view }) =>
			title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
			(!attention || subscriptionStatus(view.subscription).needsAttention) &&
			(filter === "all" ||
				(filter === "automatic"
					? view.subscription?.management === "watching"
					: view.subscription?.management !== "watching")),
	);
	return (
		<main className="stack-page">
			<PageHeader
				title={t("acquisition.manager.title")}
				description={t("acquisition.manager.description")}
				actions={
					<Link
						className={buttonStyles("outline")}
						to="/settings?section=downloads"
					>
						<Settings className="size-4" aria-hidden="true" />
						{t("acquisition.watching.settings")}
					</Link>
				}
			/>
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
				<p
					className="text-muted-foreground"
					role={watching.isError && !watching.data ? "alert" : "status"}
				>
					{t("acquisition.manager.automation")}:{" "}
					{watching.isError && !watching.data
						? t("acquisition.watching.loadFailed")
						: watching.data
							? t(
									watching.data.enabled
										? "acquisition.watching.enabled"
										: "acquisition.watching.disabled",
								)
							: t("acquisition.watching.loading")}
					{!(watching.isError && !watching.data) &&
						watching.data &&
						!["ready", "disabled"].includes(watching.data.reason) &&
						` · ${watchingReason(watching.data.reason)}`}
				</p>
				{watching.isError && !watching.data && (
					<Button variant="ghost" onClick={() => void watching.refetch()}>
						{t("actions.retry")}
					</Button>
				)}
			</div>
			<section
				className="min-w-0 rounded-lg border bg-card text-card-foreground"
				aria-label={t("acquisition.manager.inventory")}
			>
				<div className="flex flex-wrap items-center gap-3 border-b p-4 sm:p-5">
					<div className="relative min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-64">
						<Search
							className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							className="pl-9"
							aria-label={t("acquisition.manager.search")}
							placeholder={t("acquisition.manager.search")}
							value={search}
							onChange={(e) => changeFilter("search", e.target.value)}
						/>
					</div>
					<div className="flex items-center gap-2">
						<label
							htmlFor={managementId}
							className="shrink-0 text-sm font-medium"
							title={t("acquisition.manager.management")}
						>
							{t("acquisition.manager.management")}
						</label>
						<div className="w-36">
							<NativeSelect
								id={managementId}
								value={filter}
								onChange={(event) =>
									changeFilter(
										"type",
										event.target.value === "all" ? "" : event.target.value,
									)
								}
							>
								{["all", "automatic", "manual"].map((value) => (
									<NativeSelectOption key={value} value={value}>
										{t(`acquisition.manager.${value}`)}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</div>
					</div>
					<fieldset className="min-w-0">
						<legend className="sr-only">
							{t("acquisition.manager.status")}
						</legend>
						<div className="flex items-center gap-2">
							<Checkbox
								id={attentionId}
								checked={attention}
								onCheckedChange={(checked) =>
									changeFilter("attention", checked ? "true" : "")
								}
							/>
							<label
								htmlFor={attentionId}
								className="touch-control flex cursor-pointer items-center text-sm"
							>
								{t("acquisition.manager.onlyAttention")}
							</label>
						</div>
					</fieldset>
					{filtered && (
						<Button variant="ghost" onClick={clearFilters}>
							{t("acquisition.manager.clearFilters")}
						</Button>
					)}
				</div>
				{query.isPending && (
					<p className="p-5 text-sm text-muted-foreground" role="status">
						{t("acquisition.subscription.loading")}
					</p>
				)}
				{query.isError && !query.data && (
					<div
						className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm sm:px-5"
						role="alert"
					>
						{t("acquisition.subscription.unavailable")}
						<Button variant="ghost" onClick={() => void query.refetch()}>
							{t("actions.retry")}
						</Button>
					</div>
				)}
				{query.data && rows?.length === 0 && (
					<div className="p-4 sm:p-5">
						<EmptyState
							embedded
							icon={<Rss />}
							title={t(
								filtered
									? "acquisition.manager.empty"
									: "acquisition.manager.noSubscriptions",
							)}
							actions={
								filtered ? (
									<Button variant="outline" onClick={clearFilters}>
										{t("acquisition.manager.clearFilters")}
									</Button>
								) : (
									<div className="space-y-3 text-center">
										<p className="text-sm text-muted-foreground">
											{t("acquisition.manager.emptyHelp")}
										</p>
										<Link className={buttonStyles("outline")} to="/">
											{t("acquisition.manager.browse")}
										</Link>
									</div>
								)
							}
						/>
					</div>
				)}
				<div className="divide-y px-4 empty:hidden sm:px-5">
					{rows?.map(({ title, view }) => {
						const sub = view.subscription;
						if (!sub) return null;
						const work = managed.get(sub.workKey);
						return (
							<article
								key={sub.workKey}
								aria-label={title}
								className="grid min-w-0 items-center gap-x-8 gap-y-3 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]"
							>
								<div className="min-w-0 space-y-2">
									<Link
										className="block w-fit max-w-full rounded-sm list-primary wrap-anywhere underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
										to={`/anime/tracked/${encodeURIComponent(sub.workKey)}`}
									>
										{title}
									</Link>
									<p className="flex flex-wrap gap-x-3 gap-y-1 compact-metadata">
										<span>
											{t(
												sub.management === "watching"
													? "acquisition.manager.automatic"
													: "acquisition.manager.manual",
											)}
										</span>
										<span>
											{t("acquisition.subscription.fromEpisode", {
												episode: sub.startEpisode,
											})}
										</span>
									</p>
								</div>
								<SubscriptionPanel
									workKey={sub.workKey}
									compact
									inventory={{
										title,
										view,
										...(work && watching.data?.accountId
											? { onExclude: () => membership.mutate(work) }
											: {}),
										excludePending: membership.isPending,
									}}
								/>
							</article>
						);
					})}
				</div>
				{excluded.length > 0 && (
					<Collapsible className="border-t p-4 sm:p-5">
						<CollapsibleTrigger className="group flex min-h-9 items-center gap-2 rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
							<ChevronDown
								className="size-4 transition-transform group-data-[panel-open]:rotate-180"
								aria-hidden="true"
							/>
							{t("acquisition.manager.excluded", { count: excluded.length })}
						</CollapsibleTrigger>
						<CollapsibleContent>
							<div className="divide-y pt-2">
								{excluded.map((work) => (
									<div
										key={work.workKey}
										className="flex min-w-0 items-center justify-between gap-4 py-2"
									>
										<Link
											className="text-sm wrap-anywhere underline-offset-4 hover:underline"
											to={`/anime/tracked/${encodeURIComponent(work.workKey)}`}
										>
											{work.title}
										</Link>
										{membershipButton(work)}
									</div>
								))}
							</div>
						</CollapsibleContent>
					</Collapsible>
				)}
			</section>
		</main>
	);
}
