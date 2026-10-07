import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { selectTranscodeProfile } from "../../../api/client.js";
import type { TranscodeProfileCatalog } from "../../../api/contracts.js";
import { Button } from "../../../components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../components/ui/card.js";
import { toast } from "../../../components/ui/toast.js";
import { getErrorTranslationKey } from "../../../lib/error-translation.js";
import { usePreparationContext } from "../context.js";
import { usePreparationAction } from "../use-preparations.js";
export function PreparationProfileSettings() {
	const { t } = useTranslation();
	const preparation = usePreparationContext();
	const action = usePreparationAction();
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
		<Card className="w-full max-w-2xl">
			<CardHeader>
				<CardTitle>{t("preparation.profile")}</CardTitle>
				<CardDescription>
					{t("preparation.settingsDescription")}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
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
						<fieldset className="space-y-2" disabled={action.busy}>
							<legend className="mb-2 text-sm font-medium">
								{t("preparation.preparationMode")}
							</legend>
							{(["compatible", "fast"] as const).map((value) => (
								<label
									key={value}
									className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
								>
									<input
										type="radio"
										name="preparation-mode"
										checked={mode === value}
										onChange={() => setMode(value)}
										className="mt-1 accent-primary"
									/>
									<span>
										<span className="block text-sm font-medium">
											{t(`preparation.${value}Mode`)}
										</span>
										<span className="mt-1 block text-xs text-muted-foreground">
											{t(`preparation.${value}Description`)}
										</span>
									</span>
								</label>
							))}
						</fieldset>
						<fieldset className="space-y-2" disabled={action.busy}>
							<legend className="mb-2 text-sm font-medium">
								{t("preparation.chooseProfile")}
							</legend>
							{preparation.catalog.profiles.map((profile) => (
								<label
									key={profile.id}
									className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
								>
									<input
										type="radio"
										name="transcode-profile"
										value={profile.id}
										checked={profileId === profile.id}
										onChange={() => setProfileId(profile.id)}
										className="mt-1 accent-primary"
									/>
									<span className="min-w-0">
										<span className="block text-sm font-medium">
											{profile.name}
										</span>
										<span className="block text-xs text-muted-foreground">
											{t("preparation.profileFormat", {
												container: profile.container.toUpperCase(),
												videoEncoder: profile.videoEncoder,
												audioEncoder: profile.audioEncoder,
											})}
										</span>
										<span className="mt-1 block text-xs text-muted-foreground">
											{profile.description}
										</span>
									</span>
								</label>
							))}
						</fieldset>
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
