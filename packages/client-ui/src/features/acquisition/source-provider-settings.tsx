import {
	ArrowDown,
	ArrowUp,
	MoreHorizontal,
	PlugZap,
	RefreshCw,
	Save,
	Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
	SourceConnectorSettings,
	SourceProviders,
} from "../../shared/api/contracts.js";
import { ActionButton } from "../../shared/components/ui/action-button.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../shared/components/ui/dropdown-menu.js";
import { Field } from "../../shared/components/ui/field.js";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../shared/components/ui/native-select.js";
import { Tooltip } from "../../shared/components/ui/tooltip.js";

export function SourceProviderSettings({
	settings,
	providers,
	setProviders,
	available,
	busy,
	changed,
	sitesChanged,
	canTest,
	loadingSites,
	savingSites,
	onOpenDiagnostics,
	onLoadSites,
	onSaveSites,
}: {
	settings: Pick<SourceConnectorSettings, "providers" | "url" | "hasApiKey">;
	providers: string[];
	setProviders(providers: string[]): void;
	available: SourceProviders;
	busy: boolean;
	changed: boolean;
	sitesChanged: boolean;
	canTest: boolean;
	loadingSites: boolean;
	savingSites: boolean;
	onOpenDiagnostics(): void;
	onLoadSites(): void;
	onSaveSites(): void;
}) {
	const { t } = useTranslation();
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
	return (
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
				<div className="action-row">
					<ActionButton
						icon={PlugZap}
						label={t("acquisition.sources.test")}
						variant="outline"
						disabled={!canTest || !settings.providers.length}
						onClick={onOpenDiagnostics}
					/>
					<ActionButton
						icon={RefreshCw}
						label={t("acquisition.sources.testAndLoad")}
						shortLabel={t("acquisition.sources.loadSites")}
						variant="outline"
						disabled={!canTest}
						onClick={onLoadSites}
						aria-busy={loadingSites}
					/>
				</div>
			</div>
			{providers.length > 0 && (
				<ul
					aria-label={t("acquisition.sources.selectedSites")}
					className="max-h-64 min-w-0 divide-y overflow-y-auto rounded-lg border"
				>
					{providers.map((id, index) => (
						<li key={id} className="flex min-w-0 items-center gap-2 px-3 py-2">
							<span className="min-w-0 flex-1 truncate text-sm" title={id}>
								<span className="mr-2 text-muted-foreground">{index + 1}.</span>
								{available.find((site) => site.id === id)?.name ?? id}
							</span>
							<Tooltip
								content={t("acquisition.sources.moveEarlier", {
									name: id,
								})}
							>
								<Button
									size="icon"
									variant="ghost"
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
									size="icon"
									variant="ghost"
									disabled={busy || index === providers.length - 1}
									aria-label={t("acquisition.sources.moveLater", {
										name: id,
									})}
									onClick={() => move(index, 1)}
								>
									<ArrowDown size={16} aria-hidden="true" />
								</Button>
							</Tooltip>
							<DropdownMenu>
								<Tooltip
									content={t("acquisition.sources.siteActions", {
										name: id,
									})}
								>
									<DropdownMenuTrigger
										render={
											<Button
												size="icon"
												type="button"
												variant="ghost"
												aria-label={t("acquisition.sources.siteActions", {
													name: id,
												})}
											/>
										}
									>
										<MoreHorizontal size={16} aria-hidden="true" />
									</DropdownMenuTrigger>
								</Tooltip>
								<DropdownMenuContent>
									<DropdownMenuItem
										disabled={busy}
										onClick={() =>
											setProviders(providers.filter((value) => value !== id))
										}
									>
										<Trash2 size={16} aria-hidden="true" />
										{t("acquisition.sources.removeAria", { name: id })}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</li>
					))}
				</ul>
			)}
			{selectableSites.length > 0 && (
				<Field className="flex flex-col gap-2">
					<label htmlFor="source-add-site" className="field-label">
						{t("acquisition.sources.availableSites")}
					</label>
					<NativeSelect
						id="source-add-site"
						className="form-select"
						value=""
						disabled={busy || providers.length >= 32}
						onChange={(event) => {
							if (event.target.value)
								setProviders([...providers, event.target.value]);
						}}
					>
						<NativeSelectOption value="">
							{t("acquisition.sources.addSite")}
						</NativeSelectOption>
						{selectableSites.map((site) => (
							<NativeSelectOption key={site.id} value={site.id}>
								{site.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
			)}
			{sitesChanged && (
				<div className="action-row">
					<ActionButton
						icon={Save}
						label={t("acquisition.sources.saveSites")}
						disabled={busy || !settings.url || !settings.hasApiKey}
						aria-busy={savingSites}
						onClick={onSaveSites}
					/>
				</div>
			)}
		</section>
	);
}
