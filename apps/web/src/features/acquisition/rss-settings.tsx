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
import { InlineError } from "../../shared/components/ui/inline-error.js";
import { LoadingState } from "../../shared/components/ui/loading-state.js";
import {
	RadioCard,
	RadioCardGroup,
} from "../../shared/components/ui/radio-card.js";
import { toast } from "../../shared/components/ui/toast.js";
import { useRefreshError } from "../../shared/hooks/use-refresh-error.js";
import { saveSettings, settingsKeys } from "../settings/public.js";

import { acquisitionProfilesQuery } from "./subscriptions-api.js";

export function RssSettings() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const profiles = useQuery(acquisitionProfilesQuery());
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
				{profiles.isPending && (
					<LoadingState label={t("acquisition.rss.loadingProfiles")} />
				)}
			</CardContent>
		</Card>
	);
}
