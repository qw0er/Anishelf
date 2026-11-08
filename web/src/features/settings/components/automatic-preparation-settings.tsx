import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateSettingsRequest } from "../../../shared/api/contracts.js";
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
import { Switch } from "../../../shared/components/ui/switch.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { saveSettings } from "../api.js";
import {
	automaticPresetsQuery,
	settingsKeys,
	settingsQuery,
} from "../queries.js";

export function AutomaticPreparationSettings() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const settings = useQuery(settingsQuery());
	const catalog = useQuery(automaticPresetsQuery());
	const [enabled, setEnabled] = useState(false);
	const [presetId, setPresetId] = useState("builtin:web");
	useEffect(() => {
		if (settings.data) {
			setEnabled(settings.data.autoPreparationEnabled ?? false);
			setPresetId(settings.data.autoPreparationPresetId ?? "builtin:web");
		}
	}, [settings.data]);
	const save = useMutation({
		mutationFn: (patch: UpdateSettingsRequest) => saveSettings(patch),
		onSuccess: (data) => {
			queryClient.setQueryData(settingsKeys.settings, data);
			void queryClient.invalidateQueries({
				queryKey: settingsKeys.automaticPresets,
			});
			console.info("[Settings] Automatic preparation settings saved.");
			toast.add({
				id: "automatic-preparation-save",
				type: "success",
				title: t("automaticPreparation.saved"),
			});
		},
		onError: (_error, patch) => {
			console.warn("[Settings] Automatic preparation settings save failed.");
			if ("autoPreparationEnabled" in patch)
				setEnabled(settings.data?.autoPreparationEnabled ?? false);
			if ("autoPreparationPresetId" in patch)
				setPresetId(settings.data?.autoPreparationPresetId ?? "builtin:web");
			toast.add({
				id: "automatic-preparation-save",
				type: "error",
				title: t("automaticPreparation.saveFailed"),
			});
		},
	});
	const unavailable =
		!!catalog.data &&
		!catalog.data.presets.some((p) => p.id === presetId && p.available);
	const busy = save.isPending;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("automaticPreparation.title")}</CardTitle>
				<CardDescription>
					{t("automaticPreparation.description")}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{(settings.isError || catalog.isError) && (
					<p role="alert">{t("errors.requestFailed")}</p>
				)}
				{catalog.data?.issue && (
					<p role="alert" className="field-error">
						{t("automaticPreparation.configIssue", {
							file: catalog.data.issue.file,
						})}
					</p>
				)}
				<div className="flex items-center justify-between gap-4">
					<label htmlFor="automatic-preparation-enabled">
						{t("automaticPreparation.enabled")}
					</label>
					<Switch
						id="automatic-preparation-enabled"
						checked={enabled}
						onCheckedChange={(next) => {
							if (next && unavailable) {
								toast.add({
									id: "automatic-preparation-save",
									type: "error",
									title: t("automaticPreparation.paused"),
								});
								return;
							}
							setEnabled(next);
							save.mutate({ autoPreparationEnabled: next });
						}}
						disabled={busy || !settings.data || !catalog.data}
					/>
				</div>

				<RadioCardGroup
					name="automatic-preparation-preset"
					value={presetId}
					onValueChange={(value) => {
						if (value === presetId) return;
						setPresetId(value);
						save.mutate({ autoPreparationPresetId: value });
					}}
					legend={t("automaticPreparation.preset")}
					className="grid gap-2 space-y-0 sm:grid-cols-2"
					disabled={busy || !catalog.data}
				>
					{unavailable &&
						!catalog.data?.presets.some((p) => p.id === presetId) && (
							<RadioCard
								value={presetId}
								title={t("automaticPreparation.unavailable")}
								disabled
							/>
						)}
					{catalog.data?.presets.map((p) => (
						<RadioCard
							key={p.id}
							value={p.id}
							disabled={!p.available}
							title={p.name}
							description={p.description}
						/>
					))}
				</RadioCardGroup>
				{unavailable && (
					<p role="alert" className="field-error">
						{t("automaticPreparation.paused")}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
