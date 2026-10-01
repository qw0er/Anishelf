import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import type { SettingsResponse } from "../api/contracts.js";
import { useDelayedPending } from "../hooks/use-delayed-pending.js";
import type { settingsAction } from "../routes/loaders.js";
import { Button } from "./ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./ui/card.js";
import { Input } from "./ui/input.js";
import { Spinner } from "./ui/spinner.js";

export default function ResourceSettings({
	settings,
	disabled,
}: {
	settings: SettingsResponse;
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
								max={10080}
								step={1}
								required
								defaultValue={settings.scanIntervalMinutes ?? 60}
								disabled={disabled || saving}
								aria-describedby="scan-interval-help"
							/>
							<p
								id="scan-interval-help"
								className="text-sm text-muted-foreground"
							>
								{t("settingsPage.scanIntervalHelp")}
							</p>
						</div>
						<div className="action-row">
							<Button
								type="submit"
								disabled={disabled || saving}
								aria-busy={saving}
							>
								<span className="inline-flex size-4 shrink-0">
									{showSaving && <Spinner />}
								</span>
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
							{t(fetcher.data.error)}
						</p>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
