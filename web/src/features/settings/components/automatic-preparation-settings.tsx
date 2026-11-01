import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../../../shared/components/ui/action-button.js";
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

export function AutomaticPreparationSettings({
	action,
}: {
	action: {
		busy: boolean;
		run(action: (signal: AbortSignal) => Promise<void>): Promise<void>;
	};
}) {
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
	const unavailable =
		!!catalog.data &&
		!catalog.data.presets.some((p) => p.id === presetId && p.available);
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
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void action.run(async (signal) => {
							const saved = await saveSettings(
								{
									autoPreparationEnabled: enabled,
									autoPreparationPresetId: presetId,
								},
								{ signal },
							);
							if (signal.aborted) return;
							queryClient.setQueryData(settingsKeys.settings, saved);
							await queryClient.invalidateQueries({
								queryKey: settingsKeys.automaticPresets,
							});
							toast.add({
								type: "success",
								title: t("automaticPreparation.saved"),
							});
						});
					}}
				>
					<div className="flex items-center justify-between gap-4">
						<label htmlFor="automatic-preparation-enabled">
							{t("automaticPreparation.enabled")}
						</label>
						<Switch
							id="automatic-preparation-enabled"
							checked={enabled}
							onCheckedChange={setEnabled}
							disabled={action.busy || !settings.data || !catalog.data}
						/>
					</div>

					<RadioCardGroup
						name="automatic-preparation-preset"
						value={presetId}
						onValueChange={setPresetId}
						legend={t("automaticPreparation.preset")}
						className="grid gap-2 space-y-0 sm:grid-cols-2"
						disabled={action.busy || !catalog.data}
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
					<ActionButton
						type="submit"
						icon={Save}
						label={t("actions.save")}
						disabled={
							action.busy ||
							!settings.data ||
							!catalog.data ||
							(enabled && unavailable)
						}
						aria-busy={action.busy}
					/>
				</form>
			</CardContent>
		</Card>
	);
}
