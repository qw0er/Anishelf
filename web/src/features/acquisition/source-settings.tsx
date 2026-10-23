import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
	const { t } = useTranslation();
	const query = useQuery<SourceConnectorSettings>({
		queryKey: sourceSettingsKey,
		refetchInterval: (query) => (query.state.data?.url ? false : 5000),
		queryFn: ({ signal }) =>
			getSourceConnector({ signal: boundedSignal(signal) }),
	});
	return (
		<Card className="settings-panel">
			<CardHeader>
				<CardTitle>{t("acquisition.sources.title")}</CardTitle>
				<CardDescription>
					{t("acquisition.sources.description")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isPending ? (
					<p role="status">{t("acquisition.sources.loading")}</p>
				) : query.isError ? (
					<div role="alert">
						{t("acquisition.sources.loadFailed")}{" "}
						<Button variant="outline" onClick={() => void query.refetch()}>
							{t("acquisition.sources.retry")}
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
	const { t } = useTranslation();
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
					? t("acquisition.sources.bundled")
					: settings.url
						? t("acquisition.sources.external")
						: t("acquisition.sources.unconfigured")}{" "}
				{t("acquisition.sources.savingNotice")}
			</p>
			{settings.origin === "bundled" && settings.bundledSetup === "manual" && (
				<p className="text-sm text-muted-foreground">
					{t("acquisition.sources.manualSetup")}
				</p>
			)}
			{settings.origin === "bundled" && settings.bundledSetup === "pending" && (
				<p className="text-sm text-muted-foreground">
					{t("acquisition.sources.setupPending")}
				</p>
			)}
			{settings.error && (
				<p role="alert">{t("acquisition.sources.credentialsError")}</p>
			)}
			<form
				className="space-y-3"
				onSubmit={(event) => {
					event.preventDefault();
					save.mutate();
				}}
			>
				<label className="block space-y-2" htmlFor="source-api-url">
					<span>{t("acquisition.sources.apiUrl")}</span>
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
					{t("acquisition.sources.apiUrlHelp")}
				</p>
				<label className="block space-y-2" htmlFor="source-api-key">
					<span>{t("acquisition.sources.apiKey")}</span>
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
						? t("acquisition.sources.keySaved")
						: t("acquisition.sources.keyHelp")}
				</p>
				<label className="block space-y-2" htmlFor="source-management-url">
					<span>{t("acquisition.sources.managementUrl")}</span>
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
					{t("acquisition.sources.managementHelp")}
				</p>
				<div className="action-row">
					<Button type="submit" disabled={busy || !changed}>
						{save.isPending
							? t("acquisition.sources.saving")
							: t("acquisition.sources.save")}
					</Button>
					{settings.bundledAvailable && (
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => bundled.mutate()}
						>
							{t("acquisition.sources.useBundled")}
						</Button>
					)}
					{settings.url && (
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => clear.mutate()}
						>
							{t("acquisition.sources.disconnect")}
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
					{t("acquisition.sources.openManagement")}
				</a>
			)}
			<section
				className="space-y-3"
				aria-label={t("acquisition.sources.resourceSites")}
			>
				<h3 className="text-sm font-medium">
					{t("acquisition.sources.resourceSites")}
				</h3>
				<Button
					variant="outline"
					disabled={!canTest}
					onClick={() => list.mutate()}
				>
					{list.isPending
						? t("acquisition.sources.connecting")
						: t("acquisition.sources.testAndLoad")}
				</Button>
				{list.isSuccess && !changed && (
					<p role="status">
						{t("acquisition.sources.loaded", {
							count: available.length,
						})}
					</p>
				)}
				<p className="text-sm text-muted-foreground">
					{t("acquisition.sources.chooseSites")}
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
				{providers.length === 0 && <p>{t("acquisition.sources.noSites")}</p>}
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
								aria-label={t("acquisition.sources.moveEarlier", { name: id })}
								onClick={() => move(index, -1)}
							>
								↑
							</Button>
							<Button
								variant="outline"
								disabled={busy || index === providers.length - 1}
								aria-label={t("acquisition.sources.moveLater", { name: id })}
								onClick={() => move(index, 1)}
							>
								↓
							</Button>
							<Button
								variant="outline"
								disabled={busy}
								aria-label={t("acquisition.sources.removeAria", { name: id })}
								onClick={() =>
									setProviders(providers.filter((value) => value !== id))
								}
							>
								{t("acquisition.sources.remove")}
							</Button>
						</li>
					))}
				</ol>
			</section>
			<details className="space-y-3">
				<summary className="cursor-pointer text-sm font-medium">
					{t("acquisition.sources.diagnostics")}
				</summary>
				<div className="space-y-3 pt-3">
					<label className="block space-y-2" htmlFor="source-test-provider">
						<span>{t("acquisition.sources.siteToTest")}</span>
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
								<option value="">
									{t("acquisition.sources.saveSiteFirst")}
								</option>
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
						{t("acquisition.sources.checkSupport")}
					</Button>
					{probe.data && !changed && (
						<p role="status">
							{probe.data.searchSupported
								? t("acquisition.sources.searchSupported")
								: t("acquisition.sources.searchUnsupported")}
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
							<span>{t("acquisition.sources.titleToSearch")}</span>
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
							{search.isPending
								? t("acquisition.sources.searching")
								: t("acquisition.sources.testSearch")}
						</Button>
					</form>
					{search.data && !changed && (
						<div role="status">
							<p>
								{search.data.entries.length
									? t("acquisition.sources.searchReturned", {
											count: search.data.entries.length,
										})
									: t("acquisition.sources.noResults")}
							</p>
							{search.data.coverage?.limited && (
								<p>
									{t("acquisition.sources.limitedCoverage", {
										reason: search.data.coverage.reason,
									})}
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
				<p role="status">{t("acquisition.sources.saveBeforeDiagnostics")}</p>
			)}
			{error && <p role="alert">{t("acquisition.sources.actionFailed")}</p>}
		</div>
	);
}
