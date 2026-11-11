import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronRight,
	CircleMinus,
	Ellipsis,
	Pause,
	Pencil,
	Play,
	RefreshCw,
	Rss,
	Settings,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { useRef, useState } from "react";
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
import { StatusBadge } from "../../shared/components/ui/status-badge.js";
import { toast } from "../../shared/components/ui/toast.js";
import {
	type AnimeStatusState,
	animeStatusQuery,
	invalidateAnimeQueries,
} from "../anime/public.js";
import {
	DownloadActivityPanel,
	SubscriptionIssue,
} from "./download-activity.js";
import { downloadKeys } from "./downloads-api.js";
import { SubscriptionForm } from "./subscription-form.js";
import { subscriptionStatus } from "./subscription-status.js";
import {
	acquisitionProfilesQuery,
	refreshSubscription,
	removeSubscription,
	type SubscriptionListItem,
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
	inventory,
}: {
	workKey: string;
	status?: AnimeStatusState;
	activityRequested?: boolean;
	compact?: boolean;
	inventory?: {
		title: string;
		view: SubscriptionView;
		onExclude?: () => void;
		excludePending?: boolean;
	};
	onActivityClose?: () => void;
}) {
	const { t, i18n } = useTranslation();
	const client = useQueryClient();
	const detailsTrigger = useRef<HTMLButtonElement>(null);
	const actionsTrigger = useRef<HTMLButtonElement>(null);
	const editorReturnFocus = useRef<HTMLButtonElement | null>(null);
	const profiles = useQuery(acquisitionProfilesQuery());
	const [editor, setEditor] = useState<{
			current: SubscriptionView["subscription"];
		} | null>(null),
		[activityOpen, setActivityOpen] = useState(false);
	const fallback = useQuery({
		...animeStatusQuery(workKey, useQueryScope()),
		enabled: !status && !inventory,
	});
	const query = status ?? fallback;
	const view = inventory?.view ?? query.data?.subscription,
		sub = view?.subscription;
	const pending = !inventory && query.isPending;
	const failed = !inventory && query.isError;
	const state = subscriptionStatus(sub ?? null);
	const { cooling } = state;
	const needsAttention = failed || state.needsAttention;

	let summary = t(
		sub
			? "acquisition.subscription.subscribed"
			: "acquisition.subscription.notSubscribed",
	);
	if (sub?.runState === "completed")
		summary = t("acquisition.subscription.completed");
	else if (cooling && sub)
		summary = t("acquisition.subscription.cooldownUntil", {
			time: new Date(sub.nextAttemptAt).toLocaleString(i18n.language),
		});
	else if (needsAttention) summary = state.label;
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
	const rowSummary = compact ? state.label : summary;

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
		if (inventory && result) {
			await client.cancelQueries({
				queryKey: ["acquisition", "subscription", "list"],
			});
			client.setQueryData<SubscriptionListItem[]>(
				["acquisition", "subscription", "list"],
				(previous) =>
					previous?.flatMap((item) =>
						item.view.subscription?.workKey === workKey
							? result.subscription
								? [{ ...item, view: result }]
								: []
							: [item],
					),
			);
		}
		setEditor(null);
		void client.invalidateQueries({
			queryKey: ["acquisition", "subscription", "list"],
		});
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
		onSuccess: async (result, command) => {
			console.info("[acquisition] Subscription command completed.", {
				workKey,
				command,
			});
			await updated(result);
			toast.add({
				type: "success",
				title: t("acquisition.subscription.updated"),
			});
		},
		onError: (_error, command) => {
			console.warn("[acquisition] Subscription command failed.", {
				workKey,
				command,
			});
			updated();
			toast.add({
				type: "error",
				title: t("acquisition.subscription.updateFailed"),
			});
		},
	});
	const feedback = {
		view: view ?? { subscription: null },
		onCheckUpdates: () => action.mutate("refresh"),
		checking: action.isPending,
		reason: (code: string) =>
			t(`acquisition.reason.${code}`, {
				defaultValue: i18n.exists(`acquisition.watching.reasons.${code}`)
					? watchingReason(code)
					: t("acquisition.reason.fallback"),
			}),
		onConfigure: () => {
			editorReturnFocus.current = detailsTrigger.current;
			setActivityOpen(false);
			onActivityClose?.();
			setEditor({ current: sub ?? null });
		},
	};

	return (
		<section
			className={compact ? "min-w-0" : "min-w-0 border-t pt-3"}
			aria-label={t("acquisition.subscription.aria")}
			aria-busy={!inventory && query.isFetching}
		>
			<div className="flex min-w-0 items-center justify-between gap-2 text-sm">
				{compact && (
					<StatusBadge
						tone={state.tone}
						className="min-w-0 gap-1.5 whitespace-normal"
					>
						{needsAttention && (
							<TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
						)}
						{rowSummary}
					</StatusBadge>
				)}
				<Button
					ref={detailsTrigger}
					variant={compact ? "outline" : "ghost"}
					className={
						compact ? "ml-auto shrink-0" : "min-w-0 justify-start gap-2 px-0"
					}
					disabled={!sub && !needsAttention}
					onClick={() => {
						console.debug("[acquisition] Subscription details opened.", {
							workKey,
						});
						setActivityOpen(true);
					}}
					aria-label={t("acquisition.subscription.activity")}
				>
					{!compact && <Rss className="size-4 shrink-0" aria-hidden="true" />}
					<span
						role="status"
						className={
							!compact && needsAttention ? "text-destructive" : undefined
						}
					>
						{pending
							? t("acquisition.subscription.loading")
							: failed && !view
								? t("acquisition.subscription.unavailable")
								: compact
									? t("acquisition.manager.details")
									: rowSummary}
					</span>
					{!compact && (sub || needsAttention) && (
						<ChevronRight
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					)}
				</Button>
				<div className="flex shrink-0 items-center gap-1">
					{!sub && !pending && !failed && (
						<Button
							variant="outline"
							onClick={(event) => {
								editorReturnFocus.current = event.currentTarget;
								setEditor({ current: sub ?? null });
							}}
						>
							{t("acquisition.subscription.subscribe")}
						</Button>
					)}
					{sub && (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										ref={actionsTrigger}
										variant="ghost"
										className="size-9 p-0"
										aria-label={t("acquisition.subscription.actions")}
										disabled={action.isPending || inventory?.excludePending}
										aria-busy={action.isPending || inventory?.excludePending}
									/>
								}
							>
								<Ellipsis className="size-4" aria-hidden="true" />
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								{sub.management === "watching" && !inventory && (
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
									onClick={() => {
										editorReturnFocus.current = actionsTrigger.current;
										setEditor({ current: sub ?? null });
									}}
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
								{inventory?.onExclude && (
									<DropdownMenuItem
										disabled={inventory.excludePending}
										onClick={inventory.onExclude}
									>
										<CircleMinus size={16} aria-hidden="true" />
										{t("acquisition.watching.exclude")}
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
					{failed && !view && (
						<Button variant="ghost" onClick={() => void query.refetch()}>
							{t("acquisition.subscription.retry")}
						</Button>
					)}
				</div>
			</div>
			{failed && view && (
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
				<DialogContent
					finalFocus={() =>
						editorReturnFocus.current?.isConnected
							? editorReturnFocus.current
							: detailsTrigger.current
					}
				>
					<DialogHeader>
						<DialogTitle>
							{t(
								editor?.current
									? "acquisition.subscription.manageTitle"
									: "acquisition.subscription.subscribeTitle",
							)}
						</DialogTitle>
						{inventory && (
							<p className="wrap-anywhere text-sm text-muted-foreground">
								{inventory.title}
							</p>
						)}
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
				<DialogContent
					className="max-h-[85dvh] overflow-y-auto"
					finalFocus={() => (editor ? false : detailsTrigger.current)}
				>
					<DialogHeader>
						<DialogTitle>{t("acquisition.subscription.activity")}</DialogTitle>
						{inventory && (
							<p className="wrap-anywhere text-sm text-muted-foreground">
								{inventory.title}
							</p>
						)}
					</DialogHeader>
					{sub && (
						<div className="space-y-4">
							<p className="font-medium" role="status">
								{summary}
							</p>
							{state.needsAttention && !sub.error && sub.runState && (
								<p className="text-sm text-muted-foreground">
									{watchingReason(sub.runState)}
								</p>
							)}
							<SubscriptionIssue {...feedback} />
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
								<dd className="break-all">
									{sub.sourceKind === "automatic"
										? t("acquisition.subscription.automaticSource")
										: sub.source}
								</dd>
								<dt className="text-muted-foreground">
									{t("acquisition.subscription.releaseProfile")}
								</dt>
								<dd>
									{sub.management === "watching"
										? t("acquisition.watching.previewProfile", {
												name:
													profiles.data?.profiles.find(
														(p) => p.id === profiles.data?.selectedProfileId,
													)?.name ??
													profiles.data?.selectedProfileId ??
													"…",
											})
										: (profiles.data?.profiles.find(
												(p) => p.id === sub.profileId,
											)?.name ??
											sub.profileId ??
											t("acquisition.subscription.followDefault"))}
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
							{sub.management !== "watching" && (
								<Button variant="outline" onClick={feedback.onConfigure}>
									{t("acquisition.subscription.edit")}
								</Button>
							)}
						</div>
					)}
					<DownloadActivityPanel
						subscriptionOnly
						showSubscriptionIssue={false}
						workKey={workKey}
						{...feedback}
					/>
				</DialogContent>
			</Dialog>
		</section>
	);
}
