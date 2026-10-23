import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Rss } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	DownloadActivity,
	SubscriptionView,
} from "../../shared/api/contracts.js";
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
import { invalidateAnimeQueries } from "../anime/public.js";
import { activityStatus } from "./activity-status.js";
import { DownloadActivityPanel } from "./download-activity.js";
import { downloadKeys, getDownloadActivity } from "./downloads-api.js";
import { SubscriptionForm } from "./subscription-form.js";
import {
	getSubscription,
	refreshSubscription,
	removeSubscription,
	toggleSubscription,
} from "./subscriptions-api.js";
import { watchingKey } from "./watching-api.js";

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
	const [editing, setEditing] = useState(false),
		[activityOpen, setActivityOpen] = useState(false);
	const query = useQuery({
		queryKey: ["acquisition", "subscription", workKey],
		...(initialView ? { initialData: initialView } : {}),
		queryFn: ({ signal }) => getSubscription(workKey, 1, { signal }),
		refetchInterval: 30000,
	});
	const activity = useQuery({
		queryKey: [...downloadKeys, workKey, 1],
		initialData: initialActivity ?? undefined,
		enabled: initialActivity !== null,
		queryFn: ({ signal }) => getDownloadActivity(workKey, 1, { signal }),
		refetchInterval: 5000,
	});
	const view = query.data,
		sub = view?.subscription,
		tasks = activity.data?.items ?? [];
	const needsAttention =
		activity.isError ||
		(activity.data?.attention ?? 0) > 0 ||
		!!(sub?.error && sub.error !== "no_eligible_source");
	const active = tasks.find(
		(item) =>
			item.state !== "available" &&
			(item.error ||
				item.state === "bound" ||
				item.state === "pending" ||
				item.state === "submitting" ||
				item.state === "unknown"),
	);
	let summary = t(
		sub
			? "acquisition.subscription.subscribed"
			: "acquisition.subscription.notSubscribed",
	);
	if (needsAttention) summary = t("acquisition.activity.needsAttention");
	else if (active)
		summary = t("acquisition.activity.episodeLine", {
			episode: active.episode,
			status: activityStatus(active, t),
		});
	else if (sub && !sub.enabled) summary = t("acquisition.subscription.paused");
	else if (sub?.sourceKind === "automatic")
		summary = t(
			sub.error === "no_eligible_source"
				? "acquisition.subscription.waitingForReleases"
				: "acquisition.subscription.findingSource",
		);
	const updated = () => {
		setEditing(false);
		void client.invalidateQueries({
			queryKey: ["acquisition", "subscription", workKey],
		});
		void client.invalidateQueries({ queryKey: downloadKeys });
		void client.invalidateQueries({ queryKey: watchingKey });
		void invalidateAnimeQueries(client, "acquisition");
	};
	const action = useMutation({
		mutationFn: async (command: "toggle" | "refresh" | "remove") => {
			if (!sub) return;
			if (command === "toggle")
				await toggleSubscription(workKey, sub.revision, !sub.enabled);
			else if (command === "refresh")
				await refreshSubscription(workKey, sub.revision);
			else await removeSubscription(workKey, sub.revision);
		},
		onSuccess: () => {
			updated();
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
			className="min-w-0 border-t pt-3"
			aria-label={t("acquisition.subscription.aria")}
		>
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<Rss
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					<h2 className="font-medium">{t("acquisition.subscription.title")}</h2>
					<span
						role="status"
						className={
							needsAttention ? "text-destructive" : "text-muted-foreground"
						}
					>
						{query.isPending
							? t("acquisition.subscription.loading")
							: query.isError && !view
								? t("acquisition.subscription.unavailable")
								: summary}
					</span>
				</div>
				<div className="flex items-center gap-1">
					{(sub || (activity.data?.total ?? 0) > 0 || needsAttention) && (
						<Button variant="ghost" onClick={() => setActivityOpen(true)}>
							{t("acquisition.subscription.activity")}
							{needsAttention ? " · !" : ""}
						</Button>
					)}
					{!sub && !query.isPending && !query.isError && (
						<Button variant="outline" onClick={() => setEditing(true)}>
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
								<DropdownMenuItem onClick={() => setEditing(true)}>
									{t("acquisition.subscription.edit")}
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={!sub.enabled}
									onClick={() => action.mutate("refresh")}
								>
									{t("acquisition.subscription.checkNow")}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => action.mutate("toggle")}>
									{t(
										sub.enabled
											? "acquisition.subscription.pause"
											: "acquisition.subscription.resume",
									)}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => action.mutate("remove")}>
									{t("acquisition.subscription.remove")}
								</DropdownMenuItem>
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
			<Dialog open={editing} onOpenChange={setEditing}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t(
								sub
									? "acquisition.subscription.manageTitle"
									: "acquisition.subscription.subscribeTitle",
							)}
						</DialogTitle>
					</DialogHeader>
					<SubscriptionForm
						key={sub?.revision ?? "new"}
						workKey={workKey}
						current={sub ?? null}
						onSaved={updated}
					/>
				</DialogContent>
			</Dialog>
			<Dialog open={activityOpen} onOpenChange={setActivityOpen}>
				<DialogContent className="max-h-[85dvh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{t("acquisition.subscription.activity")}</DialogTitle>
					</DialogHeader>
					{view && (
						<DownloadActivityPanel
							workKey={workKey}
							view={view}
							initialActivity={activity.data}
							reason={(code) =>
								t(`acquisition.reason.${code}`, {
									defaultValue: t("acquisition.reason.fallback"),
								})
							}
							onConfigure={() => {
								setActivityOpen(false);
								setEditing(true);
							}}
						/>
					)}
				</DialogContent>
			</Dialog>
		</section>
	);
}
