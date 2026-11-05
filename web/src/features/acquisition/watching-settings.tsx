import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowRight,
	ChevronRight,
	Eye,
	Pause,
	Play,
	Plus,
	Rss,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WatchingAutomationStatus } from "../../shared/api/contracts.js";
import { ActionButton } from "../../shared/components/ui/action-button.js";
import { buttonStyles } from "../../shared/components/ui/button.js";
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
	DialogHeader,
	DialogTitle,
} from "../../shared/components/ui/dialog.js";
import {
	RadioCard,
	RadioCardGroup,
} from "../../shared/components/ui/radio-card.js";
import { StatusBadge } from "../../shared/components/ui/status-badge.js";
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
	const preview = useMutation({
		mutationFn: () =>
			previewWatching(status.revision, {
				backlog,
				profileId,
			}),
	});
	const resetPreview = preview.reset;
	const previousProfile = useRef(profileId);
	useEffect(() => {
		if (previousProfile.current === profileId) return;
		previousProfile.current = profileId;
		resetPreview();
	}, [profileId, resetPreview]);
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
		mutationFn: () => {
			if (!preview.data) throw Error("Preview required");
			return confirmWatching(preview.data.id);
		},
		onSuccess: update,
	});
	const disable = useMutation({
		mutationFn: () => disableWatching(status.revision),
		onSuccess: update,
	});
	const override = useMutation({
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
							icon={Eye}
							aria-busy={preview.isPending}
							label={t("acquisition.watching.preview")}
							shortLabel={t("actions.preview")}
							variant="outline"
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
								onClick={() => disable.mutate()}
							/>
						)}
						<a className={buttonStyles("outline")} href="/subscriptions">
							<Rss className="size-4" aria-hidden="true" />
							{t("acquisition.subscription.manageAutomatic")}
							<ArrowRight
								className="size-4 text-muted-foreground"
								aria-hidden="true"
							/>
						</a>
					</div>
					{(preview.isError ||
						confirm.isError ||
						disable.isError ||
						override.isError) && (
						<p role="alert">{t("acquisition.watching.updateFailed")}</p>
					)}
				</>
			)}
			{preview.isSuccess &&
				preview.data &&
				preview.data.config.profileId === profileId && (
					<Dialog
						open
						onOpenChange={(open) => {
							if (!open) preview.reset();
						}}
					>
						<DialogContent className="max-h-[85dvh] overflow-y-auto">
							<DialogHeader>
								<DialogTitle>
									{t("acquisition.watching.previewLabel")}
								</DialogTitle>
							</DialogHeader>
							<div className="space-y-4 text-sm">
								<p>
									{t("acquisition.watching.previewProfile", {
										name:
											profiles.data?.profiles.find(
												(profile) => profile.id === profileId,
											)?.name ?? profileId,
									})}
								</p>
								<p>
									{t("acquisition.watching.destination", {
										path: preview.data.destination,
									})}
								</p>
								<p>
									{t("acquisition.watching.sites", {
										sites: preview.data.providers.join(" → "),
									})}
								</p>
								<p>
									{t("acquisition.watching.previewHelp", {
										count: preview.data.works.length,
									})}
								</p>
								<Collapsible>
									<CollapsibleTrigger className="cursor-pointer text-sm">
										{t("acquisition.watching.previewLabel")}
									</CollapsibleTrigger>
									<CollapsibleContent keepMounted>
										<ul
											className="max-h-64 overflow-auto text-sm"
											aria-label={t("acquisition.watching.previewLabel")}
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
								<ActionButton
									icon={Play}
									aria-busy={confirm.isPending}
									label={t("acquisition.watching.confirm")}
									shortLabel={t("actions.enable")}
									disabled={busy || preview.data.expiresAt <= Date.now()}
									onClick={() => confirm.mutate()}
								/>
							</div>
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
