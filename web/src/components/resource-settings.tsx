import { useFetcher } from "react-router";
import type { SettingsResponse } from "../api/contracts.js";
import type { settingsAction } from "../routes/loaders.js";

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
		<section className="space-y-2" aria-label="Resource settings">
			<h2 className="font-semibold">Resource directory</h2>
			<p>
				Enter the absolute path to a media directory on the server. Scan the
				library after saving.
			</p>
			<fetcher.Form
				method="post"
				action="/settings"
				className="flex flex-wrap items-center gap-2"
			>
				<label htmlFor="resource-root">Resource directory path</label>
				<input
					id="resource-root"
					name="resourceRoot"
					type="text"
					required
					defaultValue={settings.resourceRoot ?? ""}
					placeholder="/path/to/media"
					className="min-w-64 border px-2 py-1"
					disabled={disabled || saving}
				/>
				<button
					type="submit"
					className="border px-3 py-1 disabled:opacity-50"
					disabled={disabled || saving}
				>
					{saving ? "Saving…" : "Save directory"}
				</button>
			</fetcher.Form>
			{settings.resourceRoot !== null && (
				<p>Saved resource directory: {settings.resourceRoot}</p>
			)}
			{disabled && (
				<p>Wait for the scan to finish before changing the directory.</p>
			)}
			{fetcher.state === "idle" && fetcher.data?.error && (
				<p role="alert">{fetcher.data.error}</p>
			)}
		</section>
	);
}
