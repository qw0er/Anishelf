import { useMutation } from "@tanstack/react-query";
import { PlugZap, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../../shared/components/ui/action-button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../../shared/components/ui/dialog.js";
import { Field } from "../../shared/components/ui/field.js";
import { Input } from "../../shared/components/ui/input.js";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../shared/components/ui/native-select.js";
import { probeSourceProvider, testSource } from "./sources-api.js";

export function useSourceDiagnostics(
	generation: string,
	initialProvider: string,
) {
	const [providerId, setProviderId] = useState(initialProvider);
	const [title, setTitle] = useState("");
	const probe = useMutation({
		mutationFn: () => probeSourceProvider(generation, providerId),
	});
	const search = useMutation({
		mutationFn: () =>
			testSource({
				kind: "search",
				connectionRevision: generation,
				providerId,
				titles: [title.trim()],
			}),
	});
	function reset() {
		probe.reset();
		search.reset();
	}
	return {
		providerId,
		title,
		checking: probe.isPending,
		searching: search.isPending,
		failed: probe.isError || search.isError,
		support: probe.data,
		results: search.data,
		reset,
		reconcileProvider(providers: readonly string[]) {
			if (!providers.includes(providerId)) setProviderId(providers[0] ?? "");
			reset();
		},
		selectProvider(id: string) {
			setProviderId(id);
			reset();
		},
		changeTitle(value: string) {
			setTitle(value);
			search.reset();
		},
		checkSupport: () => probe.mutate(),
		searchTitle: () => search.mutate(),
	};
}

export function SourceDiagnosticsDialog({
	diagnostics,
	providers,
	open,
	onOpenChange,
	busy,
	changed,
	canTest,
}: {
	diagnostics: ReturnType<typeof useSourceDiagnostics>;
	providers: readonly string[];
	open: boolean;
	onOpenChange(open: boolean): void;
	busy: boolean;
	changed: boolean;
	canTest: boolean;
}) {
	const { t } = useTranslation();
	const { providerId, title, selectProvider, changeTitle } = diagnostics;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("acquisition.sources.diagnostics")}</DialogTitle>
				</DialogHeader>
				<div className="mt-4 flex min-w-0 flex-col gap-4">
					<Field className="flex flex-col gap-2">
						<label className="field-label" htmlFor="source-test-provider">
							{t("acquisition.sources.siteToTest")}
						</label>
						<NativeSelect
							id="source-test-provider"
							className="form-select"
							value={providerId}
							disabled={busy}
							onChange={(event) => {
								selectProvider(event.target.value);
							}}
						>
							{!providers.length && (
								<NativeSelectOption value="">
									{t("acquisition.sources.saveSiteFirst")}
								</NativeSelectOption>
							)}
							{providers.map((id) => (
								<NativeSelectOption key={id} value={id}>
									{id}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
					<div className="action-row">
						<ActionButton
							icon={PlugZap}
							label={t("acquisition.sources.checkSupport")}
							shortLabel={t("acquisition.sources.checkSupport")}
							variant="outline"
							disabled={!canTest || !providerId}
							onClick={() => diagnostics.checkSupport()}
							aria-busy={diagnostics.checking}
						/>
					</div>
					{diagnostics.support && !changed && (
						<p role="status" className="text-sm text-muted-foreground">
							{diagnostics.support.searchSupported
								? t("acquisition.sources.searchSupported")
								: t("acquisition.sources.searchUnsupported")}
						</p>
					)}
					<form
						className="flex min-w-0 flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							diagnostics.searchTitle();
						}}
					>
						<Field className="flex flex-col gap-2">
							<label className="field-label" htmlFor="source-test-title">
								{t("acquisition.sources.titleToSearch")}
							</label>
							<Input
								id="source-test-title"
								maxLength={256}
								value={title}
								disabled={busy}
								onChange={(event) => {
									changeTitle(event.target.value);
								}}
							/>
						</Field>
						<div className="action-row">
							<ActionButton
								icon={Search}
								label={t("acquisition.sources.testSearch")}
								shortLabel={t("acquisition.sources.testSearch")}
								type="submit"
								variant="outline"
								disabled={!canTest || !providerId || !title.trim()}
								aria-busy={diagnostics.searching}
							/>
						</div>
					</form>
					{diagnostics.results && !changed && (
						<div
							role="status"
							className="rounded-lg border bg-muted/20 p-3 text-sm"
						>
							<p>
								{diagnostics.results.entries.length
									? t("acquisition.sources.searchReturned", {
											count: diagnostics.results.entries.length,
										})
									: t("acquisition.sources.noResults")}
							</p>
							{diagnostics.results.coverage?.limited && (
								<p className="mt-1 text-muted-foreground">
									{t("acquisition.sources.limitedCoverage", {
										reason: diagnostics.results.coverage.reason,
									})}
								</p>
							)}
							{diagnostics.results.entries.length > 0 && (
								<ul className="mt-2 divide-y">
									{diagnostics.results.entries.slice(0, 5).map((entry) => (
										<li key={entry.id} className="break-all py-1">
											{entry.title}
										</li>
									))}
								</ul>
							)}
						</div>
					)}
				</div>
				{diagnostics.failed && (
					<p role="alert" className="field-error">
						{t("acquisition.sources.actionFailed")}
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
