import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TranscodeProfileCatalog } from "../../../shared/api/contracts.js";
import { ProfileIssueNotice } from "../../../shared/components/profile-issue-notice.js";
import { Button } from "../../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import {
	RadioCard,
	RadioCardGroup,
} from "../../../shared/components/ui/radio-card.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { getErrorTranslationKey } from "../../../shared/lib/error-translation.js";
import { selectTranscodeProfile } from "../api.js";

export function PreparationProfileSettings({
	preparation,
	action,
}: {
	preparation: {
		catalog: TranscodeProfileCatalog | null;
		catalogError: unknown;
		updateCatalog(value: TranscodeProfileCatalog): void;
		refreshCatalog(): void;
	};
	action: {
		busy: boolean;
		run(action: (signal: AbortSignal) => Promise<void>): Promise<void>;
	};
}) {
	const { t } = useTranslation();
	const [mode, setMode] =
		useState<TranscodeProfileCatalog["preparationMode"]>("compatible");
	const [profileId, setProfileId] = useState("");
	useEffect(() => {
		setMode(preparation.catalog?.preparationMode ?? "compatible");
		setProfileId(
			preparation.catalog?.selectionAvailable
				? preparation.catalog.selectedProfileId
				: "",
		);
	}, [preparation.catalog]);
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("preparation.profile")}</CardTitle>
				<CardDescription>
					{t("preparation.settingsDescription")}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{preparation.catalog?.issue && (
					<ProfileIssueNotice
						kind="transcode"
						issue={preparation.catalog.issue}
					/>
				)}
				{preparation.catalog ? (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void action.run(async (signal) => {
								const catalog = await selectTranscodeProfile(
									profileId,
									{ signal },
									mode,
								);
								if (!signal.aborted) {
									preparation.updateCatalog(catalog);
									toast.add({
										type: "success",
										title: t("preparation.profileSaved"),
									});
								}
							});
						}}
					>
						<RadioCardGroup
							legend={t("preparation.preparationMode")}
							disabled={action.busy}
						>
							{(["compatible", "fast"] as const).map((value) => (
								<RadioCard
									key={value}
									name="preparation-mode"
									checked={mode === value}
									onChange={() => setMode(value)}
									title={t(`preparation.${value}Mode`)}
									description={t(`preparation.${value}Description`)}
								/>
							))}
						</RadioCardGroup>
						<RadioCardGroup
							legend={t("preparation.chooseProfile")}
							disabled={action.busy}
						>
							{preparation.catalog.profiles.map((profile) => (
								<RadioCard
									key={profile.id}
									name="transcode-profile"
									value={profile.id}
									checked={profileId === profile.id}
									onChange={() => setProfileId(profile.id)}
									title={profile.name}
									meta={t("preparation.profileFormat", {
										container: profile.container.toUpperCase(),
										videoEncoder: profile.videoEncoder,
										audioEncoder: profile.audioEncoder,
									})}
									description={profile.description}
								/>
							))}
						</RadioCardGroup>
						<Button type="submit" disabled={!profileId || action.busy}>
							{t("preparation.saveProfile")}
						</Button>
					</form>
				) : preparation.catalogError ? (
					<>
						<p role="alert">
							{t(
								getErrorTranslationKey(preparation.catalogError) ??
									"errors.requestFailed",
							)}
						</p>
						<Button variant="outline" onClick={preparation.refreshCatalog}>
							{t("actions.retry")}
						</Button>
					</>
				) : (
					<p role="status">{t("preparation.loadingProfiles")}</p>
				)}
			</CardContent>
		</Card>
	);
}
