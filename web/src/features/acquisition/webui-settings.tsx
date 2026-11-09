import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionLink } from "../../shared/components/ui/action-button.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "../../shared/components/ui/collapsible.js";
import { FieldError } from "../../shared/components/ui/field.js";
import { FieldHelp } from "../../shared/components/ui/field-help.js";
import { Input } from "../../shared/components/ui/input.js";
import { StatusBadge } from "../../shared/components/ui/status-badge.js";
import { toast } from "../../shared/components/ui/toast.js";
import { useAutoSave } from "../../shared/hooks/use-auto-save.js";
import { useRefreshError } from "../../shared/hooks/use-refresh-error.js";
import { isHttpUrl } from "../../shared/lib/url.js";
import {
	saveSettings,
	settingsKeys,
	settingsQuery,
} from "../settings/public.js";
import {
	QbittorrentApiSettings,
	useQbittorrentConnection,
} from "./api-settings.js";
import { DownloadDestinationSettings } from "./destination-settings.js";

export function QbittorrentSettings() {
	const { t } = useTranslation();
	const client = useQueryClient();
	const configuration = useQuery(settingsQuery());
	const connection = useQbittorrentConnection();
	useRefreshError(
		"settings-configuration",
		configuration.data ? configuration.error : null,
		configuration.errorUpdatedAt,
		() => void configuration.refetch(),
	);
	const [draft, setDraft] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (qbittorrentWebUiUrl: string) =>
			saveSettings({ qbittorrentWebUiUrl }),
		onSuccess: (settings, value) => {
			client.setQueryData(settingsKeys.settings, settings);
			setDraft((current) =>
				current !== null && current.trim() === value ? null : current,
			);
			console.info("[Settings] qBittorrent WebUI URL saved.");
			toast.add({
				type: "success",
				title: t("acquisition.webui.saved"),
				id: "qbittorrent-webui-save",
			});
		},
		onError: (_error, value) => {
			console.warn("[Settings] qBittorrent WebUI URL save failed.");
			toast.add({
				type: "error",
				title: t("acquisition.webui.saveFailed"),
				actionProps: {
					children: t("actions.retry"),
					onClick: () => save.mutate(value),
				},
				id: "qbittorrent-webui-save",
			});
		},
	});
	const settings = configuration.data;
	const savedUrl = (settings?.qbittorrentWebUiUrl ?? "").trim();
	const url = (draft ?? settings?.qbittorrentWebUiUrl ?? "").trim();
	const validUrl = url === "" || isHttpUrl(url);
	const flush = useAutoSave(
		url,
		savedUrl,
		(value) => save.mutate(value),
		draft !== null && validUrl,
	);
	const connectionStatus = connection.data
		? t(
				connection.data.state === "configured"
					? connection.data.bundled
						? "acquisition.connection.bundled"
						: "acquisition.connection.external"
					: "acquisition.connection.unconfigured",
			)
		: null;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("acquisition.webui.title")}</CardTitle>
				{connectionStatus && (
					<div role="status">
						<StatusBadge>{connectionStatus}</StatusBadge>
					</div>
				)}
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-5 lg:max-w-2xl">
				<QbittorrentApiSettings />
				<DownloadDestinationSettings />
				{configuration.isPending ? (
					<p role="status">{t("acquisition.webui.loading")}</p>
				) : configuration.isError && !configuration.data ? (
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
					<div className="border-t pt-4">
						<Collapsible>
							<CollapsibleTrigger className="cursor-pointer text-sm font-medium">
								{t("acquisition.webui.settings")}
							</CollapsibleTrigger>
							<CollapsibleContent keepMounted>
								<div className="flex flex-col gap-3 pt-4">
									<div className="flex min-w-0 flex-col gap-2">
										<div className="flex items-center justify-between gap-2">
											<label
												className="field-label"
												htmlFor="qbittorrent-webui-url"
											>
												{t("acquisition.webui.url")}
											</label>
											<FieldHelp
												label={`${t("acquisition.webui.url")} · ${t("actions.help")}`}
												help={t("acquisition.webui.urlHelp")}
											/>
										</div>
										<Input
											id="qbittorrent-webui-url"
											type="url"
											maxLength={2048}
											value={draft ?? settings.qbittorrentWebUiUrl ?? ""}
											aria-invalid={!validUrl || undefined}
											aria-describedby={
												!validUrl ? "qbittorrent-webui-url-error" : undefined
											}
											onChange={(event) => setDraft(event.target.value)}
											onBlur={flush}
											placeholder="https://downloads.example.com/"
										/>
										<FieldError
											id="qbittorrent-webui-url-error"
											className="field-error"
										>
											{!validUrl && t("acquisition.sources.invalidUrl")}
										</FieldError>
									</div>
								</div>
							</CollapsibleContent>
						</Collapsible>
						{settings.qbittorrentWebUiUrl ? (
							<div className="flex flex-wrap items-center gap-2">
								<ActionLink
									icon={ExternalLink}
									label={t("acquisition.webui.open")}
									shortLabel={t("actions.open")}
									href={settings.qbittorrentWebUiUrl}
									target="_blank"
									rel="noopener noreferrer"
								/>
							</div>
						) : null}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
