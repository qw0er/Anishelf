import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { UpdateSettingsRequest } from "../../../shared/api/contracts.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { NativeSelect } from "../../../shared/components/ui/native-select.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { saveSettings } from "../api.js";
import { settingsKeys, settingsQuery } from "../queries.js";
export function MetadataSourceSettings() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const settings = useQuery(settingsQuery());
	const save = useMutation({
		mutationFn: (patch: UpdateSettingsRequest) => saveSettings(patch),
		onSuccess: async (data) => {
			client.setQueryData(settingsKeys.settings, data);
			await client.invalidateQueries({
				predicate: (query) =>
					[
						"anime-library",
						"anime-detail",
						"catalog",
						"metadata-search",
						"metadata-detail",
						"metadata-relations",
					].includes(String(query.queryKey[0])),
			});
			toast.add({ type: "success", title: t("metadataSource.saved") });
		},
		onError: () =>
			toast.add({ type: "error", title: t("errors.requestFailed") }),
	});
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("metadataSource.title")}</CardTitle>
				<CardDescription>{t("metadataSource.description")}</CardDescription>
			</CardHeader>
			<CardContent>
				{settings.isError && (
					<p role="alert">{t("errors.settingsUnavailable")}</p>
				)}
				<label htmlFor="metadata-default-provider" className="block space-y-2">
					{t("metadataSource.source")}
					<NativeSelect
						id="metadata-default-provider"
						value={settings.data?.defaultMetadataProvider ?? "anilist"}
						disabled={!settings.data || save.isPending}
						onChange={(event) => {
							const value = event.target.value;
							if (value === "anilist" || value === "bangumi")
								save.mutate({ defaultMetadataProvider: value });
						}}
					>
						<option value="anilist">AniList</option>
						<option value="bangumi">Bangumi</option>
					</NativeSelect>
				</label>
				<div className="mt-4 space-y-2">
					<label htmlFor="title-display-preference">
						{t("metadataSource.titlePreference")}
					</label>
					<NativeSelect
						aria-describedby="title-display-fallback"
						id="title-display-preference"
						value={settings.data?.titleDisplayPreference ?? "native"}
						disabled={!settings.data || save.isPending}
						onChange={(event) => {
							const value = event.target.value;
							if (
								value === "chinese" ||
								value === "native" ||
								value === "english" ||
								value === "romaji"
							)
								save.mutate({ titleDisplayPreference: value });
						}}
					>
						{(["chinese", "native", "english", "romaji"] as const).map(
							(value) => (
								<option key={value} value={value}>
									{t(`metadataSource.titlePreferences.${value}`)}
								</option>
							),
						)}
					</NativeSelect>
					<p
						id="title-display-fallback"
						className="text-muted-foreground text-sm"
					>
						{t("metadataSource.titleFallback")}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
