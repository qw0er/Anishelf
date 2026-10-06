import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getFilePreparations, getPreparations } from "../../api/client.js";
import type { PreparationTaskResponse } from "../../api/contracts.js";
import { toast } from "../../components/ui/toast.js";
import { interactionPolicy } from "../../config/interaction-policy.js";
import { getErrorTranslationKey } from "../../lib/error-translation.js";

export function usePreparations(fileId?: string, enabled = true) {
	const [tasks, setTasks] = useState<PreparationTaskResponse[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<unknown>(null);
	const [revision, setRevision] = useState(0);
	// Refresh revisions deliberately restart the bounded polling loop.
	// biome-ignore lint/correctness/useExhaustiveDependencies: explicit refresh trigger
	useEffect(() => {
		const controller = new AbortController();
		if (!enabled) {
			setLoading(false);
			setTasks([]);
			return () => controller.abort();
		}
		setLoading(true);
		let timer: ReturnType<typeof setTimeout>;
		async function load() {
			let poll = false;
			try {
				const options = {
					signal: AbortSignal.any([
						controller.signal,
						AbortSignal.timeout(interactionPolicy.preparationRequestTimeoutMs),
					]),
				};
				const result = await (fileId
					? getFilePreparations(fileId, options)
					: getPreparations(options));
				if (controller.signal.aborted) return;
				setTasks(result.tasks);
				poll = result.tasks.some(
					(task) =>
						task.status === "queued" ||
						task.status === "processing" ||
						task.status === "cancelling" ||
						task.playbackAvailability === "unknown",
				);
				setError(null);
			} catch (cause) {
				if (!controller.signal.aborted) setError(cause);
			} finally {
				if (!controller.signal.aborted) {
					setLoading(false);
					if (poll)
						timer = setTimeout(
							() => void load(),
							interactionPolicy.preparationPollIntervalMs,
						);
				}
			}
		}
		void load();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [revision, fileId, enabled]);
	return {
		tasks,
		loading,
		error,
		refresh: useCallback(() => setRevision((v) => v + 1), []),
		remember: useCallback((task: PreparationTaskResponse) => {
			setTasks((current) => [
				task,
				...current.filter((item) => item.id !== task.id),
			]);
			setRevision((value) => value + 1);
		}, []),
	};
}

/** Abort client requests on departure; server jobs are cancelled only explicitly. */
export function usePreparationAction() {
	const { t } = useTranslation();
	const notificationId = `preparation-action:${useId()}`;
	const active = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			active.current?.abort();
			toast.close(notificationId);
		};
	}, [notificationId]);
	async function run(action: (signal: AbortSignal) => Promise<void>) {
		if (active.current) return;
		const controller = new AbortController();
		active.current = controller;
		setBusy(true);
		toast.close(notificationId);
		try {
			await action(
				AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(interactionPolicy.preparationRequestTimeoutMs),
				]),
			);
		} catch (cause) {
			if (!controller.signal.aborted && mounted.current)
				toast.add({
					id: notificationId,
					type: "error",
					priority: "high",
					title: t(getErrorTranslationKey(cause) ?? "errors.requestFailed"),
				});
		} finally {
			if (active.current === controller) active.current = null;
			if (mounted.current) setBusy(false);
		}
	}
	return { busy, run };
}
