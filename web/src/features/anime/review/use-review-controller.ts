import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ApiClientError } from "../../../shared/api/client.js";
import type {
	CatalogPreviewResponse,
	CatalogReviewItem,
} from "../../../shared/api/contracts.js";
import { useQueryScope } from "../../../shared/api/queries.js";
import { toast } from "../../../shared/components/ui/toast.js";
import {
	metadataDetailQuery,
	metadataProvidersQuery,
	metadataSearchQuery,
	resolveMetadataReference,
} from "../metadata/public.js";
import { invalidateAnimeQueries } from "../shared/query-keys.js";
import {
	confirmMapping,
	decideReview,
	previewMapping,
	reidentifyReview,
} from "./api.js";
import { reportReviewFailure } from "./feedback.js";
import { parseMapping } from "./mapping.js";
import { reviewQuery } from "./queries.js";
export function useReviewController(item: CatalogReviewItem) {
	const { t } = useTranslation();
	const client = useQueryClient();
	const scope = useQueryScope();
	const navigate = useNavigate();
	const noticeId = `review-operation:${item.id}`;
	useEffect(() => () => toast.close(noticeId), [noticeId]);
	const [reference, setReference] = useState<{
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
	const [searchProvider, setSearchProvider] = useState("");
	const providersQuery = useQuery(metadataProvidersQuery());
	const [preview, setPreview] = useState<CatalogPreviewResponse | null>(null);
	const [operationKey, setOperationKey] = useState("");
	const [replace, setReplace] = useState(false);
	const [decisionValidation, setDecisionValidation] = useState<string | null>(
		null,
	);
	const [lookupValidation, setLookupValidation] = useState<string | null>(null);
	const [validation, setValidation] = useState<string | null>(null);
	const searchQuery = useQuery({
		...metadataSearchQuery(search, searchPage, searchProvider || undefined),
		enabled: search.length > 0,
	});
	const details = useQuery({
		...metadataDetailQuery(reference ?? { id: "" }),
		enabled: Boolean(reference),
	});
	const replacement = Boolean(preview?.rows.some((row) => row.before.length));
	const invalidate = async () => {
		await invalidateAnimeQueries(client, "local");
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
	const reidentifyAction = useMutation({
		onMutate: () => toast.close(noticeId),
		mutationFn: () => reidentifyReview(item.id, item.revision),
		onError: (error) => reportReviewFailure(noticeId, error),
		onSuccess: async (value) => {
			setPreview(null);
			setValidation(null);
			setReference(
				value.associations[0]?.reference ??
					value.recognizedWork?.reference ??
					null,
			);
			const key = reviewQuery(item.id, scope).queryKey;
			await client.cancelQueries({ queryKey: key });
			client.setQueryData(key, value);
			toast.add({
				id: noticeId,
				type: value.metadataStatus === "failed" ? "error" : "success",
				title: t(
					value.metadataStatus === "failed"
						? "review.reidentifyFailed"
						: value.decision === "confirmed"
							? "review.reidentifyAdded"
							: "review.reidentifyCompleted",
				),
			});
			await invalidate();
		},
	});
	const lookup = useMutation({
		mutationFn: (value: string) => resolveMetadataReference(value),
		onSuccess: selectWork,
		onError: (error) => {
			if (error instanceof ApiClientError && error.code === "INVALID_REQUEST")
				setLookupValidation(t("review.invalidId"));
			else reportReviewFailure(noticeId, error);
		},
	});
	const busy =
		lookup.isPending ||
		previewAction.isPending ||
		confirmAction.isPending ||
		decisionAction.isPending ||
		reidentifyAction.isPending;
	function clearPreview() {
		setPreview(null);
		setValidation(null);
	}

	function selectWork(value: NonNullable<typeof reference>) {
		setLookupValidation(null);
		setReference(value);
		clearPreview();
	}
	function searchWorks(value: string) {
		setSearch(value);
		setSearchPage(1);
	}

	function lookupWork(value: string) {
		setLookupValidation(null);
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
		searchProvider,
		providersQuery,
		changeSearchProvider: (provider: string) => {
			setSearchProvider(provider);
			setSearchPage(1);
		},
		reference,
		search,
		searchPage,
		preview,
		replace,
		validation,
		lookupValidation,
		decisionValidation,
		searchQuery,
		details,
		replacement,
		busy,
		previewPending: previewAction.isPending,
		confirmPending: confirmAction.isPending,
		reidentifyPending: reidentifyAction.isPending,
		reidentify: () => reidentifyAction.mutate(),
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
