import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SubscriptionView } from "../../shared/api/contracts.js";
import { Button } from "../../shared/components/ui/button.js";
import { Input } from "../../shared/components/ui/input.js";
import { toast } from "../../shared/components/ui/toast.js";
import { downloadKeys, getDownloadSettings } from "./downloads-api.js";
import { getSourceConnector, sourceSettingsKey } from "./sources-api.js";
import {
	acquisitionProfilesQuery,
	saveSubscription,
} from "./subscriptions-api.js";

export function SubscriptionForm({
	workKey,
	current,
	onSaved,
}: {
	workKey: string;
	current: SubscriptionView["subscription"];
	onSaved(): void;
}) {
	const { t } = useTranslation();
	const id = useId();
	const client = useQueryClient();
	const profiles = useQuery(acquisitionProfilesQuery());
	const destination = useQuery({
		queryKey: [...downloadKeys, "settings"],
		queryFn: ({ signal }) => getDownloadSettings({ signal }),
	});
	const [start, setStart] = useState(String(current?.startEpisode ?? 1));
	const [profileId, setProfileId] = useState(current?.profileId ?? "");
	const [mode, setMode] = useState<"keep" | "automatic" | "feed">(
		current ? "keep" : "automatic",
	);
	const [url, setUrl] = useState("");
	const needsSource =
		mode === "automatic" ||
		(mode === "keep" && current?.sourceKind === "automatic");
	const sources = useQuery({
		queryKey: sourceSettingsKey,
		enabled: needsSource,
		queryFn: ({ signal }) => getSourceConnector({ signal }),
	});
	const sourceReady = !needsSource || !!sources.data?.ready;
	const target = destination.data?.destination;
	const save = useMutation({
		mutationFn: () => {
			if (!target?.validated) throw new Error("Destination required");
			return saveSubscription({
				workKey,
				revision: current?.revision ?? null,
				startEpisode: Number(start),
				profileId: profileId || null,
				source:
					mode === "automatic"
						? { kind: "automatic" }
						: mode === "feed"
							? { kind: "feed", url: url.trim() }
							: null,
				destinationRevision: target.revision,
				connectionGeneration: target.connectionGeneration,
			});
		},
		onSuccess: () => {
			onSaved();
			toast.add({
				type: "success",
				title: t("acquisition.subscription.updated"),
			});
		},
		onError: () => {
			void client.invalidateQueries({
				queryKey: [...downloadKeys, "settings"],
			});
		},
	});
	const validProfile = profiles.data?.profiles.some(
		(profile) => profile.id === (profileId || profiles.data.selectedProfileId),
	);
	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			<label htmlFor={`${id}-start`} className="block space-y-1">
				<span>{t("acquisition.subscription.startingEpisode")}</span>
				<Input
					id={`${id}-start`}
					type="number"
					min={1}
					max={10000}
					required
					value={start}
					disabled={save.isPending}
					onChange={(event) => setStart(event.target.value)}
				/>
			</label>
			<p className="text-sm text-muted-foreground">
				{t("acquisition.subscription.defaultsSummary", {
					profile:
						profiles.data?.profiles.find(
							(profile) =>
								profile.id === (profileId || profiles.data.selectedProfileId),
						)?.name ?? "…",
				})}
			</p>
			<details>
				<summary className="cursor-pointer text-sm">
					{t("acquisition.subscription.moreOptions")}
				</summary>
				<div className="space-y-3 pt-3">
					<label className="block space-y-1">
						<span>{t("acquisition.subscription.releaseProfile")}</span>
						<select
							className="form-select w-full"
							value={profileId}
							disabled={save.isPending || profiles.isPending}
							onChange={(event) => setProfileId(event.target.value)}
						>
							<option value="">
								{t("acquisition.subscription.followDefault")}
							</option>
							{profiles.data?.profiles.map((profile) => (
								<option key={profile.id} value={profile.id}>
									{profile.name}
								</option>
							))}
						</select>
					</label>
					<label className="block space-y-1">
						<span>{t("acquisition.subscription.source")}</span>
						<select
							className="form-select w-full"
							value={mode}
							disabled={save.isPending}
							onChange={(event) => setMode(event.target.value as typeof mode)}
						>
							{current && (
								<option value="keep">
									{t("acquisition.subscription.keepCurrent")}
								</option>
							)}
							<option value="automatic">
								{t("acquisition.subscription.automaticSource")}
							</option>
							<option value="feed">
								{t("acquisition.subscription.rssUrl")}
							</option>
						</select>
					</label>
					{mode === "feed" && (
						<label htmlFor={`${id}-rss`} className="block space-y-1">
							<span>{t("acquisition.subscription.rssUrl")}</span>
							<Input
								id={`${id}-rss`}
								type="url"
								required
								maxLength={4096}
								value={url}
								onChange={(event) => setUrl(event.target.value)}
								disabled={save.isPending}
							/>
						</label>
					)}
					{current && (
						<p className="break-all text-sm text-muted-foreground">
							{current.source}
						</p>
					)}
					{target && (
						<p className="break-all text-sm text-muted-foreground">
							{target.path}
						</p>
					)}
				</div>
			</details>
			{(!target?.validated ||
				profiles.isError ||
				!validProfile ||
				!sourceReady) &&
				!destination.isPending &&
				!profiles.isPending &&
				(!needsSource || !sources.isPending) && (
					<p role="alert" className="text-sm">
						{t(
							!target?.validated
								? "acquisition.subscription.setupDestination"
								: !validProfile
									? "acquisition.subscription.setupProfile"
									: "acquisition.subscription.setupSources",
						)}{" "}
						<a className="underline" href="/settings?section=downloads">
							{t("acquisition.subscription.settings")}
						</a>
					</p>
				)}
			{save.isError && (
				<p role="alert" className="text-sm">
					{t("acquisition.subscription.saveConflict")}
				</p>
			)}
			<Button
				type="submit"
				disabled={
					save.isPending ||
					!target?.validated ||
					!validProfile ||
					!sourceReady ||
					!Number.isSafeInteger(Number(start)) ||
					Number(start) < 1 ||
					Number(start) > 10000
				}
			>
				{save.isPending
					? t("acquisition.subscription.saving")
					: t(
							current
								? "acquisition.subscription.saveChanges"
								: "acquisition.subscription.subscribe",
						)}
			</Button>
		</form>
	);
}
