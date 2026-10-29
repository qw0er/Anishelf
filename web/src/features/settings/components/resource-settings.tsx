import { preparationConstraints } from "@anishelf/backend/contracts/defaults";
import { Save } from "lucide-react";
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
import { ResourcePathList } from "./resource-path-list.js";

export default function ResourceSettings({
	settings,

	disabled,
}: {
	settings: SettingsResponse;
	disabled: boolean;
}) {
	const { t } = useTranslation();
	const fetcher = useFetcher<{
		error: string | null;
	}>();
	const saving = fetcher.state !== "idle";

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
						<div className="flex min-w-0 max-w-sm flex-col gap-2">
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
								name="transcodeCacheBudgetGiB"
								type="number"
								min={1}
								max={preparationConstraints.maximumCacheBudgetGiB}
								step={1}
								required
								defaultValue={
									settings.transcodeCacheBudgetGiB ??
									preparationConstraints.defaultCacheBudgetGiB
								}
								disabled={disabled || saving}
							/>
						</div>
						<div className="action-row">
							<ActionButton
								icon={Save}
								label={t("settingsPage.save")}
								shortLabel={t("actions.save")}
								type="submit"
								disabled={disabled || saving}
								aria-busy={saving}
							/>
						</div>
					</fetcher.Form>
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
