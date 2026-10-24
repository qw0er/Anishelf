import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowUp,
	ExternalLink,
	PlugZap,
	RefreshCw,
	Save,
	Search,
	Server,
	Trash2,
	Unplug,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	SourceConnectorSettings,
	SourceProviders,
} from "../../shared/api/contracts.js";
import { boundedSignal } from "../../shared/api/queries.js";
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
import { ConnectionSettings } from "../../shared/components/ui/connection-settings.js";
import { FieldHelp } from "../../shared/components/ui/field-help.js";
import { Input } from "../../shared/components/ui/input.js";
import { toast } from "../../shared/components/ui/toast.js";
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
		staleTime: 5 * 60_000,
		refetchOnWindowFocus: true,
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
		toast.add({ type: "success", title: t("acquisition.sources.saved") });
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
		onSuccess: (sites) => {
			setAvailable(sites);
			toast.add({
				type: "success",
				title: t("acquisition.sources.loaded", { count: sites.length }),
			});
		},
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
			? t("acquisition.connection.bundled")
			: settings.url
				? t("acquisition.connection.external")
				: t("acquisition.connection.unconfigured");
	return (
		<div className="flex min-w-0 flex-col gap-4">
			{(settings.error ||
				(settings.origin === "bundled" &&
					(settings.bundledSetup === "manual" ||
						settings.bundledSetup === "pending"))) && (
				<div className="flex flex-col gap-2 text-sm">
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
			)}

			<form
				className="flex min-w-0 flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					save.mutate();
				}}
			>
				<ConnectionSettings
					configured={
						Boolean(settings.url) && settings.hasApiKey && !settings.error
					}
					label={t("acquisition.sources.connectionSettings")}
					status={status}
				>
					<div className="flex flex-col gap-2 sm:col-span-2">
						<div className="flex items-center justify-between gap-2">
							<label className="text-sm font-medium" htmlFor="source-api-url">
								{t("acquisition.sources.apiUrl")}
							</label>
							<FieldHelp
								label={`${t("acquisition.sources.apiUrl")} · ${t("actions.help")}`}
								help={t("acquisition.sources.apiUrlHelp")}
							/>
						</div>
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
					</div>
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<label className="text-sm font-medium" htmlFor="source-api-key">
								{t("acquisition.sources.apiKey")}
							</label>
							<FieldHelp
								label={`${t("acquisition.sources.apiKey")} · ${t("actions.help")}`}
								help={t("acquisition.sources.keyHelp")}
							/>
						</div>
						<Input
							id="source-api-key"
							type="password"
							autoComplete="new-password"
							maxLength={4096}
							required={!settings.hasApiKey || url !== settings.url}
							placeholder={
								settings.hasApiKey && url === settings.url
									? t("acquisition.sources.keySaved")
									: undefined
							}
							value={apiKey}
							disabled={busy}
							onChange={(event) => setApiKey(event.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<label
								className="text-sm font-medium"
								htmlFor="source-management-url"
							>
								{t("acquisition.sources.managementUrl")}
							</label>
							<FieldHelp
								label={
									t("acquisition.sources.managementUrl") +
									" · " +
									t("actions.help")
								}
								help={t("acquisition.sources.managementHelp")}
							/>
						</div>
						<Input
							id="source-management-url"
							type="url"
							maxLength={2048}
							placeholder="http://localhost:9117/"
							value={managementUrl}
							disabled={busy}
							onChange={(event) => setManagementUrl(event.target.value)}
						/>
					</div>
				</ConnectionSettings>
				<div className="action-row">
					<ActionButton
						icon={Save}
						label={t("acquisition.sources.save")}
						shortLabel={t("actions.save")}
						type="submit"
						disabled={busy || !changed}
						aria-busy={save.isPending}
					/>
					{settings.bundledAvailable && (
						<ActionButton
							icon={Server}
							label={t("acquisition.sources.useBundled")}
							shortLabel={t("actions.useBundled")}
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => bundled.mutate(false)}
						/>
					)}
					{settings.origin === "bundled" &&
						settings.bundledSetup === "manual" && (
							<ActionButton
								icon={RefreshCw}
								label={t("acquisition.sources.retrySetup")}
								shortLabel={t("actions.retry")}
								type="button"
								variant="outline"
								disabled={busy || changed}
								onClick={() => bundled.mutate(true)}
							/>
						)}
					{settings.url && (
						<ActionButton
							icon={Unplug}
							label={t("acquisition.sources.disconnect")}
							shortLabel={t("actions.disconnect")}
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => clear.mutate()}
						/>
					)}
					{settings.managementUrl && (
						<ActionLink
							icon={ExternalLink}
							label={t("acquisition.sources.openManagement")}
							shortLabel={t("actions.open")}
							href={settings.managementUrl}
							target="_blank"
							rel="noopener noreferrer"
						/>
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

						{changed && (
							<p role="status" className="text-sm text-muted-foreground">
								{t("acquisition.sources.saveBeforeDiagnostics")}
							</p>
						)}
					</div>
					<ActionButton
						icon={RefreshCw}
						label={t("acquisition.sources.testAndLoad")}
						shortLabel={t("acquisition.sources.loadSites")}
						variant="outline"
						disabled={!canTest}
						onClick={() => list.mutate()}
					/>
				</div>
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
						<ActionButton
							icon={PlugZap}
							label={t("acquisition.sources.checkSupport")}
							shortLabel={t("acquisition.sources.checkSupport")}
							variant="outline"
							disabled={!canTest || !providerId}
							onClick={() => probe.mutate()}
						/>
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
							<ActionButton
								icon={Search}
								label={t("acquisition.sources.testSearch")}
								shortLabel={t("acquisition.sources.testSearch")}
								type="submit"
								variant="outline"
								disabled={!canTest || !providerId || !title.trim()}
							/>
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
