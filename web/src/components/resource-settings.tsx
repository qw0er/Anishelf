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
		<section className="space-y-6" aria-label={t("settingsPage.label")}>
			<div>
				<h1 className="text-2xl font-semibold">{t("settingsPage.title")}</h1>
				<p className="text-sm text-muted-foreground">
					{t("settingsPage.description")}
				</p>
			</div>
			<Card className="max-w-2xl">
				<CardHeader>
					<CardTitle>{t("settingsPage.resourceDirectory")}</CardTitle>
					<CardDescription>
						{t("settingsPage.resourceDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<fetcher.Form method="post" action="/settings" className="space-y-4">
						<div className="space-y-2">
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
						<p role="alert">{t(fetcher.data.error)}</p>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
