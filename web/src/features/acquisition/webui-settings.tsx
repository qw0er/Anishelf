import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, buttonStyles } from "../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
import { Input } from "../../shared/components/ui/input.js";
import {
	saveSettings,
	settingsKeys,
	settingsQuery,
} from "../settings/public.js";
import { QbittorrentApiSettings } from "./api-settings.js";
import { DownloadDestinationSettings } from "./destination-settings.js";

export function QbittorrentSettings() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const configuration = useQuery(settingsQuery());
	const [draft, setDraft] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (qbittorrentWebUiUrl: string) =>
			saveSettings({ qbittorrentWebUiUrl }),
		onSuccess: (settings) => {
			client.setQueryData(settingsKeys.settings, settings);
			setDraft(null);
		},
	});
	const settings = configuration.data;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("acquisition.webui.title")}</CardTitle>
				<CardDescription>{t("acquisition.webui.description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<QbittorrentApiSettings />
				<DownloadDestinationSettings />
				{configuration.isPending ? (
					<p role="status">{t("acquisition.webui.loading")}</p>
				) : configuration.isError ? (
					<div role="alert">
						{t("acquisition.webui.loadFailed")}{" "}
						<Button
							variant="outline"
							onClick={() => {
								void configuration.refetch();
							}}
						>
							{t("actions.retry")}
						</Button>
					</div>
				) : settings ? (
					<>
						<form
							className="space-y-3"
							onSubmit={(event) => {
								event.preventDefault();
								save.mutate(draft ?? settings.qbittorrentWebUiUrl ?? "");
							}}
						>
							<label
								htmlFor="qbittorrent-webui-url"
								className="block space-y-2"
							>
								<span className="text-sm font-medium">
									{t("acquisition.webui.url")}
								</span>
								<Input
									id="qbittorrent-webui-url"
									type="url"
									maxLength={2048}
									value={draft ?? settings.qbittorrentWebUiUrl ?? ""}
									onChange={(event) => {
										setDraft(event.target.value);
										save.reset();
									}}
									disabled={save.isPending}
									aria-describedby="qbittorrent-webui-help"
									placeholder="https://downloads.example.com/"
								/>
							</label>
							<p
								id="qbittorrent-webui-help"
								className="text-sm text-muted-foreground"
							>
								{t("acquisition.webui.urlHelp")}
							</p>
							{save.isError && (
								<p role="alert">{t("acquisition.webui.saveFailed")}</p>
							)}
							{save.isSuccess && (
								<p role="status">{t("acquisition.webui.saved")}</p>
							)}
							<Button type="submit" disabled={save.isPending}>
								{save.isPending
									? t("acquisition.webui.saving")
									: t("acquisition.webui.save")}
							</Button>
						</form>
						{settings.qbittorrentWebUiUrl ? (
							<>
								<a
									className={buttonStyles("outline")}
									href={settings.qbittorrentWebUiUrl}
									target="_blank"
									rel="noopener noreferrer"
								>
									{t("acquisition.webui.open")}
								</a>
								<p className="text-sm text-muted-foreground">
									{t("acquisition.webui.ownAccess")}
								</p>
							</>
						) : (
							<p role="status" className="text-sm text-muted-foreground">
								{t("acquisition.webui.savePrompt")}
							</p>
						)}
					</>
				) : null}
			</CardContent>
		</Card>
	);
}
