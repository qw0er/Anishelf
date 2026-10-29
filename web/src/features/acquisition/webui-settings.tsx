import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Save } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ActionButton,
	ActionLink,
} from "../../shared/components/ui/action-button.js";
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
import { FieldHelp } from "../../shared/components/ui/field-help.js";
import { Input } from "../../shared/components/ui/input.js";
import { toast } from "../../shared/components/ui/toast.js";
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
			toast.add({ type: "success", title: t("acquisition.webui.saved") });
		},
	});
	const settings = configuration.data;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("acquisition.webui.title")}</CardTitle>
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-5 lg:max-w-2xl">
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
					<div className="border-t pt-4">
						<Collapsible>
							<CollapsibleTrigger className="cursor-pointer text-sm font-medium">
								{t("acquisition.webui.settings")}
							</CollapsibleTrigger>
							<CollapsibleContent keepMounted>
								<form
									className="flex flex-col gap-3 pt-4"
									onSubmit={(event) => {
										event.preventDefault();
										save.mutate(draft ?? settings.qbittorrentWebUiUrl ?? "");
									}}
								>
									<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
										<div className="flex min-w-0 flex-1 flex-col gap-2">
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
												onChange={(event) => {
													setDraft(event.target.value);
													save.reset();
												}}
												disabled={save.isPending}
												placeholder="https://downloads.example.com/"
											/>
										</div>
										<ActionButton
											icon={Save}
											label={t("acquisition.webui.save")}
											shortLabel={t("actions.save")}
											type="submit"
											disabled={save.isPending}
										/>
									</div>

									{save.isError && (
										<p role="alert" className="field-error">
											{t("acquisition.webui.saveFailed")}
										</p>
									)}
								</form>
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
