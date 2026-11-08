import { preparationConstraints } from "@anishelf/backend/contracts/defaults";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import type { SettingsResponse } from "../../../shared/api/contracts.js";
import { ActionButton } from "../../../shared/components/ui/action-button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { FieldHelp } from "../../../shared/components/ui/field-help.js";
import { Input } from "../../../shared/components/ui/input.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { useAutoSave } from "../../../shared/hooks/use-auto-save.js";
import { saveSettings } from "../api.js";
import { settingsKeys } from "../queries.js";
import { ResourcePathList } from "./resource-path-list.js";

export default function ResourceSettings({
	settings,

	disabled,
}: {
	settings: SettingsResponse;
	disabled: boolean;
}) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const fetcher = useFetcher<{
		error: string | null;
	}>();
	const saving = fetcher.state !== "idle";
	const savedBudget =
		settings.transcodeCacheBudgetGiB ??
		preparationConstraints.defaultCacheBudgetGiB;
	const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
	const budgetText = budgetDraft ?? String(savedBudget);
	const budget = Number(budgetText);
	const budgetValid =
		budgetText.trim() !== "" &&
		Number.isSafeInteger(budget) &&
		budget >= 1 &&
		budget <= preparationConstraints.maximumCacheBudgetGiB;
	const cacheSave = useMutation({
		mutationFn: (transcodeCacheBudgetGiB: number) =>
			saveSettings({ transcodeCacheBudgetGiB }),
		onSuccess: (data, value) => {
			client.setQueryData(settingsKeys.settings, data);
			setBudgetDraft((current) =>
				current !== null && Number(current) === value ? null : current,
			);
			console.info("[Settings] Transcode cache budget saved.", {
				budgetGiB: value,
			});
			toast.add({
				id: "settings-cache-budget-save",
				type: "success",
				title: t("settingsPage.cacheSaved"),
			});
		},
		onError: () => {
			console.warn("[Settings] Transcode cache budget save failed.");
			toast.add({
				id: "settings-cache-budget-save",
				type: "error",
				title: t("settingsPage.cacheSaveFailed"),
			});
		},
	});
	const flushBudget = useAutoSave(
		budget,
		savedBudget,
		(value) => cacheSave.mutate(value),
		!disabled && !saving && budgetDraft !== null && budgetValid,
	);

	return (
		<section className="stack-page" aria-label={t("settingsPage.label")}>
			<Card className="settings-section lg:grid">
				<CardHeader>
					<CardTitle>{t("settingsPage.resourceDirectory")}</CardTitle>
				</CardHeader>
				<CardContent className="flex min-w-0 flex-col gap-4 lg:max-w-2xl">
					<fetcher.Form
						method="post"
						action="/settings"
						className="flex min-w-0 flex-col gap-4"
					>
						<ResourcePathList
							paths={settings.resourceRoots}
							disabled={disabled || saving}
						/>
						<div className="action-row">
							<ActionButton
								icon={Save}
								label={t("settingsPage.save")}
								shortLabel={t("actions.save")}
								type="submit"
								disabled={disabled || saving || cacheSave.isPending}
								aria-busy={saving}
							/>
						</div>
					</fetcher.Form>
					<div className="flex min-w-0 max-w-sm flex-col gap-2 border-t pt-4">
						<div className="flex items-center justify-between gap-2">
							<label className="field-label" htmlFor="transcode-cache-budget">
								{t("settingsPage.transcodeCacheBudget")}
							</label>
							<FieldHelp
								label={t("settingsPage.cacheHelpLabel")}
								help={t("settingsPage.transcodeCacheBudgetHelp", {
									defaultGiB: preparationConstraints.defaultCacheBudgetGiB,
								})}
							/>
						</div>
						<Input
							id="transcode-cache-budget"
							type="number"
							min={1}
							max={preparationConstraints.maximumCacheBudgetGiB}
							step={1}
							value={budgetText}
							disabled={disabled || saving}
							aria-invalid={!budgetValid || undefined}
							aria-describedby={
								!budgetValid ? "transcode-cache-budget-error" : undefined
							}
							onChange={(event) => setBudgetDraft(event.target.value)}
							onBlur={() => {
								if (!budgetValid) {
									toast.add({
										id: "settings-cache-budget-save",
										type: "error",
										title: t("settingsPage.invalidCacheBudget"),
									});
									return;
								}
								flushBudget();
							}}
						/>
						{!budgetValid && (
							<p
								id="transcode-cache-budget-error"
								role="alert"
								className="field-error"
							>
								{t("settingsPage.invalidCacheBudget")}
							</p>
						)}
					</div>
					{disabled && (
						<p className="text-sm">{t("settingsPage.waitForScan")}</p>
					)}
					{fetcher.state === "idle" && fetcher.data?.error && (
						<p className="field-error" role="alert">
							{t(fetcher.data.error)}
						</p>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
