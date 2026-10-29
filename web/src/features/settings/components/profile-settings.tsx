import { RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TranscodeProfileCatalog } from "../../../shared/api/contracts.js";
import { ProfileIssueNotice } from "../../../shared/components/profile-issue-notice.js";
import { ActionButton } from "../../../shared/components/ui/action-button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { LoadingState } from "../../../shared/components/ui/loading-state.js";
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
							name="preparation-mode"
							value={mode}
							onValueChange={(value) => setMode(value as "compatible" | "fast")}
							legend={t("preparation.preparationMode")}
							className="grid gap-2 space-y-0 sm:grid-cols-2"
							disabled={action.busy}
						>
							{(["compatible", "fast"] as const).map((value) => (
								<RadioCard
									value={value}
									key={value}
									title={t(`preparation.${value}Mode`)}
									description={t(`preparation.${value}Description`)}
								/>
							))}
						</RadioCardGroup>
						<RadioCardGroup
							name="transcode-profile"
							value={profileId}
							onValueChange={setProfileId}
							legend={t("preparation.chooseProfile")}
							className="grid gap-2 space-y-0 sm:grid-cols-2"
							disabled={action.busy}
						>
							{preparation.catalog.profiles.map((profile) => (
								<RadioCard
									key={profile.id}
									value={profile.id}
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
						<div className="action-row">
							<ActionButton
								icon={Save}
								label={t("preparation.saveProfile")}
								aria-busy={action.busy}
								shortLabel={t("actions.save")}
								type="submit"
								disabled={!profileId || action.busy}
							/>
						</div>
					</form>
				) : preparation.catalogError ? (
					<>
						<p role="alert">
							{t(
								getErrorTranslationKey(preparation.catalogError) ??
									"errors.requestFailed",
							)}
						</p>
						<ActionButton
							icon={RefreshCw}
							label={t("actions.retry")}
							shortLabel={t("actions.retry")}
							variant="outline"
							onClick={preparation.refreshCatalog}
						/>
					</>
				) : (
					<LoadingState label={t("preparation.loadingProfiles")} />
				)}
			</CardContent>
		</Card>
	);
}
