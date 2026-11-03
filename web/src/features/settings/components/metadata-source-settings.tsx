import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
		mutationFn: (provider: "anilist" | "bangumi") =>
			saveSettings({ defaultMetadataProvider: provider }),
		onSuccess: async (data) => {
			client.setQueryData(settingsKeys.settings, data);
			await client.invalidateQueries({ queryKey: ["metadata-search"] });
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
								save.mutate(value);
						}}
					>
						<option value="anilist">AniList</option>
						<option value="bangumi">Bangumi</option>
					</NativeSelect>
				</label>
			</CardContent>
		</Card>
	);
}
