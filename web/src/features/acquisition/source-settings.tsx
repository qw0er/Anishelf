import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Save, Trash2 } from "lucide-react";
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
import { Spinner } from "../../shared/components/ui/spinner.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";
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
		refetchInterval: (query) =>
			!query.state.data?.url || query.state.data.bundledSetup === "pending"
				? 5000
				: false,
		queryFn: ({ signal }) =>
			getSourceConnector({ signal: boundedSignal(signal) }),
	});
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("acquisition.sources.title")}</CardTitle>
				<CardDescription>
					{t("acquisition.sources.description")}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-4 lg:max-w-2xl">
				{query.isPending ? (
					<p role="status" className="text-sm text-muted-foreground">
						{t("acquisition.sources.loading")}
					</p>
				) : query.isError ? (
					<div role="alert" className="flex flex-col gap-2 text-sm">
						<p className="text-destructive">
							{t("acquisition.sources.loadFailed")}
						</p>
						<div className="action-row">
							<Button variant="outline" onClick={() => void query.refetch()}>
								{t("acquisition.sources.retry")}
							</Button>
						</div>
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
		mutationFn: (initializeSite: boolean) =>
			activateBundledSourceConnector(settings.generation, initializeSite),
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
	const selectableSites = available.filter(
		(site) => !providers.includes(site.id),
	);
	function move(index: number, direction: number) {
		const next = [...providers];
		const target = index + direction;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target] ?? "", next[index] ?? ""];
		setProviders(next);
	}
	const status =
		settings.origin === "bundled"
			? t("acquisition.sources.bundled")
			: settings.url
				? t("acquisition.sources.external")
				: t("acquisition.sources.unconfigured");
	return (
		<div className="flex min-w-0 flex-col gap-6">
			<div className="flex flex-col gap-2 text-sm">
				<p className="text-muted-foreground">
					<span className="font-medium text-foreground">{status}</span>{" "}
					{t("acquisition.sources.savingNotice")}
				</p>
				{settings.origin === "bundled" &&
					settings.bundledSetup === "manual" && (
						<p className="text-muted-foreground">
							{t("acquisition.sources.manualSetup")}
						</p>
					)}
				{settings.origin === "bundled" &&
					settings.bundledSetup === "pending" && (
						<p className="text-muted-foreground">
							{t("acquisition.sources.setupPending")}
						</p>
					)}
				{settings.error && (
					<p role="alert" className="text-destructive">
						{t("acquisition.sources.credentialsError")}
					</p>
				)}
			</div>

			<form
				className="flex min-w-0 flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					save.mutate();
				}}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium" htmlFor="source-api-url">
							{t("acquisition.sources.apiUrl")}
						</label>
						<Input
							id="source-api-url"
							type="url"
							required
							maxLength={2048}
							placeholder="http://jackett:9117/"
							value={url}
							disabled={busy}
							aria-describedby="source-api-url-help"
							onChange={(event) => setUrl(event.target.value)}
						/>
						<p
							id="source-api-url-help"
							className="text-sm text-muted-foreground"
						>
							{t("acquisition.sources.apiUrlHelp")}
						</p>
					</div>
					<div className="flex flex-col gap-2">
						<label className="text-sm font-medium" htmlFor="source-api-key">
							{t("acquisition.sources.apiKey")}
						</label>
						<Input
							id="source-api-key"
							type="password"
							autoComplete="new-password"
							maxLength={4096}
							required={!settings.hasApiKey || url !== settings.url}
							value={apiKey}
							disabled={busy}
							aria-describedby="source-api-key-help"
							onChange={(event) => setApiKey(event.target.value)}
						/>
						<p
							id="source-api-key-help"
							className="text-sm text-muted-foreground"
						>
							{settings.hasApiKey
								? t("acquisition.sources.keySaved")
								: t("acquisition.sources.keyHelp")}
						</p>
					</div>
					<div className="flex flex-col gap-2 sm:col-span-2">
						<label
							className="text-sm font-medium"
							htmlFor="source-management-url"
						>
							{t("acquisition.sources.managementUrl")}
						</label>
						<Input
							id="source-management-url"
							type="url"
							maxLength={2048}
							placeholder="http://localhost:9117/"
							value={managementUrl}
							disabled={busy}
							aria-describedby="source-management-url-help"
							onChange={(event) => setManagementUrl(event.target.value)}
						/>
						<p
							id="source-management-url-help"
							className="text-sm text-muted-foreground"
						>
							{t("acquisition.sources.managementHelp")}
						</p>
					</div>
				</div>
				<div className="action-row">
					<Button
						type="submit"
						disabled={busy || !changed}
						aria-busy={save.isPending}
					>
						{save.isPending ? (
							<Spinner />
						) : (
							<Save size={16} aria-hidden="true" />
						)}
						{save.isPending
							? t("acquisition.sources.saving")
							: t("acquisition.sources.save")}
					</Button>
					{settings.bundledAvailable && (
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => bundled.mutate(false)}
						>
							{t("acquisition.sources.useBundled")}
						</Button>
					)}
					{settings.origin === "bundled" &&
						settings.bundledSetup === "manual" && (
							<Button
								type="button"
								variant="outline"
								disabled={busy || changed}
								onClick={() => bundled.mutate(true)}
							>
								{t("acquisition.sources.retrySetup")}
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
				</div>
			</form>

			<section
				className="flex min-w-0 flex-col gap-3 border-t pt-4"
				aria-label={t("acquisition.sources.resourceSites")}
			>
				<div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 space-y-1">
						<h3 className="text-sm font-medium">
							{t("acquisition.sources.resourceSites")}
						</h3>
						<p className="text-sm text-muted-foreground">
							{t("acquisition.sources.chooseSites")}
						</p>
						{changed && (
							<p role="status" className="text-sm text-muted-foreground">
								{t("acquisition.sources.saveBeforeDiagnostics")}
							</p>
						)}
					</div>
					<Button
						variant="outline"
						disabled={!canTest}
						onClick={() => list.mutate()}
					>
						{list.isPending
							? t("acquisition.sources.connecting")
							: t("acquisition.sources.testAndLoad")}
					</Button>
				</div>
				{list.isSuccess && !changed && (
					<p role="status" className="text-sm text-muted-foreground">
						{t("acquisition.sources.loaded", {
							count: available.length,
						})}
					</p>
				)}
				{providers.length > 0 ? (
					<ul
						aria-label={t("acquisition.sources.selectedSites")}
						className="max-h-64 min-w-0 divide-y overflow-y-auto rounded-lg border"
					>
						{providers.map((id, index) => (
							<li
								key={id}
								className="flex min-w-0 items-center gap-2 px-3 py-2"
							>
								<span className="min-w-0 flex-1 break-all text-sm">
									<span className="mr-2 text-muted-foreground">
										{index + 1}.
									</span>
									{available.find((site) => site.id === id)?.name ?? id}
								</span>
								<Tooltip
									content={t("acquisition.sources.moveEarlier", {
										name: id,
									})}
								>
									<Button
										variant="ghost"
										className="size-8 shrink-0 p-0"
										disabled={busy || index === 0}
										aria-label={t("acquisition.sources.moveEarlier", {
											name: id,
										})}
										onClick={() => move(index, -1)}
									>
										<ArrowUp size={16} aria-hidden="true" />
									</Button>
								</Tooltip>
								<Tooltip
									content={t("acquisition.sources.moveLater", {
										name: id,
									})}
								>
									<Button
										variant="ghost"
										className="size-8 shrink-0 p-0"
										disabled={busy || index === providers.length - 1}
										aria-label={t("acquisition.sources.moveLater", {
											name: id,
										})}
										onClick={() => move(index, 1)}
									>
										<ArrowDown size={16} aria-hidden="true" />
									</Button>
								</Tooltip>
								<Tooltip
									content={t("acquisition.sources.removeAria", {
										name: id,
									})}
								>
									<Button
										variant="ghost"
										className="size-8 shrink-0 p-0"
										disabled={busy}
										aria-label={t("acquisition.sources.removeAria", {
											name: id,
										})}
										onClick={() =>
											setProviders(providers.filter((value) => value !== id))
										}
									>
										<Trash2 size={16} aria-hidden="true" />
									</Button>
								</Tooltip>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						{t("acquisition.sources.noSites")}
					</p>
				)}
				{selectableSites.length > 0 && (
					<fieldset className="flex min-w-0 flex-col gap-2">
						<legend className="text-sm font-medium">
							{t("acquisition.sources.availableSites")}
						</legend>
						<ul className="max-h-64 min-w-0 divide-y overflow-y-auto rounded-lg border">
							{selectableSites.map((site) => (
								<li key={site.id}>
									<label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
										<input
											type="checkbox"
											disabled={busy || providers.length >= 32}
											checked={false}
											onChange={() => setProviders([...providers, site.id])}
										/>
										{site.name}
									</label>
								</li>
							))}
						</ul>
					</fieldset>
				)}
			</section>

			<details className="min-w-0 border-t pt-4">
				<summary className="cursor-pointer text-sm font-medium">
					{t("acquisition.sources.diagnostics")}
				</summary>
				<div className="mt-4 flex min-w-0 flex-col gap-4">
					<div className="flex flex-col gap-2">
						<label
							className="text-sm font-medium"
							htmlFor="source-test-provider"
						>
							{t("acquisition.sources.siteToTest")}
						</label>
						<select
							id="source-test-provider"
							className="form-select"
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
					</div>
					<div className="action-row">
						<Button
							variant="outline"
							disabled={!canTest || !providerId}
							onClick={() => probe.mutate()}
						>
							{t("acquisition.sources.checkSupport")}
						</Button>
					</div>
					{probe.data && !changed && (
						<p role="status" className="text-sm text-muted-foreground">
							{probe.data.searchSupported
								? t("acquisition.sources.searchSupported")
								: t("acquisition.sources.searchUnsupported")}
						</p>
					)}
					<form
						className="flex min-w-0 flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							search.mutate();
						}}
					>
						<div className="flex flex-col gap-2">
							<label
								className="text-sm font-medium"
								htmlFor="source-test-title"
							>
								{t("acquisition.sources.titleToSearch")}
							</label>
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
						</div>
						<div className="action-row">
							<Button
								type="submit"
								variant="outline"
								disabled={!canTest || !providerId || !title.trim()}
							>
								{search.isPending
									? t("acquisition.sources.searching")
									: t("acquisition.sources.testSearch")}
							</Button>
						</div>
					</form>
					{search.data && !changed && (
						<div
							role="status"
							className="rounded-lg border bg-muted/20 p-3 text-sm"
						>
							<p>
								{search.data.entries.length
									? t("acquisition.sources.searchReturned", {
											count: search.data.entries.length,
										})
									: t("acquisition.sources.noResults")}
							</p>
							{search.data.coverage?.limited && (
								<p className="mt-1 text-muted-foreground">
									{t("acquisition.sources.limitedCoverage", {
										reason: search.data.coverage.reason,
									})}
								</p>
							)}
							{search.data.entries.length > 0 && (
								<ul className="mt-2 divide-y">
									{search.data.entries.slice(0, 5).map((entry) => (
										<li key={entry.id} className="break-all py-1">
											{entry.title}
										</li>
									))}
								</ul>
							)}
						</div>
					)}
				</div>
			</details>

			{error && (
				<p role="alert" className="text-sm text-destructive">
					{t("acquisition.sources.actionFailed")}
				</p>
			)}
		</div>
	);
}
