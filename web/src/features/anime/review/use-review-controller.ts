import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type {
	CatalogPreviewResponse,
	CatalogReviewItem,
} from "../../../shared/api/contracts.js";
import { toast } from "../../../shared/components/ui/toast.js";
import {
	metadataDetailQuery,
	metadataSearchQuery,
	resolveMetadataReference,
} from "../metadata/public.js";
import { animeLibraryQueryKey } from "../shared/query-keys.js";
import { confirmMapping, decideReview, previewMapping } from "./api.js";
import { inlineReviewError, reportReviewFailure } from "./feedback.js";
import { parseMapping } from "./mapping.js";
export function useReviewController(item: CatalogReviewItem) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const navigate = useNavigate();
	const noticeId = `review-operation:${item.id}`;
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
		await Promise.all([
			client.invalidateQueries({ queryKey: ["catalog"] }),
			client.invalidateQueries({ queryKey: animeLibraryQueryKey }),
		]);
	};
	const previewAction = useMutation({
		onMutate: () => toast.close(noticeId),
		onError: (error) => reportReviewFailure(noticeId, error),
		mutationFn: previewMapping,
		onSuccess: (value) => {
			setPreview(value);
			setOperationKey(crypto.randomUUID());
			setReplace(false);
		},
	});
	const confirmAction = useMutation({
		onMutate: () => toast.close(noticeId),
		onError: (error) => reportReviewFailure(noticeId, error),
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
			toast.add({
				id: noticeId,
				type: "success",
				title: t("review.saved"),
				actionProps: {
					children: t("review.openWork"),
					onClick: () => {
						void navigate(`/anime/${encodeURIComponent(value.workId)}`);
					},
				},
			});
			await invalidate();
		},
	});
	const decisionAction = useMutation({
		onMutate: () => toast.close(noticeId),
		onError: (error) => reportReviewFailure(noticeId, error),
		mutationFn: ({ reason, remove }: { reason: string; remove: boolean }) =>
			decideReview(item.id, item.revision, reason, remove),
		onSuccess: async (_result, variables) => {
			setPreview(null);
			setDecisionValidation(null);
			toast.add({
				id: noticeId,
				type: "success",
				title: t(
					variables.remove ? "review.removalSaved" : "review.rejectionSaved",
				),
			});
			await invalidate();
		},
	});
	const lookup = useMutation({
		mutationFn: resolveMetadataReference,
		onSuccess: selectWork,
		onError: () => setValidation(t("review.invalidId")),
	});
	const busy =
		lookup.isPending ||
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
		setValidation(null);
		lookup.mutate(value);
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
		searchQuery,
		details,
		replacement,
		busy,
		previewPending: previewAction.isPending,
		confirmPending: confirmAction.isPending,
		previewError: inlineReviewError(previewAction.error),
		confirmError: inlineReviewError(confirmAction.error),
		decisionError: inlineReviewError(decisionAction.error),
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
