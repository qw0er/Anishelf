import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WatchingAutomationStatus } from "../../shared/api/contracts.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
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

export function WatchingSettings() {
	const { t } = useTranslation();
	const query = useQuery(watchingQuery());
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("acquisition.watching.title")}</CardTitle>
				<CardDescription>
					{t("acquisition.watching.description")}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-4 lg:max-w-2xl">
				{query.data ? (
					<WatchingForm key={query.data.revision} status={query.data} />
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
function WatchingForm({ status }: { status: WatchingAutomationStatus }) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const profiles = useQuery(acquisitionProfilesQuery());
	const [backlog, setBacklog] = useState<"progress" | "beginning">(
		status.config?.backlog ?? "progress",
	);
	const [profileId, setProfileId] = useState(status.config?.profileId ?? "");
	const preview = useMutation({
		mutationFn: () =>
			previewWatching(status.revision, {
				backlog,
				profileId: profileId || profiles.data?.selectedProfileId || "",
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
				paused: work.paused,
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
			<p role="status">{watchingReason(status.reason)}</p>
			<p className="text-sm text-muted-foreground">
				{t("acquisition.watching.scopeHelp")}
			</p>
			<label className="block space-y-1">
				<span>{t("acquisition.watching.backlog")}</span>
				<select
					className="w-full rounded-md border bg-background p-2"
					value={backlog}
					disabled={busy}
					onChange={(event) => {
						setBacklog(event.target.value as "progress" | "beginning");
						preview.reset();
					}}
				>
					<option value="progress">
						{t("acquisition.watching.progress")}{" "}
					</option>
					<option value="beginning">
						{t("acquisition.watching.beginning")}{" "}
					</option>
				</select>
			</label>
			<label className="block space-y-1">
				<span>{t("acquisition.watching.profile")}</span>
				<select
					className="w-full rounded-md border bg-background p-2"
					value={profileId || profiles.data?.selectedProfileId || ""}
					disabled={busy || profiles.isPending || profiles.isError}
					onChange={(event) => {
						setProfileId(event.target.value);
						preview.reset();
					}}
				>
					{profiles.data?.profiles.map((profile) => (
						<option key={profile.id} value={profile.id}>
							{profile.name}
						</option>
					))}
				</select>
			</label>
			<div className="action-row">
				<Button
					className="h-auto min-h-9 whitespace-normal py-2"
					variant="outline"
					disabled={busy || profiles.isPending || profiles.isError}
					onClick={() => preview.mutate()}
				>
					{preview.isPending
						? t("acquisition.watching.preparing")
						: t("acquisition.watching.preview")}
				</Button>
				{status.enabled && (
					<Button
						className="h-auto min-h-9 whitespace-normal py-2"
						variant="outline"
						disabled={busy}
						onClick={() => disable.mutate()}
					>
						{t("acquisition.watching.disable")}{" "}
					</Button>
				)}
			</div>
			{(preview.isError ||
				confirm.isError ||
				disable.isError ||
				override.isError) && (
				<p role="alert">{t("acquisition.watching.updateFailed")}</p>
			)}
			{preview.isSuccess && preview.data && (
				<div className="space-y-2 rounded-md border p-3">
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
					<Button
						className="h-auto min-h-9 whitespace-normal py-2"
						disabled={busy || preview.data.expiresAt <= Date.now()}
						onClick={() => confirm.mutate()}
					>
						{t("acquisition.watching.confirm")}{" "}
					</Button>
				</div>
			)}
			{status.works.length > 0 && (
				<details>
					<summary>
						{t("acquisition.watching.management", {
							count: status.works.length,
						})}
					</summary>
					<div className="max-h-96 space-y-3 overflow-auto pt-3">
						{status.works.map((work) => (
							<div
								key={work.workKey}
								className="space-y-1 border-b pb-2 text-sm"
							>
								<p>
									<a
										className="underline break-words"
										href={`/anime/tracked/${encodeURIComponent(work.workKey)}`}
									>
										{work.title}
									</a>
									{work.startEpisode !== null
										? ` · ${t("acquisition.watching.fromEpisode", { episode: work.startEpisode })}`
										: ""}
								</p>
								<p>{watchingReason(work.reason)}</p>
								<div className="action-row">
									<Button
										className="h-auto min-h-9 whitespace-normal py-2"
										variant="ghost"
										disabled={busy || !status.accountId}
										onClick={() =>
											override.mutate({ ...work, excluded: !work.excluded })
										}
									>
										{work.excluded
											? t("acquisition.watching.include")
											: t("acquisition.watching.exclude")}
									</Button>
									{work.managed && !work.excluded && (
										<Button
											className="h-auto min-h-9 whitespace-normal py-2"
											variant="ghost"
											disabled={busy}
											onClick={() =>
												override.mutate({ ...work, paused: !work.paused })
											}
										>
											{work.paused
												? t("acquisition.watching.resume")
												: t("acquisition.watching.pause")}
										</Button>
									)}
								</div>
							</div>
						))}
					</div>
				</details>
			)}
		</div>
	);
}
