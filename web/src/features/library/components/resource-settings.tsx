import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import type {
	ClientConfigResponse,
	SettingsResponse,
} from "../../../api/contracts.js";
import { Button } from "../../../components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../components/ui/card.js";
import { Input } from "../../../components/ui/input.js";
import { Spinner } from "../../../components/ui/spinner.js";
import { useDelayedPending } from "../../../hooks/use-delayed-pending.js";
import type { settingsAction } from "../../../routes/loaders.js";

export default function ResourceSettings({
	settings,
	clientConfig,
	disabled,
}: {
	settings: SettingsResponse;
	clientConfig: ClientConfigResponse;
	disabled: boolean;
}) {
	const { t } = useTranslation();
	const fetcher = useFetcher<typeof settingsAction>();
	const saving = fetcher.state !== "idle";
	const showSaving = useDelayedPending(saving);
	return (
		<section className="stack-page" aria-label={t("settingsPage.label")}>
			<div className="flex min-w-0 flex-col gap-2">
				<h1 className="page-title">{t("settingsPage.title")}</h1>
				<p className="text-sm text-muted-foreground">
					{t("settingsPage.description")}
				</p>
			</div>

			<Card className="w-full max-w-2xl">
				<CardHeader>
					<CardTitle>{t("settingsPage.resourceDirectory")}</CardTitle>
					<CardDescription>
						{t("settingsPage.resourceDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex min-w-0 flex-col gap-4">
					<fetcher.Form
						method="post"
						action="/settings"
						className="flex min-w-0 flex-col gap-4"
					>
						<div className="flex min-w-0 flex-col gap-2">
							<label className="text-sm font-medium" htmlFor="resource-root">
								{t("settingsPage.pathLabel")}
							</label>
							<Input
								id="resource-root"
								name="resourceRoot"
								type="text"
								required
								defaultValue={settings.resourceRoot ?? ""}
								placeholder={t("settingsPage.pathPlaceholder")}
								disabled={disabled || saving}
							/>
						</div>
						<div className="flex min-w-0 flex-col gap-2">
							<label className="text-sm font-medium" htmlFor="scan-interval">
								{t("settingsPage.scanInterval")}
							</label>
							<Input
								id="scan-interval"
								name="scanIntervalMinutes"
								type="number"
								min={0}
								max={clientConfig.library.maximumScanIntervalMinutes}
								step={1}
								required
								defaultValue={
									settings.scanIntervalMinutes ??
									clientConfig.library.defaultScanIntervalMinutes
								}
								disabled={disabled || saving}
								aria-describedby="scan-interval-help"
							/>
							<p
								id="scan-interval-help"
								className="text-sm text-muted-foreground"
							>
								{t("settingsPage.scanIntervalHelp", {
									defaultMinutes:
										clientConfig.library.defaultScanIntervalMinutes,
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
					{settings.resourceRoot !== null && (
						<p className="break-all text-sm text-muted-foreground">
							{t("settingsPage.savedPath", {
								path: settings.resourceRoot,
							})}
						</p>
					)}
					{disabled && (
						<p className="text-sm">{t("settingsPage.waitForScan")}</p>
					)}
					{fetcher.state === "idle" && fetcher.data?.error && (
						<p className="text-base text-destructive" role="alert">
							{t(fetcher.data.error, {
								maximumMinutes: clientConfig.library.maximumScanIntervalMinutes,
							})}
						</p>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
