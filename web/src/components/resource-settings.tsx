import { useFetcher } from "react-router";
import type { SettingsResponse } from "../api/contracts.js";
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
	const fetcher = useFetcher<typeof settingsAction>();
	const saving = fetcher.state !== "idle";
	return (
		<section className="space-y-6" aria-label="Resource settings">
			<div>
				<h1 className="text-2xl font-semibold">Settings</h1>
				<p className="text-sm text-muted-foreground">
					Configure the server directory used by the library.
				</p>
			</div>
			<Card className="max-w-2xl">
				<CardHeader>
					<CardTitle>Resource directory</CardTitle>
					<CardDescription>
						Enter an absolute path on the server. Scan the library after saving.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<fetcher.Form method="post" action="/settings" className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium" htmlFor="resource-root">
								Resource directory path
							</label>
							<Input
								id="resource-root"
								name="resourceRoot"
								type="text"
								required
								defaultValue={settings.resourceRoot ?? ""}
								placeholder="/path/to/media"
								disabled={disabled || saving}
							/>
						</div>
						<Button type="submit" disabled={disabled || saving}>
							{saving ? (
								<>
									<Spinner />
									Saving…
								</>
							) : (
								"Save directory"
							)}
						</Button>
					</fetcher.Form>
					{settings.resourceRoot !== null && (
						<p className="break-all text-sm text-muted-foreground">
							Saved resource directory: {settings.resourceRoot}
						</p>
					)}
					{disabled && (
						<p className="text-sm">
							Wait for the scan to finish before changing the directory.
						</p>
					)}
					{fetcher.state === "idle" && fetcher.data?.error && (
						<p role="alert">{fetcher.data.error}</p>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
