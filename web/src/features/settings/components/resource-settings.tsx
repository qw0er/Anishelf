import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import type { SettingsResponse } from "../../../shared/api/contracts.js";
import { Button } from "../../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { Input } from "../../../shared/components/ui/input.js";
import { Spinner } from "../../../shared/components/ui/spinner.js";
import { useDelayedPending } from "../../../shared/hooks/use-delayed-pending.js";
import { libraryPolicy, preparationPolicy } from "../policy.js";
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
		maximumMinutes?: number;
	}>();
	const saving = fetcher.state !== "idle";
	const showSaving = useDelayedPending(saving);
	return (
		<section className="stack-page" aria-label={t("settingsPage.label")}>
			<Card className="settings-section lg:grid">
				<CardHeader>
					<CardTitle>{t("settingsPage.resourceDirectory")}</CardTitle>
					<CardDescription>
						{t("settingsPage.resourceDescription")}
					</CardDescription>
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
						<div className="flex min-w-0 flex-col gap-2">
							<label className="text-sm font-medium" htmlFor="scan-interval">
								{t("settingsPage.scanInterval")}
							</label>
							<Input
								id="scan-interval"
								name="scanIntervalMinutes"
								type="number"
								min={0}
								max={libraryPolicy.maximumScanIntervalMinutes}
								step={1}
								required
								defaultValue={
									settings.scanIntervalMinutes ??
									libraryPolicy.defaultScanIntervalMinutes
								}
								disabled={disabled || saving}
								aria-describedby="scan-interval-help"
							/>
							<p
								id="scan-interval-help"
								className="text-sm text-muted-foreground"
							>
								{t("settingsPage.scanIntervalHelp", {
									defaultMinutes: libraryPolicy.defaultScanIntervalMinutes,
								})}
							</p>
						</div>
						<div className="flex min-w-0 flex-col gap-2">
							<label
								className="text-sm font-medium"
								htmlFor="transcode-cache-budget"
							>
								{t("settingsPage.transcodeCacheBudget")}
							</label>
							<Input
								id="transcode-cache-budget"
								name="transcodeCacheBudgetGiB"
								type="number"
								min={1}
								max={preparationPolicy.maximumCacheBudgetGiB}
								step={1}
								required
								defaultValue={
									settings.transcodeCacheBudgetGiB ??
									preparationPolicy.defaultCacheBudgetGiB
								}
								disabled={disabled || saving}
								aria-describedby="transcode-cache-budget-help"
							/>
							<p
								id="transcode-cache-budget-help"
								className="text-sm text-muted-foreground"
							>
								{t("settingsPage.transcodeCacheBudgetHelp", {
									defaultGiB: preparationPolicy.defaultCacheBudgetGiB,
								})}
							</p>
						</div>
						<div className="action-row">
							<Button
								type="submit"
								disabled={disabled || saving}
								aria-busy={saving}
							>
								{showSaving ? (
									<Spinner />
								) : (
									<Save size={16} aria-hidden="true" />
								)}
								{t("settingsPage.save")}
							</Button>
						</div>
					</fetcher.Form>
					{disabled && (
						<p className="text-sm">{t("settingsPage.waitForScan")}</p>
					)}
					{fetcher.state === "idle" && fetcher.data?.error && (
						<p className="text-base text-destructive" role="alert">
							{t(fetcher.data.error, {
								maximumMinutes: libraryPolicy.maximumScanIntervalMinutes,
							})}
						</p>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
