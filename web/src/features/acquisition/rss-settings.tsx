import { rssConstraints } from "@anishelf/backend/contracts/defaults";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useState } from "react";
import { Button } from "../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
import { Input } from "../../shared/components/ui/input.js";
import { toast } from "../../shared/components/ui/toast.js";
import {
	saveSettings,
	settingsKeys,
	settingsQuery,
} from "../settings/public.js";

export function RssSettings() {
	const client = useQueryClient();
	const configuration = useQuery(settingsQuery());
	const [draft, setDraft] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: (rssRefreshIntervalMinutes: number) =>
			saveSettings({ rssRefreshIntervalMinutes }),
		onSuccess: (settings) => {
			client.setQueryData(settingsKeys.settings, settings);
			setDraft(null);
			toast.add({
				type: "success",
				title: "RSS settings saved.",
				id: "rss-settings-save",
			});
		},
		onError: () => {
			toast.add({
				type: "error",
				title: "Could not save RSS settings. Try again.",
				id: "rss-settings-save",
			});
		},
	});
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>RSS</CardTitle>
				<CardDescription>
					Set how often enabled subscriptions check for releases.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 lg:max-w-2xl">
				{configuration.isPending ? (
					<p role="status">Loading RSS settings…</p>
				) : configuration.isError ? (
					<div role="alert">
						Could not load RSS settings.{" "}
						<Button
							variant="outline"
							onClick={() => {
								void configuration.refetch();
							}}
						>
							Retry
						</Button>
					</div>
				) : configuration.data ? (
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							save.mutate(
								Number(
									draft ??
										configuration.data.rssRefreshIntervalMinutes ??
										rssConstraints.defaultRefreshIntervalMinutes,
								),
							);
						}}
					>
						<label htmlFor="rss-refresh-interval" className="block space-y-2">
							<span className="text-sm font-medium">
								Refresh interval (minutes)
							</span>
							<Input
								id="rss-refresh-interval"
								type="number"
								required
								min={rssConstraints.minimumRefreshIntervalMinutes}
								max={rssConstraints.maximumRefreshIntervalMinutes}
								step={1}
								value={
									draft ??
									configuration.data.rssRefreshIntervalMinutes ??
									rssConstraints.defaultRefreshIntervalMinutes
								}
								onChange={(event) => setDraft(event.target.value)}
								disabled={save.isPending}
								aria-describedby="rss-refresh-help"
							/>
						</label>
						<p id="rss-refresh-help" className="text-sm text-muted-foreground">
							Applies to all RSS subscriptions. Default:{" "}
							{rssConstraints.defaultRefreshIntervalMinutes} minutes. Changes
							apply without a restart.
						</p>
						<Button
							type="submit"
							disabled={save.isPending}
							aria-busy={save.isPending}
						>
							<Save size={16} aria-hidden="true" />
							{save.isPending ? "Saving…" : "Save"}
						</Button>
					</form>
				) : null}
			</CardContent>
		</Card>
	);
}
