import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

export function QbittorrentSettings() {
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
				<CardTitle>qBittorrent</CardTitle>
				<CardDescription>
					Configure API access and open the download client WebUI.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<QbittorrentApiSettings />
				{configuration.isPending ? (
					<p role="status">Loading qBittorrent settings…</p>
				) : configuration.isError ? (
					<div role="alert">
						Could not load qBittorrent settings.{" "}
						<Button
							variant="outline"
							onClick={() => {
								void configuration.refetch();
							}}
						>
							Retry
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
								<span className="text-sm font-medium">WebUI URL</span>
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
								Enter the qBittorrent WebUI address to open directly.
							</p>
							{save.isError && (
								<p role="alert">
									Could not save. Use an absolute HTTP/HTTPS URL without a
									username or password, then retry.
								</p>
							)}
							{save.isSuccess && <p role="status">WebUI URL saved.</p>}
							<Button type="submit" disabled={save.isPending}>
								{save.isPending ? "Saving…" : "Save"}
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
									Open qBittorrent WebUI
								</a>
								<p className="text-sm text-muted-foreground">
									This address uses its own access controls.
								</p>
							</>
						) : (
							<p role="status" className="text-sm text-muted-foreground">
								Save a WebUI URL to open qBittorrent.
							</p>
						)}
					</>
				) : null}
			</CardContent>
		</Card>
	);
}
