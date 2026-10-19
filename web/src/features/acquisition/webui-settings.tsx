import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../../shared/api/client.js";
import type { QbittorrentWebUi } from "../../shared/api/contracts.js";
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

const key = ["integrations", "qbittorrent"];
const endpoint = "/api/integrations/qbittorrent";

export function QbittorrentSettings() {
	const client = useQueryClient();
	const configuration = useQuery(settingsQuery());
	const query = useQuery({
		queryKey: key,
		queryFn: ({ signal }) =>
			request<QbittorrentWebUi>(endpoint, "GET", { signal }),
	});
	const [draft, setDraft] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (qbittorrentWebUiUrl: string) =>
			saveSettings({ qbittorrentWebUiUrl }),
		onSuccess: async (settings) => {
			client.setQueryData(settingsKeys.settings, settings);
			await client.invalidateQueries({ queryKey: key });
			setDraft(null);
		},
	});
	const settings = configuration.data;
	const link = query.data;
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>qBittorrent</CardTitle>
				<CardDescription>Open the full download client WebUI.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{query.isPending || configuration.isPending ? (
					<p role="status">Loading qBittorrent settings…</p>
				) : query.isError || configuration.isError ? (
					<div role="alert">
						Could not load qBittorrent settings.{" "}
						<Button
							variant="outline"
							onClick={() => {
								void query.refetch();
								void configuration.refetch();
							}}
						>
							Retry
						</Button>
					</div>
				) : settings && link ? (
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
								Leave blank to open through Anishelf's built-in proxy.
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
						{settings.qbittorrentWebUiUrl || link.proxyConfigured ? (
							<>
								<a
									className={buttonStyles("outline")}
									href={link.url}
									target="_blank"
									rel="noopener noreferrer"
								>
									Open qBittorrent WebUI
								</a>
								{settings.qbittorrentWebUiUrl && (
									<p className="text-sm text-muted-foreground">
										This external address uses its own access controls.
									</p>
								)}
							</>
						) : (
							<p role="status" className="text-sm text-muted-foreground">
								Set ANISHELF_QBITTORRENT_URL on the server and restart Anishelf,
								or save a custom WebUI URL.
							</p>
						)}
					</>
				) : null}
			</CardContent>
		</Card>
	);
}
