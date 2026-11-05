import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Filter, Rss, Search, Settings } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { WatchingAutomationStatus } from "../../shared/api/contracts.js";
import { EmptyState } from "../../shared/components/empty-state.js";
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
import { invalidateAnimeQueries } from "../anime/public.js";
import { SubscriptionPanel } from "./subscription-panel.js";
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
		onSuccess: (status) => {
			client.setQueryData(watchingKey, status);
			void client.invalidateQueries({ queryKey: watchingKey });
			void client.invalidateQueries({
				queryKey: ["acquisition", "subscription"],
			});
			void invalidateAnimeQueries(client, "acquisition");
		},
		onError: () =>
			toast.add({
				type: "error",
				title: t("acquisition.watching.updateFailed"),
			}),
	});
	const attentionId = useId();
	const managementId = useId();
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState("all");
	const [attention, setAttention] = useState(false);
	const query = useQuery(subscriptionListQuery());
	const filtered = search.trim() !== "" || filter !== "all" || attention;
	const clearFilters = () => {
		setSearch("");
		setFilter("all");
		setAttention(false);
	};
	const excluded = watching.data?.works.filter((work) => work.excluded) ?? [];
	const membershipButton = (
		work: WatchingAutomationStatus["works"][number],
	) => (
		<Button
			variant="ghost"
			disabled={membership.isPending || !watching.data?.accountId}
			aria-busy={
				membership.isPending && membership.variables?.workKey === work.workKey
			}
			onClick={() => membership.mutate(work)}
		>
			{t(
				work.excluded
					? "acquisition.watching.include"
					: "acquisition.watching.exclude",
			)}
		</Button>
	);
	const rows = query.data?.filter(
		({ title, view }) =>
			title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
			(!attention ||
				!!(
					view.subscription?.runState !== "completed" &&
					view.subscription?.error &&
					view.subscription.error !== "no_eligible_source"
				)) &&
			(filter === "all" ||
				(filter === "automatic"
					? view.subscription?.management === "watching"
					: view.subscription?.management !== "watching")),
	);
	return (
		<main className="stack-page">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<h1 className="text-2xl font-semibold">
					{t("acquisition.manager.title")}
				</h1>
				<Link
					className={buttonStyles("outline")}
					to="/settings?section=downloads"
				>
					<Settings className="size-4" aria-hidden="true" />
					{t("acquisition.watching.settings")}
				</Link>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm">
				<p
					className="text-muted-foreground"
					role={watching.isError ? "alert" : "status"}
				>
					{t("acquisition.manager.automation")}:{" "}
					{watching.data
						? t(
								watching.data.enabled
									? "acquisition.watching.enabled"
									: "acquisition.watching.disabled",
							)
						: t(
								watching.isError
									? "acquisition.watching.loadFailed"
									: "acquisition.watching.loading",
							)}
					{watching.data &&
						!["ready", "disabled"].includes(watching.data.reason) &&
						` · ${watchingReason(watching.data.reason)}`}
				</p>
				{watching.isError && (
					<Button variant="ghost" onClick={() => void watching.refetch()}>
						{t("actions.retry")}
					</Button>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-3">
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
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
				<div className="flex items-center gap-2">
					<label
						htmlFor={managementId}
						className="shrink-0 text-sm font-medium"
						title={t("acquisition.manager.management")}
					>
						<Filter
							className="size-4 text-muted-foreground"
							aria-hidden="true"
						/>
						<span className="sr-only">
							{t("acquisition.manager.management")}
						</span>
					</label>
					<div className="w-36">
						<NativeSelect
							id={managementId}
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
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
					<legend className="sr-only">{t("acquisition.manager.status")}</legend>
					<div className="flex items-center gap-2">
						<Checkbox
							id={attentionId}
							checked={attention}
							onCheckedChange={setAttention}
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
				<p role="status">{t("acquisition.subscription.loading")}</p>
			)}
			{query.isError && (
				<div role="alert">
					{t("acquisition.subscription.unavailable")}
					<Button variant="ghost" onClick={() => void query.refetch()}>
						{t("actions.retry")}
					</Button>
				</div>
			)}
			{!query.isError && rows?.length === 0 && (
				<EmptyState
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
			)}
			<div className="divide-y empty:hidden">
				{rows?.map(
					({ title, view }) =>
						view.subscription && (
							<article
								className="grid min-w-0 items-center gap-x-6 gap-y-1 py-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_auto]"
								key={view.subscription.workKey}
							>
								<Link
									className={buttonStyles(
										"ghost",
										"max-w-full justify-start px-2 -ml-2",
									)}
									to={`/anime/tracked/${encodeURIComponent(view.subscription.workKey)}`}
								>
									<span className="truncate">{title}</span>
									<ChevronRight
										className="size-4 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
								</Link>
								<SubscriptionPanel
									workKey={view.subscription.workKey}
									compact
								/>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<span>
										{t(
											view.subscription.management === "watching"
												? "acquisition.manager.automatic"
												: "acquisition.manager.manual",
										)}
									</span>
									{watching.data?.works
										.filter(
											(work) =>
												work.workKey === view.subscription?.workKey &&
												work.managed &&
												!work.excluded,
										)
										.map((work) => (
											<div key={work.workKey}>{membershipButton(work)}</div>
										))}
								</div>
							</article>
						),
				)}
			</div>
			{excluded.length > 0 && (
				<Collapsible className="border-t pt-4">
					<CollapsibleTrigger className="text-sm font-medium">
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
										className="truncate text-sm"
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
		</main>
	);
}
