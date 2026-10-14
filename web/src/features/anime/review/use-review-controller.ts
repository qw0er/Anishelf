import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	CatalogPreviewResponse,
	CatalogReviewItem,
} from "../../../shared/api/contracts.js";
import {
	metadataDetailQuery,
	metadataSearchQuery,
} from "../metadata/public.js";
import { confirmMapping, decideReview, previewMapping } from "./api.js";
import { parseMapping, parseProviderReference } from "./mapping.js";
export function useReviewController(item: CatalogReviewItem) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const [reference, setReference] = useState<{
		provider: string;
		mediaType: "anime";
		id: string;
	} | null>(() =>
		item.available
			? (item.associations[0]?.reference ??
				item.recognizedWork?.reference ??
				null)
			: null,
	);
	const [search, setSearch] = useState("");
	const [searchPage, setSearchPage] = useState(1);
	const [preview, setPreview] = useState<CatalogPreviewResponse | null>(null);
	const [operationKey, setOperationKey] = useState("");
	const [replace, setReplace] = useState(false);
	const [decisionValidation, setDecisionValidation] = useState<string | null>(
		null,
	);
	const [validation, setValidation] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const searchQuery = useQuery({
		...metadataSearchQuery(search, searchPage),
		enabled: search.length > 0,
	});
	const details = useQuery({
		...metadataDetailQuery(reference?.provider ?? "", reference?.id ?? ""),
		enabled: Boolean(reference),
	});
	const replacement = Boolean(preview?.rows.some((row) => row.before.length));
	const invalidate = async () => {
		await client.invalidateQueries({ queryKey: ["catalog"] });
	};
	const previewAction = useMutation({
		mutationFn: previewMapping,
		onSuccess: (value) => {
			setPreview(value);
			setOperationKey(crypto.randomUUID());
			setReplace(false);
			setSuccess(null);
		},
	});
	const confirmAction = useMutation({
		mutationFn: () => {
			if (!preview) throw new Error("No preview");
			return confirmMapping({
				previewId: preview.id,
				operationKey,
				replace: replacement && replace,
			});
		},
		onSuccess: async (value) => {
			setPreview(null);
			setSuccess(value.workId);
			await invalidate();
		},
	});
	const decisionAction = useMutation({
		mutationFn: ({ reason, remove }: { reason: string; remove: boolean }) =>
			decideReview(item.id, item.revision, reason, remove),
		onSuccess: async () => {
			setPreview(null);
			setSuccess(null);
			setDecisionValidation(null);
			await invalidate();
		},
	});
	const busy =
		previewAction.isPending ||
		confirmAction.isPending ||
		decisionAction.isPending;
	function clearPreview() {
		setPreview(null);
		setValidation(null);
	}

	function selectWork(value: NonNullable<typeof reference>) {
		setReference(value);
		clearPreview();
	}
	function searchWorks(value: string) {
		setSearch(value);
		setSearchPage(1);
	}
	function lookupWork(value: string) {
		const ref = parseProviderReference(value);
		if (!ref) {
			setValidation(t("review.invalidId"));
			return;
		}
		selectWork(ref);
	}
	function requestPreview(form: FormData) {
		setValidation(null);
		if (!reference) return;
		const request = parseMapping(form, item, reference);
		if (!request) {
			setValidation(t("review.invalidMapping"));
			return;
		}
		previewAction.mutate(request);
	}
	function requestDecision(form: FormData) {
		if (item.associations.length && !form.has("remove")) {
			setDecisionValidation(t("review.removeRequired"));
			return;
		}
		decisionAction.mutate({
			reason: String(form.get("reason") ?? "").trim(),
			remove: item.associations.length > 0,
		});
	}
	return {
		reference,
		search,
		searchPage,
		preview,
		replace,
		validation,
		decisionValidation,
		success,
		searchQuery,
		details,
		replacement,
		busy,
		previewPending: previewAction.isPending,
		confirmPending: confirmAction.isPending,
		previewError: previewAction.error,
		confirmError: confirmAction.error,
		decisionError: decisionAction.error,
		selectWork,
		searchWorks,
		lookupWork,
		changeSearchPage: setSearchPage,
		requestPreview,
		requestDecision,
		clearPreview,
		clearDecisionValidation: () => setDecisionValidation(null),
		allowReplacement: setReplace,
		confirm: () => confirmAction.mutate(),
	};
}
export type ReviewController = ReturnType<typeof useReviewController>;
