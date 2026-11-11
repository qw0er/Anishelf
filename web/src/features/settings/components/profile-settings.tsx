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
	CardDescription,
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

const codecLabels = new Map([
	["h264", "H.264"],
	["hevc", "H.265"],
	["opus", "Opus"],
]);

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
	function codecLabel(codec: string | null) {
		if (!codec) return t("preparation.profileCodecUnknown");
		if (codec === "copy") return t("preparation.profileCodecCopy");
		return codecLabels.get(codec.toLowerCase()) ?? codec.toUpperCase();
	}
	const [profileId, setProfileId] = useState("");
	useEffect(() => {
		setProfileId(
			preparation.catalog?.selectionAvailable
				? preparation.catalog.selectedProfileId
				: "",
		);
	}, [preparation.catalog]);
	const revert = () => {
		setProfileId(
			preparation.catalog?.selectionAvailable
				? preparation.catalog.selectedProfileId
				: "",
		);
	};
	const save = useMutation({
		mutationFn: (profileId: string) => selectTranscodeProfile(profileId),
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
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("preparation.profile")}</CardTitle>
				<CardDescription>{t("preparation.profileDescription")}</CardDescription>
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
							name="transcode-profile"
							value={profileId}
							onValueChange={(value) => {
								setProfileId(value);
								save.mutate(value);
							}}
							legend={t("preparation.chooseProfile")}
							className="grid gap-2 space-y-0 sm:grid-cols-2"
							disabled={save.isPending}
						>
							{preparation.catalog.profiles.map((profile) => {
								const unsupported = profile.validation.status === "unsupported";
								return (
									<div key={profile.id} className="space-y-2">
										<RadioCard
											value={profile.id}
											disabled={unsupported}
											badge={
												unsupported && t("preparation.validation.unsupported")
											}
											badgeTone="error"
											title={profile.name}
											meta={t("preparation.profileFormat", {
												container:
													profile.container === "matroska"
														? "MKV"
														: profile.container.toUpperCase(),
												videoCodec: codecLabel(profile.videoCodec),
												audioCodec: codecLabel(profile.audioCodec),
											})}
											description={profile.description}
										/>
										{unsupported && profile.validation.issues.length > 0 && (
											<details className="text-xs text-muted-foreground">
												<summary>
													{t("preparation.validationDetails")} · {profile.name}
												</summary>
												<ul className="mt-1 space-y-1">
													{profile.validation.issues.map((issue) => (
														<li key={`${issue.field}-${issue.message}`}>
															{issue.field}: {issue.message}
														</li>
													))}
												</ul>
											</details>
										)}
									</div>
								);
							})}
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
