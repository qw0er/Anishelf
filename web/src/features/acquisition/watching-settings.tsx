import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pause, Play, Plus, Rss, Save } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isRequestCancelled } from "../../shared/api/client.js";
import type { WatchingAutomationStatus } from "../../shared/api/contracts.js";
import {
	ActionButton,
	ActionLink,
} from "../../shared/components/ui/action-button.js";
import { Button, buttonStyles } from "../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../shared/components/ui/collapsible.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../shared/components/ui/dialog.js";
import {
	RadioCard,
	RadioCardGroup,
} from "../../shared/components/ui/radio-card.js";
import { StatusBadge } from "../../shared/components/ui/status-badge.js";
import { toast } from "../../shared/components/ui/toast.js";
import { useRefreshError } from "../../shared/hooks/use-refresh-error.js";
import { invalidateAnimeQueries } from "../anime/public.js";
import { acquisitionProfilesQuery } from "./subscriptions-api.js";
import {
	confirmWatching,
	disableWatching,
	overrideWatching,
	previewWatching,
	watchingKey,
	watchingQuery,
} from "./watching-api.js";
import { watchingReason } from "./watching-reason.js";

export function WatchingSettings({
	management = false,
}: {
	management?: boolean;
}) {
	const { t } = useTranslation();
	const query = useQuery(watchingQuery());
	useRefreshError(
		"watching-automation",
		query.data ? query.error : null,
		query.errorUpdatedAt,
		() => void query.refetch(),
	);
	return (
		<Card
			className={
				management ? "border-0 shadow-none" : "settings-section lg:grid"
			}
		>
			<CardHeader>
				<CardTitle>
					{t(
						management
							? "acquisition.subscription.manageAutomatic"
							: "acquisition.watching.title",
					)}
				</CardTitle>
				<CardDescription>
					{t("acquisition.watching.description")}
				</CardDescription>
				{query.data && (
					<div role="status" className="space-y-2 text-sm">
						<StatusBadge>
							{t(
								query.data.enabled
									? "acquisition.watching.enabled"
									: "acquisition.watching.disabled",
							)}
						</StatusBadge>
						{query.data.reason !== "ready" &&
							query.data.reason !== "disabled" && (
								<p className="text-muted-foreground">
									{watchingReason(query.data.reason)}
								</p>
							)}
					</div>
				)}
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-4 lg:max-w-2xl">
				{query.data ? (
					<WatchingForm
						key={query.data.revision}
						status={query.data}
						management={management}
					/>
				) : (
					<p role={query.isError ? "alert" : "status"}>
						{query.isError
							? t("acquisition.watching.loadFailed")
							: t("acquisition.watching.loading")}
						{query.isError && (
							<Button variant="outline" onClick={() => void query.refetch()}>
								{t("actions.retry")}
							</Button>
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
function WatchingForm({
	status,
	management,
}: {
	status: WatchingAutomationStatus;
	management: boolean;
}) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const profiles = useQuery(acquisitionProfilesQuery());
	const [backlog, setBacklog] = useState<"progress" | "beginning">(
		status.config?.backlog ?? "progress",
	);
	const profileId = profiles.data?.selectedProfileId ?? "";
	const noticeId = "watching-command";
	const feedback = {
		onMutate: () => toast.close(noticeId),
		onError: (error: Error) => {
			if (isRequestCancelled(error)) return;
			console.warn("[Acquisition] Watching command failed.");
			toast.add({
				id: noticeId,
				type: "error",
				title: t("acquisition.watching.updateFailed"),
			});
		},
	};
	const preview = useMutation({
		...feedback,
		mutationFn: () =>
			previewWatching(status.revision, {
				backlog,
			}),
	});
	const update = (updated: WatchingAutomationStatus) => {
		client.setQueryData(watchingKey, updated);
		void client.invalidateQueries({ queryKey: watchingKey });
		void client.invalidateQueries({
			queryKey: ["acquisition", "subscription"],
		});
		void client.invalidateQueries({ queryKey: ["acquisition", "downloads"] });
		void invalidateAnimeQueries(client, "acquisition");
		preview.reset();
	};
	const confirm = useMutation({
		...feedback,
		mutationFn: () => {
			if (!preview.data) throw Error("Preview required");
			return confirmWatching(preview.data.id);
		},
		onSuccess: update,
	});
	const disable = useMutation({
		...feedback,
		mutationFn: () => disableWatching(status.revision),
		onSuccess: update,
	});
	const override = useMutation({
		...feedback,
		mutationFn: (
			work: WatchingAutomationStatus["works"][number] & {
				excluded: boolean;
				paused: boolean;
			},
		) => {
			if (!status.accountId) throw Error("Connect a tracking account first");
			return overrideWatching({
				accountId: status.accountId,
				trackingGeneration: status.trackingGeneration,
				workKey: work.workKey,
				revision: work.revision,
				excluded: work.excluded,
				paused: false,
			});
		},
		onSuccess: update,
	});
	const busy =
		preview.isPending ||
		confirm.isPending ||
		disable.isPending ||
		override.isPending;
	const activationLabel = t(
		status.enabled
			? "acquisition.watching.update"
			: "acquisition.watching.enable",
	);
	const activationShortLabel = t(
		status.enabled ? "actions.save" : "actions.enable",
	);
	return (
		<div className="space-y-3">
			{!management && (
				<>
					<RadioCardGroup
						name="watching-backlog"
						value={backlog}
						onValueChange={(value) => {
							setBacklog(value as "progress" | "beginning");
							preview.reset();
						}}
						legend={t("acquisition.watching.backlog")}
						disabled={busy}
						className="grid gap-2 space-y-0 sm:grid-cols-2"
					>
						{(["progress", "beginning"] as const).map((value) => (
							<RadioCard
								key={value}
								value={value}
								title={t(`acquisition.watching.${value}`)}
								description={t(`acquisition.watching.${value}Description`)}
							/>
						))}
					</RadioCardGroup>
					{profiles.isError ||
					(profiles.data && !profiles.data.selectionAvailable) ? (
						<p role="alert" className="field-error">
							{t("acquisition.rss.loadProfilesFailed")}
						</p>
					) : null}
					<div className="action-row">
						<ActionButton
							icon={status.enabled ? Save : Play}
							aria-busy={preview.isPending}
							label={activationLabel}
							shortLabel={activationShortLabel}
							disabled={
								busy ||
								!profileId ||
								!profiles.data?.selectionAvailable ||
								profiles.isError
							}
							onClick={() => preview.mutate()}
						/>
						{status.enabled && (
							<ActionButton
								icon={Pause}
								label={t("acquisition.watching.disable")}
								shortLabel={t("actions.disable")}
								variant="outline"
								disabled={busy}
								aria-busy={disable.isPending}
								onClick={() => disable.mutate()}
							/>
						)}
						<ActionLink
							icon={Rss}
							label={t("acquisition.subscription.manageAutomatic")}
							shortLabel={t("acquisition.subscription.manage")}
							href="/subscriptions"
						/>
					</div>
				</>
			)}
			{preview.isSuccess && preview.data && (
				<Dialog
					open
					onOpenChange={(open) => {
						if (!open && !confirm.isPending) preview.reset();
					}}
				>
					<DialogContent
						className="max-h-[85dvh] overflow-y-auto"
						showCloseButton={false}
					>
						<DialogHeader>
							<DialogTitle>
								{t(
									status.enabled
										? "acquisition.watching.updateTitle"
										: "acquisition.watching.enableTitle",
								)}
							</DialogTitle>
							<DialogDescription>
								{t("acquisition.watching.scopeSummary", {
									count: preview.data.works.length,
								})}
							</DialogDescription>
						</DialogHeader>
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
							<dt className="text-muted-foreground">
								{t("acquisition.watching.backlog")}
							</dt>
							<dd>
								{t(`acquisition.watching.${preview.data.config.backlog}`)}
							</dd>
							<dt className="text-muted-foreground">
								{t("acquisition.watching.destination")}
							</dt>
							<dd className="wrap-anywhere">{preview.data.destination}</dd>
						</dl>
						{preview.data.works.length > 0 && (
							<Collapsible>
								<CollapsibleTrigger className="group flex cursor-pointer items-center gap-1.5 text-sm font-medium">
									<ChevronRight
										className="size-4 shrink-0 motion-safe:transition-transform group-aria-expanded:rotate-90"
										aria-hidden="true"
									/>
									{t("acquisition.watching.workDetails")}
								</CollapsibleTrigger>
								<CollapsibleContent keepMounted>
									<ul
										className="mt-2 max-h-64 space-y-2 overflow-auto text-sm"
										aria-label={t("acquisition.watching.workDetails")}
									>
										{preview.data.works.map((work) => (
											<li key={work.workKey}>
												{work.title} ·{" "}
												{work.startEpisode === null
													? t("acquisition.watching.unsupportedStart")
													: t("acquisition.watching.fromEpisode", {
															episode: work.startEpisode,
														})}{" "}
												· {watchingReason(work.reason)}
											</li>
										))}
									</ul>
								</CollapsibleContent>
							</Collapsible>
						)}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={confirm.isPending}
								onClick={() => preview.reset()}
							>
								{t("actions.cancel")}
							</Button>
							<ActionButton
								icon={status.enabled ? Save : Play}
								aria-busy={confirm.isPending}
								label={t(
									status.enabled
										? "acquisition.watching.confirmUpdate"
										: "acquisition.watching.confirmEnable",
								)}
								shortLabel={activationShortLabel}
								disabled={
									busy ||
									!profiles.data?.selectionAvailable ||
									preview.data.expiresAt <= Date.now()
								}
								onClick={() => confirm.mutate()}
							/>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
			{management &&
				status.works.some((work) => work.managed || work.excluded) && (
					<Collapsible defaultOpen>
						<CollapsibleTrigger>
							{t("acquisition.watching.management", {
								count: status.works.filter(
									(work) => work.managed || work.excluded,
								).length,
							})}
						</CollapsibleTrigger>
						<CollapsibleContent keepMounted>
							<div className="max-h-96 space-y-3 overflow-auto pt-3">
								{status.works
									.filter((work) => work.managed || work.excluded)
									.map((work) => (
										<div
											key={work.workKey}
											className="space-y-1 border-b pb-2 text-sm"
										>
											<p>
												<a
													className={buttonStyles(
														"ghost",
														"max-w-full justify-start px-2 -ml-2",
													)}
													href={`/anime/tracked/${encodeURIComponent(work.workKey)}`}
												>
													<span className="truncate">{work.title}</span>
													<ChevronRight
														className="size-4 shrink-0 text-muted-foreground"
														aria-hidden="true"
													/>
												</a>
												{work.startEpisode !== null
													? ` · ${t("acquisition.watching.fromEpisode", { episode: work.startEpisode })}`
													: ""}
											</p>
											<p>{watchingReason(work.reason)}</p>
											<div className="action-row">
												<ActionButton
													icon={Plus}
													label={t(
														work.excluded
															? "acquisition.watching.include"
															: "acquisition.watching.exclude",
													)}
													shortLabel={t(
														work.excluded
															? "actions.include"
															: "actions.exclude",
													)}
													variant="ghost"
													aria-busy={
														override.isPending &&
														override.variables?.workKey === work.workKey
													}
													disabled={busy || !status.accountId}
													onClick={() =>
														override.mutate({
															...work,
															excluded: !work.excluded,
														})
													}
												/>
											</div>
										</div>
									))}
							</div>
						</CollapsibleContent>
					</Collapsible>
				)}
		</div>
	);
}
