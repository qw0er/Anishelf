import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronRight,
	Ellipsis,
	Pause,
	Pencil,
	Play,
	RefreshCw,
	Rss,
	Settings,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SubscriptionView } from "../../shared/api/contracts.js";
import { useQueryScope } from "../../shared/api/queries.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../../shared/components/ui/dialog.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../shared/components/ui/dropdown-menu.js";
import { toast } from "../../shared/components/ui/toast.js";
import {
	type AnimeStatusState,
	animeStatusQuery,
	invalidateAnimeQueries,
} from "../anime/public.js";
import { DownloadActivityPanel } from "./download-activity.js";
import { downloadKeys } from "./downloads-api.js";
import { SubscriptionForm } from "./subscription-form.js";
import {
	acquisitionProfilesQuery,
	refreshSubscription,
	removeSubscription,
	toggleSubscription,
} from "./subscriptions-api.js";
import { watchingKey } from "./watching-api.js";
import { watchingReason } from "./watching-reason.js";

export function SubscriptionPanel({
	workKey,
	status,
	activityRequested = false,
	compact = false,
	onActivityClose,
}: {
	workKey: string;
	status?: AnimeStatusState;
	activityRequested?: boolean;
	compact?: boolean;
	onActivityClose?: () => void;
}) {
	const { t, i18n } = useTranslation();
	const client = useQueryClient();
	const profiles = useQuery(acquisitionProfilesQuery());
	const [editor, setEditor] = useState<{
			current: SubscriptionView["subscription"];
		} | null>(null),
		[activityOpen, setActivityOpen] = useState(false);
	const fallback = useQuery({
		...animeStatusQuery(workKey, useQueryScope()),
		enabled: !status,
	});
	const query = status ?? fallback;
	const view = query.data?.subscription,
		sub = view?.subscription;
	const cooling =
		sub?.error === "rate_limited" && sub.nextAttemptAt > Date.now();
	const needsAttention =
		query.isError ||
		!!(
			sub?.error &&
			sub.runState !== "completed" &&
			sub.error !== "no_eligible_source"
		);

	let summary = t(
		sub
			? "acquisition.subscription.subscribed"
			: "acquisition.subscription.notSubscribed",
	);
	if (sub?.runState === "completed")
		summary = t("acquisition.subscription.completed");
	else if (cooling)
		summary = t("acquisition.subscription.cooldownUntil", {
			time: new Date(sub.nextAttemptAt).toLocaleString(i18n.language),
		});
	else if (needsAttention) summary = t("acquisition.activity.needsAttention");
	else if (sub && !sub.enabled) summary = t("acquisition.subscription.paused");
	else if (
		sub?.management === "watching" &&
		sub.runState &&
		sub.runState !== "active"
	)
		summary = watchingReason(sub.runState);
	else if (sub?.sourceKind === "automatic")
		summary = t(
			sub.error === "no_eligible_source"
				? "acquisition.subscription.waitingForReleases"
				: "acquisition.subscription.findingSource",
		);
	else if (sub?.management === "watching")
		summary =
			sub.runState && sub.runState !== "active"
				? watchingReason(sub.runState)
				: t("acquisition.subscription.automaticManaged");
	let rowSummary = summary;
	if (compact) {
		if (cooling) rowSummary = t("acquisition.manager.cooldown");
		else if (!needsAttention && sub?.enabled && sub.runState !== "completed") {
			if (
				sub.management === "watching" &&
				sub.runState &&
				sub.runState !== "active"
			)
				rowSummary = watchingReason(sub.runState, true);
			else if (sub.sourceKind === "automatic")
				rowSummary = t(
					sub.error === "no_eligible_source"
						? "acquisition.manager.waiting"
						: "acquisition.manager.searching",
				);
			else rowSummary = t("acquisition.manager.active");
		}
	}
	const updated = async (result?: SubscriptionView) => {
		await client.cancelQueries({
			queryKey: ["anime-status"],
			predicate: (query) => query.queryKey[2] === workKey,
		});
		if (result)
			client.setQueriesData<
				import("../../shared/api/contracts.js").AnimeStatusResponse
			>(
				{
					queryKey: ["anime-status"],
					predicate: (query) => query.queryKey[2] === workKey,
				},
				(previous) =>
					previous
						? {
								...previous,
								subscription: { subscription: result.subscription },
							}
						: undefined,
			);
		setEditor(null);
		void client.invalidateQueries({
			queryKey: ["acquisition", "subscription", workKey],
		});
		void client.invalidateQueries({ queryKey: [...downloadKeys, workKey] });
		void client.invalidateQueries({ queryKey: watchingKey });
		void invalidateAnimeQueries(client, "acquisition", workKey);
	};
	const action = useMutation({
		mutationFn: async (command: "toggle" | "refresh" | "remove") => {
			if (!sub) return;
			if (command === "toggle")
				return toggleSubscription(
					workKey,
					sub.revision,
					sub.runState === "completed" || !sub.enabled,
				);
			else if (command === "refresh")
				return refreshSubscription(workKey, sub.revision);
			else {
				await removeSubscription(workKey, sub.revision);
				return {
					subscription: null,
					candidates: [],
					total: 0,
					page: 1,
				} satisfies SubscriptionView;
			}
		},
		onSuccess: async (result) => {
			await updated(result);
			toast.add({
				type: "success",
				title: t("acquisition.subscription.updated"),
			});
		},
		onError: () => {
			updated();
			toast.add({
				type: "error",
				title: t("acquisition.subscription.updateFailed"),
			});
		},
	});
	return (
		<section
			className={compact ? "min-w-0" : "min-w-0 border-t pt-3"}
			aria-label={t("acquisition.subscription.aria")}
			aria-busy={query.isFetching}
		>
			<div className="flex min-w-0 items-center justify-between gap-2 text-sm">
				<Button
					variant="ghost"
					className="min-w-0 justify-start gap-2 px-0"
					disabled={!sub && !needsAttention}
					onClick={() => setActivityOpen(true)}
					aria-label={t("acquisition.subscription.activity")}
				>
					<Rss className="size-4 shrink-0" aria-hidden="true" />
					<span
						role="status"
						className={`truncate ${needsAttention ? "text-destructive" : ""}`}
					>
						{query.isPending
							? t("acquisition.subscription.loading")
							: query.isError && !view
								? t("acquisition.subscription.unavailable")
								: rowSummary}
					</span>
					{(sub || needsAttention) && (
						<ChevronRight
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					)}
				</Button>
				<div className="flex shrink-0 items-center gap-1">
					{!sub && !query.isPending && !query.isError && (
						<Button
							variant="outline"
							onClick={() => setEditor({ current: sub ?? null })}
						>
							{t("acquisition.subscription.subscribe")}
						</Button>
					)}
					{sub && (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="ghost"
										className="size-9 p-0"
										aria-label={t("acquisition.subscription.actions")}
										disabled={action.isPending}
									/>
								}
							>
								<Ellipsis className="size-4" aria-hidden="true" />
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								{sub.management === "watching" && (
									<DropdownMenuItem
										onClick={() => {
											window.location.href = "/subscriptions";
										}}
									>
										<Settings size={16} aria-hidden="true" />
										{t("acquisition.subscription.manageAutomatic")}
									</DropdownMenuItem>
								)}
								<DropdownMenuItem
									onClick={() => setEditor({ current: sub ?? null })}
								>
									<Pencil size={16} aria-hidden="true" />
									{t(
										sub.management === "watching"
											? "acquisition.subscription.convertToManual"
											: "acquisition.subscription.edit",
									)}
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={
										!sub.enabled ||
										(!!sub.runState && sub.runState !== "active") ||
										cooling
									}
									onClick={() => action.mutate("refresh")}
								>
									<RefreshCw size={16} aria-hidden="true" />
									{t("acquisition.subscription.checkNow")}
								</DropdownMenuItem>
								{(sub.management !== "watching" ||
									sub.runState === "completed") && (
									<DropdownMenuItem onClick={() => action.mutate("toggle")}>
										{sub.enabled && sub.runState !== "completed" ? (
											<Pause size={16} aria-hidden="true" />
										) : (
											<Play size={16} aria-hidden="true" />
										)}
										{t(
											sub.enabled && sub.runState !== "completed"
												? "acquisition.subscription.pause"
												: "acquisition.subscription.resume",
										)}
									</DropdownMenuItem>
								)}
								{sub.management !== "watching" && (
									<DropdownMenuItem
										variant="destructive"
										onClick={() => action.mutate("remove")}
									>
										<Trash2 size={16} aria-hidden="true" />
										{t("acquisition.subscription.remove")}
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
					{query.isError && !view && (
						<Button variant="ghost" onClick={() => void query.refetch()}>
							{t("acquisition.subscription.retry")}
						</Button>
					)}
				</div>
			</div>
			{query.isError && view && (
				<p role="status" className="text-sm text-muted-foreground">
					{t("acquisition.activity.statusUnavailable")}{" "}
					{query.dataUpdatedAt > 0 &&
						t("acquisition.activity.lastUpdated", {
							time: new Date(query.dataUpdatedAt).toLocaleString(i18n.language),
						})}
					<Button variant="ghost" onClick={() => void query.refetch()}>
						{t("actions.retry")}
					</Button>
				</p>
			)}

			<Dialog
				open={editor !== null}
				onOpenChange={(open) =>
					setEditor(open ? { current: sub ?? null } : null)
				}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t(
								editor?.current
									? "acquisition.subscription.manageTitle"
									: "acquisition.subscription.subscribeTitle",
							)}
						</DialogTitle>
					</DialogHeader>
					{editor && (
						<SubscriptionForm
							workKey={workKey}
							current={editor.current}
							onSaved={(result) => {
								void updated(result);
							}}
						/>
					)}
				</DialogContent>
			</Dialog>
			<Dialog
				open={activityOpen || activityRequested}
				onOpenChange={(open) => {
					setActivityOpen(open);
					if (!open) onActivityClose?.();
				}}
			>
				<DialogContent className="max-h-[85dvh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{t("acquisition.subscription.activity")}</DialogTitle>
					</DialogHeader>
					{sub && (
						<div className="space-y-4">
							<p className="font-medium" role="status">
								{summary}
							</p>
							<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 border-y py-4 text-sm">
								<dt className="text-muted-foreground">
									{t("acquisition.subscription.policy")}
								</dt>
								<dd>
									{t(
										sub.management === "watching"
											? "acquisition.subscription.automaticManaged"
											: "acquisition.manager.manual",
									)}
								</dd>
								<dt className="text-muted-foreground">
									{t("acquisition.subscription.startingEpisode")}
								</dt>
								<dd>{sub.startEpisode}</dd>
								<dt className="text-muted-foreground">
									{t("acquisition.subscription.source")}
								</dt>
								<dd className="break-all">{sub.source}</dd>
								<dt className="text-muted-foreground">
									{t("acquisition.subscription.releaseProfile")}
								</dt>
								<dd>
									{profiles.data?.profiles.find(
										(profile) => profile.id === sub.profileId,
									)?.name ??
										sub.profileId ??
										t("acquisition.subscription.followDefault")}
								</dd>
								<dt className="text-muted-foreground">
									{t("acquisition.manager.lastCheck")}
								</dt>
								<dd>
									{sub.checkedAt
										? new Date(sub.checkedAt).toLocaleString(i18n.language)
										: t("acquisition.manager.notChecked")}
								</dd>
							</dl>
							<Button
								variant="outline"
								onClick={() => {
									setActivityOpen(false);
									onActivityClose?.();
									setEditor({ current: sub });
								}}
							>
								{t(
									sub.management === "watching"
										? "acquisition.subscription.convertToManual"
										: "acquisition.subscription.edit",
								)}
							</Button>
						</div>
					)}
					{
						<DownloadActivityPanel
							subscriptionOnly
							workKey={workKey}
							view={view ?? { subscription: null }}
							onCheckUpdates={() => action.mutate("refresh")}
							checking={action.isPending}
							reason={(code) =>
								t(`acquisition.reason.${code}`, {
									defaultValue: t("acquisition.reason.fallback"),
								})
							}
							onConfigure={() => {
								setActivityOpen(false);
								onActivityClose?.();
								setEditor({ current: sub ?? null });
							}}
						/>
					}
				</DialogContent>
			</Dialog>
		</section>
	);
}
