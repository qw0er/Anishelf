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

import { acquisitionProfilesQuery } from "./subscriptions-api.js";

export function RssSettings() {
	const client = useQueryClient();
	const configuration = useQuery(settingsQuery());
	const profiles = useQuery(acquisitionProfilesQuery());
	const [profileDraft, setProfileDraft] = useState<string | null>(null);
	const profileSave = useMutation({
		mutationFn: (defaultAcquisitionProfileId: string) =>
			saveSettings({ defaultAcquisitionProfileId }),
		onSuccess: (settings) => {
			client.setQueryData(settingsKeys.settings, settings);
			void client.invalidateQueries({ queryKey: ["acquisition"] });
			setProfileDraft(null);
			toast.add({ type: "success", title: "Release profile saved." });
		},
		onError: () =>
			toast.add({ type: "error", title: "Could not save release profile." }),
	});
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
					Choose a release selection profile and refresh interval.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 lg:max-w-2xl">
				{profiles.data && (
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							profileSave.mutate(
								profileDraft ?? profiles.data.selectedProfileId,
							);
						}}
					>
						<label htmlFor="acquisition-profile" className="block space-y-2">
							<span className="text-sm font-medium">
								Default release selection profile
							</span>
							<select
								id="acquisition-profile"
								className="w-full rounded-md border bg-background p-2 text-sm"
								value={profileDraft ?? profiles.data.selectedProfileId}
								disabled={profileSave.isPending}
								onChange={(event) => setProfileDraft(event.target.value)}
							>
								{!profiles.data.selectionAvailable && (
									<option value={profiles.data.selectedProfileId}>
										Unavailable: {profiles.data.selectedProfileId}
									</option>
								)}
								{profiles.data.profiles.map((profile) => (
									<option key={profile.id} value={profile.id}>
										{profile.name}
										{profile.source === "custom" ? " (Custom)" : ""}
									</option>
								))}
							</select>
						</label>
						<p className="text-sm text-muted-foreground">
							{profiles.data.profiles.find(
								(profile) =>
									profile.id ===
									(profileDraft ?? profiles.data.selectedProfileId),
							)?.description ??
								"Select an available profile to resume new selections."}
						</p>
						<Button
							type="submit"
							disabled={
								profileSave.isPending ||
								!profiles.data.profiles.some(
									(profile) =>
										profile.id ===
										(profileDraft ?? profiles.data.selectedProfileId),
								)
							}
						>
							Save release profile
						</Button>
					</form>
				)}
				{profiles.isError && (
					<p role="alert">
						Could not load release profiles.{" "}
						<Button variant="outline" onClick={() => void profiles.refetch()}>
							Retry profiles
						</Button>
					</p>
				)}
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
