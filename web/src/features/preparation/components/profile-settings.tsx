import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { selectTranscodeProfile } from "../../../api/client.js";
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
	const [profileId, setProfileId] = useState("");
	useEffect(() => {
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
								const catalog = await selectTranscodeProfile(profileId, {
									signal,
								});
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
						<label
							htmlFor="transcode-profile"
							className="block text-sm font-medium"
						>
							{t("preparation.chooseProfile")}
						</label>
						<select
							id="transcode-profile"
							className="w-full min-w-0 rounded-md border bg-background p-2"
							value={profileId}
							disabled={action.busy}
							onChange={(event) => setProfileId(event.target.value)}
						>
							<option value="" disabled>
								{t("preparation.chooseProfile")}
							</option>
							{preparation.catalog.profiles.map((profile) => (
								<option key={profile.id} value={profile.id}>
									{profile.name}
								</option>
							))}
						</select>
						<p className="text-sm text-muted-foreground">
							{
								preparation.catalog.profiles.find(
									(profile) => profile.id === profileId,
								)?.description
							}
						</p>
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
