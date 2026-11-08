import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
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

type PreparationMode = TranscodeProfileCatalog["preparationMode"];

export function PreparationProfileSettings({
	preparation,
}: {
	preparation: {
		catalog: TranscodeProfileCatalog | null;
		catalogError: unknown;
		updateCatalog(value: TranscodeProfileCatalog): void;
		refreshCatalog(): void;
	};
}) {
	const { t } = useTranslation();
	const [mode, setMode] = useState<PreparationMode>("compatible");
	const [profileId, setProfileId] = useState("");
	useEffect(() => {
		setMode(preparation.catalog?.preparationMode ?? "compatible");
		setProfileId(
			preparation.catalog?.selectionAvailable
				? preparation.catalog.selectedProfileId
				: "",
		);
	}, [preparation.catalog]);
	const revert = () => {
		setMode(preparation.catalog?.preparationMode ?? "compatible");
		setProfileId(
			preparation.catalog?.selectionAvailable
				? preparation.catalog.selectedProfileId
				: "",
		);
	};
	const save = useMutation({
		mutationFn: (selection: { profileId: string; mode: PreparationMode }) =>
			selectTranscodeProfile(selection.profileId, undefined, selection.mode),
		onSuccess: (catalog) => {
			preparation.updateCatalog(catalog);
			console.info("[Settings] Preparation profile saved.");
			toast.add({
				id: "preparation-profile-save",
				type: "success",
				title: t("preparation.profileSaved"),
			});
		},
		onError: () => {
			console.warn("[Settings] Preparation profile save failed.");
			revert();
			toast.add({
				id: "preparation-profile-save",
				type: "error",
				title: t("preparation.profileSaveFailed"),
			});
		},
	});
	const choose = (nextMode: PreparationMode, nextProfileId: string) => {
		if (!nextProfileId) return;
		save.mutate({ profileId: nextProfileId, mode: nextMode });
	};
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
					<div className="space-y-4">
						<RadioCardGroup
							name="preparation-mode"
							value={mode}
							onValueChange={(value) => {
								const nextMode = value as PreparationMode;
								setMode(nextMode);
								choose(nextMode, profileId);
							}}
							legend={t("preparation.preparationMode")}
							className="grid gap-2 space-y-0 sm:grid-cols-2"
							disabled={save.isPending}
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
							onValueChange={(value) => {
								setProfileId(value);
								choose(mode, value);
							}}
							legend={t("preparation.chooseProfile")}
							className="grid gap-2 space-y-0 sm:grid-cols-2"
							disabled={save.isPending}
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
					</div>
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
