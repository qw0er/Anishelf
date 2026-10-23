import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
	SourceConnectorSettings,
	SourceProviders,
} from "../../shared/api/contracts.js";
import { boundedSignal } from "../../shared/api/queries.js";
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
	activateBundledSourceConnector,
	clearSourceConnector,
	getSourceConnector,
	getSourceProviders,
	probeSourceProvider,
	saveSourceConnector,
	sourceSettingsKey,
	testSource,
} from "./sources-api.js";

export function SourceSettings() {
	const query = useQuery<SourceConnectorSettings>({
		queryKey: sourceSettingsKey,
		refetchInterval: (query) => (query.state.data?.url ? false : 5000),
		queryFn: ({ signal }) =>
			getSourceConnector({ signal: boundedSignal(signal) }),
	});
	return (
		<Card className="settings-panel">
			<CardHeader>
				<CardTitle>Jackett sources</CardTitle>
				<CardDescription>
					Connect resource sites through your own Jackett service or the
					optional bundled service.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isPending ? (
					<p role="status">Loading source settings…</p>
				) : query.isError ? (
					<div role="alert">
						Could not load source settings.{" "}
						<Button variant="outline" onClick={() => void query.refetch()}>
							Retry source settings
						</Button>
					</div>
				) : (
					<ConnectorForm key={query.data.generation} settings={query.data} />
				)}
			</CardContent>
		</Card>
	);
}
function ConnectorForm({ settings }: { settings: SourceConnectorSettings }) {
	const client = useQueryClient();
	const [url, setUrl] = useState(settings.url ?? "");
	const [managementUrl, setManagementUrl] = useState(
		settings.managementUrl ?? "",
	);
	const [apiKey, setApiKey] = useState("");
	const [providers, setProviders] = useState(settings.providers);
	const [available, setAvailable] = useState<SourceProviders>([]);
	const [providerId, setProviderId] = useState(settings.providers[0] ?? "");
	const [title, setTitle] = useState("");
	const changed =
		url !== (settings.url ?? "") ||
		managementUrl !== (settings.managementUrl ?? "") ||
		Boolean(apiKey) ||
		JSON.stringify(providers) !== JSON.stringify(settings.providers);
	const saved = (value: SourceConnectorSettings) => {
		setApiKey("");
		client.setQueryData(sourceSettingsKey, value);
	};
	const save = useMutation({
		mutationFn: () =>
			saveSourceConnector({
				generation: settings.generation,
				url,
				managementUrl: managementUrl.trim() || null,
				origin:
					settings.origin === "bundled" && url === settings.url
						? "bundled"
						: "external",
				providers,
				...(apiKey ? { apiKey } : {}),
			}),
		onSuccess: saved,
	});
	const clear = useMutation({
		mutationFn: () => clearSourceConnector(settings.generation),
		onSuccess: saved,
	});
	const bundled = useMutation({
		mutationFn: () => activateBundledSourceConnector(settings.generation),
		onSuccess: saved,
	});
	const list = useMutation({
		mutationFn: () => getSourceProviders(settings.generation),
		onSuccess: setAvailable,
	});
	const probe = useMutation({
		mutationFn: () => probeSourceProvider(settings.generation, providerId),
	});
	const search = useMutation({
		mutationFn: () =>
			testSource({
				kind: "search",
				connectionRevision: settings.generation,
				providerId,
				titles: [title.trim()],
			}),
	});
	const busy =
		save.isPending ||
		clear.isPending ||
		bundled.isPending ||
		list.isPending ||
		probe.isPending ||
		search.isPending;
	const error =
		save.isError ||
		clear.isError ||
		bundled.isError ||
		list.isError ||
		probe.isError ||
		search.isError;
	const canTest =
		!busy && !changed && settings.hasApiKey && Boolean(settings.url);
	function move(index: number, direction: number) {
		const next = [...providers];
		const target = index + direction;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target] ?? "", next[index] ?? ""];
		setProviders(next);
	}
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				{settings.origin === "bundled"
					? "Using bundled Jackett."
					: settings.url
						? "Using external Jackett. Sites are managed in Jackett."
						: "No source connector configured."}{" "}
				Saving a connection or running a test does not enable subscriptions or
				downloads.
			</p>
			{settings.origin === "bundled" && settings.bundledSetup === "manual" && (
				<p className="text-sm text-muted-foreground">
					Review site configuration in Jackett, then test the connection and
					select sites below.
				</p>
			)}
			{settings.origin === "bundled" && settings.bundledSetup === "pending" && (
				<p className="text-sm text-muted-foreground">
					First-run site setup is pending. Refresh settings after Jackett is
					ready.
				</p>
			)}
			{settings.error && (
				<p role="alert">
					Saved source credentials could not be loaded. Check the configuration
					file and permissions.
				</p>
			)}
			<form
				className="space-y-3"
				onSubmit={(event) => {
					event.preventDefault();
					save.mutate();
				}}
			>
				<label className="block space-y-2" htmlFor="source-api-url">
					<span>Jackett API URL</span>
					<Input
						id="source-api-url"
						type="url"
						required
						maxLength={2048}
						placeholder="http://jackett:9117/"
						value={url}
						disabled={busy}
						onChange={(event) => setUrl(event.target.value)}
					/>
				</label>
				<p className="text-sm text-muted-foreground">
					Use the service address reachable from the backend. Configure your
					sites in Jackett first.
				</p>
				<label className="block space-y-2" htmlFor="source-api-key">
					<span>Jackett API key</span>
					<Input
						id="source-api-key"
						type="password"
						autoComplete="new-password"
						maxLength={4096}
						required={!settings.hasApiKey || url !== settings.url}
						value={apiKey}
						disabled={busy}
						onChange={(event) => setApiKey(event.target.value)}
					/>
				</label>
				<p className="text-sm text-muted-foreground">
					{settings.hasApiKey
						? "Key saved. Leave blank to keep it; enter a key when changing the service address."
						: "Copy the API key from Jackett. Saved keys are never displayed."}
				</p>
				<label className="block space-y-2" htmlFor="source-management-url">
					<span>Jackett management URL (optional)</span>
					<Input
						id="source-management-url"
						type="url"
						maxLength={2048}
						placeholder="http://localhost:9117/"
						value={managementUrl}
						disabled={busy}
						onChange={(event) => setManagementUrl(event.target.value)}
					/>
				</label>
				<p className="text-sm text-muted-foreground">
					Browser address for managing sites. Use an SSH tunnel or your
					protected service address for a remote server.
				</p>
				<div className="action-row">
					<Button type="submit" disabled={busy || !changed}>
						{save.isPending ? "Saving sources…" : "Save source settings"}
					</Button>
					{settings.bundledAvailable && (
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => bundled.mutate()}
						>
							Use bundled Jackett
						</Button>
					)}
					{settings.url && (
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => clear.mutate()}
						>
							Disconnect Jackett
						</Button>
					)}
				</div>
			</form>
			{settings.managementUrl && (
				<a
					className={buttonStyles("outline")}
					href={settings.managementUrl}
					target="_blank"
					rel="noopener noreferrer"
				>
					Open Jackett management
				</a>
			)}
			<section className="space-y-3" aria-label="Resource sites">
				<h3 className="text-sm font-medium">Resource sites</h3>
				<Button
					variant="outline"
					disabled={!canTest}
					onClick={() => list.mutate()}
				>
					{list.isPending ? "Connecting…" : "Test connection and load sites"}
				</Button>
				{list.isSuccess && !changed && (
					<p role="status">
						Jackett responded with {available.length} configured sites. This
						checks the service connection; test a search below to check a site.
					</p>
				)}
				<p className="text-sm text-muted-foreground">
					Choose sites and use the arrows to set their order. Save changes
					before testing searches.
				</p>
				{available
					.filter((site) => !providers.includes(site.id))
					.map((site) => (
						<label key={site.id} className="flex items-center gap-2">
							<input
								type="checkbox"
								disabled={busy || providers.length >= 32}
								checked={false}
								onChange={() => setProviders([...providers, site.id])}
							/>
							{site.name}
						</label>
					))}
				{providers.length === 0 && <p>No sites selected.</p>}
				<ol className="space-y-2">
					{providers.map((id, index) => (
						<li key={id} className="flex flex-wrap items-center gap-2">
							<span>
								{index + 1}.{" "}
								{available.find((site) => site.id === id)?.name ?? id}
							</span>
							<Button
								variant="outline"
								disabled={busy || index === 0}
								aria-label={`Move ${id} earlier`}
								onClick={() => move(index, -1)}
							>
								↑
							</Button>
							<Button
								variant="outline"
								disabled={busy || index === providers.length - 1}
								aria-label={`Move ${id} later`}
								onClick={() => move(index, 1)}
							>
								↓
							</Button>
							<Button
								variant="outline"
								disabled={busy}
								aria-label={`Remove ${id}`}
								onClick={() =>
									setProviders(providers.filter((value) => value !== id))
								}
							>
								Remove
							</Button>
						</li>
					))}
				</ol>
			</section>
			<details className="space-y-3">
				<summary className="cursor-pointer text-sm font-medium">
					Search diagnostics
				</summary>
				<div className="space-y-3 pt-3">
					<label className="block space-y-2" htmlFor="source-test-provider">
						<span>Site to test</span>
						<select
							id="source-test-provider"
							className="w-full rounded-md border bg-background p-2"
							value={providerId}
							disabled={busy}
							onChange={(event) => {
								setProviderId(event.target.value);
								probe.reset();
								search.reset();
							}}
						>
							{!settings.providers.length && (
								<option value="">Save a selected site first</option>
							)}
							{settings.providers.map((id) => (
								<option key={id} value={id}>
									{id}
								</option>
							))}
						</select>
					</label>
					<Button
						variant="outline"
						disabled={!canTest || !providerId}
						onClick={() => probe.mutate()}
					>
						Check search support
					</Button>
					{probe.data && !changed && (
						<p role="status">
							{probe.data.searchSupported
								? "The site reports search support. Run a search to verify upstream access."
								: "The site does not report search support."}
						</p>
					)}
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							search.mutate();
						}}
					>
						<label className="block space-y-2" htmlFor="source-test-title">
							<span>Title to search</span>
							<Input
								id="source-test-title"
								maxLength={256}
								value={title}
								disabled={busy}
								onChange={(event) => {
									setTitle(event.target.value);
									search.reset();
								}}
							/>
						</label>
						<Button
							type="submit"
							disabled={!canTest || !providerId || !title.trim()}
						>
							{search.isPending ? "Searching…" : "Test search"}
						</Button>
					</form>
					{search.data && !changed && (
						<div role="status">
							<p>
								{search.data.entries.length
									? `Search returned ${search.data.entries.length} releases.`
									: "Search completed with no matching releases."}
							</p>
							{search.data.coverage?.limited && (
								<p>
									Results have limited coverage ({search.data.coverage.reason}).
								</p>
							)}
							<ul>
								{search.data.entries.slice(0, 5).map((entry) => (
									<li key={entry.id}>{entry.title}</li>
								))}
							</ul>
						</div>
					)}
				</div>
			</details>
			{changed && (
				<p role="status">Save source settings before running diagnostics.</p>
			)}
			{error && (
				<p role="alert">
					Could not complete the source action. Check the service address, API
					key and site configuration. Reload settings if another session changed
					them.
				</p>
			)}
		</div>
	);
}
