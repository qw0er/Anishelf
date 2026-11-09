import { rssConstraints } from "@anishelf/backend/contracts/defaults";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ProfileIssueNotice } from "../../shared/components/profile-issue-notice.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
import { FieldError } from "../../shared/components/ui/field.js";
import { InlineError } from "../../shared/components/ui/inline-error.js";
import { Input } from "../../shared/components/ui/input.js";
import { LoadingState } from "../../shared/components/ui/loading-state.js";
import {
	RadioCard,
	RadioCardGroup,
} from "../../shared/components/ui/radio-card.js";
import { toast } from "../../shared/components/ui/toast.js";
import { useAutoSave } from "../../shared/hooks/use-auto-save.js";
import { useRefreshError } from "../../shared/hooks/use-refresh-error.js";
import {
	saveSettings,
	settingsKeys,
	settingsQuery,
} from "../settings/public.js";

import { acquisitionProfilesQuery } from "./subscriptions-api.js";

export function RssSettings() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const configuration = useQuery(settingsQuery());
	const profiles = useQuery(acquisitionProfilesQuery());
	useRefreshError(
		"settings-configuration",
		configuration.data ? configuration.error : null,
		configuration.errorUpdatedAt,
		() => void configuration.refetch(),
	);
	useRefreshError(
		"acquisition-profiles",
		profiles.data ? profiles.error : null,
		profiles.errorUpdatedAt,
		() => void profiles.refetch(),
	);
	const [profileDraft, setProfileDraft] = useState<string | null>(null);
	const profileSave = useMutation({
		mutationFn: (defaultAcquisitionProfileId: string) =>
			saveSettings({ defaultAcquisitionProfileId }),
		onSuccess: (settings) => {
			client.setQueryData(settingsKeys.settings, settings);
			void client.invalidateQueries({ queryKey: ["acquisition"] });
			setProfileDraft(null);
			console.info("[Settings] Release profile saved.");
			toast.add({
				type: "success",
				title: t("acquisition.rss.profileSaved"),
				id: "rss-profile-save",
			});
		},
		onError: () => {
			console.warn("[Settings] Release profile save failed.");
			toast.add({
				type: "error",
				title: t("acquisition.rss.profileSaveFailed"),
				id: "rss-profile-save",
			});
		},
	});
	const [intervalDraft, setIntervalDraft] = useState<string | null>(null);
	const savedInterval =
		configuration.data?.rssRefreshIntervalMinutes ??
		rssConstraints.defaultRefreshIntervalMinutes;
	const intervalText = intervalDraft ?? String(savedInterval);
	const interval = Number(intervalText);
	const intervalValid =
		intervalText.trim() !== "" &&
		Number.isSafeInteger(interval) &&
		interval >= rssConstraints.minimumRefreshIntervalMinutes &&
		interval <= rssConstraints.maximumRefreshIntervalMinutes;
	const save = useMutation({
		mutationFn: (rssRefreshIntervalMinutes: number) =>
			saveSettings({ rssRefreshIntervalMinutes }),
		onSuccess: (settings, minutes) => {
			client.setQueryData(settingsKeys.settings, settings);
			setIntervalDraft((current) =>
				current !== null && Number(current) === minutes ? null : current,
			);
			console.info("[Settings] RSS refresh interval saved.", { minutes });
			toast.add({
				type: "success",
				title: t("acquisition.rss.saved"),
				id: "rss-settings-save",
			});
		},
		onError: (_error, value) => {
			console.warn("[Settings] RSS refresh interval save failed.");
			toast.add({
				type: "error",
				title: t("acquisition.rss.saveFailed"),
				actionProps: {
					children: t("actions.retry"),
					onClick: () => save.mutate(value),
				},
				id: "rss-settings-save",
			});
		},
	});
	const flushInterval = useAutoSave(
		interval,
		savedInterval,
		(minutes) => save.mutate(minutes),
		intervalDraft !== null && intervalValid,
	);
	const selectedProfileId = profileDraft ?? profiles.data?.selectedProfileId;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("acquisition.rss.title")}</CardTitle>
				<CardDescription>{t("acquisition.rss.description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 lg:max-w-2xl">
				{profiles.data?.issue && (
					<ProfileIssueNotice kind="acquisition" issue={profiles.data.issue} />
				)}
				{profiles.data && selectedProfileId ? (
					<RadioCardGroup
						name="acquisition-profile"
						value={selectedProfileId}
						onValueChange={(value) => {
							if (value === profiles.data.selectedProfileId) return;
							setProfileDraft(value);
							profileSave.mutate(value);
						}}
						legend={t("acquisition.rss.defaultProfile")}
						disabled={profileSave.isPending}
					>
						{!profiles.data.selectionAvailable &&
							!profiles.data.profiles.some(
								(profile) => profile.id === selectedProfileId,
							) && (
								<RadioCard
									value={selectedProfileId}
									disabled
									className="border-dashed"
									title={t("acquisition.rss.unavailableProfile", {
										id: selectedProfileId,
									})}
									description={t("acquisition.rss.resumePrompt")}
								/>
							)}
						{profiles.data.profiles.map((profile) => (
							<RadioCard
								key={profile.id}
								value={profile.id}
								title={profile.name}
								badge={
									profile.source === "custom"
										? t("acquisition.rss.customBadge")
										: undefined
								}
								description={profile.description}
							/>
						))}
					</RadioCardGroup>
				) : null}
				{profiles.isError && !profiles.data && (
					<InlineError>
						{t("acquisition.rss.loadProfilesFailed")}{" "}
						<Button variant="outline" onClick={() => void profiles.refetch()}>
							{t("acquisition.rss.retryProfiles")}
						</Button>
					</InlineError>
				)}
				{configuration.isPending ? (
					<LoadingState label={t("acquisition.rss.loading")} />
				) : configuration.isError && !configuration.data ? (
					<InlineError>
						{t("acquisition.rss.loadFailed")}{" "}
						<Button
							variant="outline"
							onClick={() => {
								void configuration.refetch();
							}}
						>
							{t("actions.retry")}
						</Button>
					</InlineError>
				) : configuration.data ? (
					<div className="space-y-3">
						<label htmlFor="rss-refresh-interval" className="block space-y-2">
							<span className="text-sm font-medium">
								{t("acquisition.rss.refreshInterval")}
							</span>
							<Input
								id="rss-refresh-interval"
								type="number"
								required
								min={rssConstraints.minimumRefreshIntervalMinutes}
								max={rssConstraints.maximumRefreshIntervalMinutes}
								step={1}
								value={intervalText}
								aria-invalid={!intervalValid || undefined}
								aria-describedby={
									!intervalValid ? "rss-refresh-interval-error" : undefined
								}
								onChange={(event) => setIntervalDraft(event.target.value)}
								onBlur={flushInterval}
							/>
						</label>
						<FieldError id="rss-refresh-interval-error" className="field-error">
							{!intervalValid &&
								t("acquisition.rss.invalidInterval", {
									min: rssConstraints.minimumRefreshIntervalMinutes,
									max: rssConstraints.maximumRefreshIntervalMinutes,
								})}
						</FieldError>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
