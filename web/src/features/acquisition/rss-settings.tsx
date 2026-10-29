import { rssConstraints } from "@anishelf/backend/contracts/defaults";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ProfileIssueNotice } from "../../shared/components/profile-issue-notice.js";
import { ActionButton } from "../../shared/components/ui/action-button.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
import { InlineError } from "../../shared/components/ui/inline-error.js";
import { Input } from "../../shared/components/ui/input.js";
import { LoadingState } from "../../shared/components/ui/loading-state.js";
import {
	RadioCard,
	RadioCardGroup,
} from "../../shared/components/ui/radio-card.js";
import { toast } from "../../shared/components/ui/toast.js";
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
	const [profileDraft, setProfileDraft] = useState<string | null>(null);
	const profileSave = useMutation({
		mutationFn: (defaultAcquisitionProfileId: string) =>
			saveSettings({ defaultAcquisitionProfileId }),
		onSuccess: (settings) => {
			client.setQueryData(settingsKeys.settings, settings);
			void client.invalidateQueries({ queryKey: ["acquisition"] });
			setProfileDraft(null);
			toast.add({
				type: "success",
				title: t("acquisition.rss.profileSaved"),
			});
		},
		onError: () =>
			toast.add({
				type: "error",
				title: t("acquisition.rss.profileSaveFailed"),
			}),
	});
	const [draft, setDraft] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (rssRefreshIntervalMinutes: number) =>
			saveSettings({ rssRefreshIntervalMinutes }),
		onSuccess: (settings) => {
			client.setQueryData(settingsKeys.settings, settings);
			setDraft(null);
			toast.add({
				type: "success",
				title: t("acquisition.rss.saved"),
				id: "rss-settings-save",
			});
		},
		onError: () => {
			toast.add({
				type: "error",
				title: t("acquisition.rss.saveFailed"),
				id: "rss-settings-save",
			});
		},
	});
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
				{profiles.data && (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							profileSave.mutate(
								profileDraft ?? profiles.data.selectedProfileId,
							);
						}}
					>
						<RadioCardGroup
							legend={t("acquisition.rss.defaultProfile")}
							disabled={profileSave.isPending}
						>
							{!profiles.data.selectionAvailable &&
								!profiles.data.profiles.some(
									(profile) =>
										profile.id ===
										(profileDraft ?? profiles.data.selectedProfileId),
								) && (
									<RadioCard
										name="acquisition-profile"
										checked
										disabled
										onChange={() => {}}
										className="border-dashed"
										title={t("acquisition.rss.unavailableProfile", {
											id: profiles.data.selectedProfileId,
										})}
										description={t("acquisition.rss.resumePrompt")}
									/>
								)}
							{profiles.data.profiles.map((profile) => (
								<RadioCard
									key={profile.id}
									name="acquisition-profile"
									value={profile.id}
									checked={
										(profileDraft ?? profiles.data.selectedProfileId) ===
										profile.id
									}
									onChange={() => setProfileDraft(profile.id)}
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
						<ActionButton
							icon={Save}
							label={t("acquisition.rss.saveProfile")}
							shortLabel={t("actions.save")}
							type="submit"
							disabled={
								profileSave.isPending ||
								!profiles.data.profiles.some(
									(profile) =>
										profile.id ===
										(profileDraft ?? profiles.data.selectedProfileId),
								)
							}
						/>
					</form>
				)}
				{profiles.isError && (
					<InlineError>
						{t("acquisition.rss.loadProfilesFailed")}{" "}
						<Button variant="outline" onClick={() => void profiles.refetch()}>
							{t("acquisition.rss.retryProfiles")}
						</Button>
					</InlineError>
				)}
				{configuration.isPending ? (
					<LoadingState label={t("acquisition.rss.loading")} />
				) : configuration.isError ? (
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
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							save.mutate(
								Number(
									draft ??
										configuration.data.rssRefreshIntervalMinutes ??
										rssConstraints.defaultRefreshIntervalMinutes,
								),
							);
						}}
					>
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
								value={
									draft ??
									configuration.data.rssRefreshIntervalMinutes ??
									rssConstraints.defaultRefreshIntervalMinutes
								}
								onChange={(event) => setDraft(event.target.value)}
								disabled={save.isPending}
							/>
						</label>

						<ActionButton
							icon={Save}
							label={t("acquisition.rss.save")}
							shortLabel={t("actions.save")}
							type="submit"
							disabled={save.isPending}
							aria-busy={save.isPending}
						/>
					</form>
				) : null}
			</CardContent>
		</Card>
	);
}
