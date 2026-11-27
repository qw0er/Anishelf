import { refreshAcquisitionState } from "../../features/acquisition/public.js";
import type { createClientRuntime } from "../../shared/api/connection.js";

const retryDelays = [1_000, 3_000, 8_000];

export function watchServerResume({
	authentication,
	connection,
	onAuthRequired,
	platform,
	queryClient,
}: ReturnType<typeof createClientRuntime>): void {
	if (!platform.onSystemResume || connection.signal.aborted) return;
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function cancelRecovery() {
		clearTimeout(timer);
		generation++;
	}

	async function recover(wake: number, retry: number): Promise<void> {
		const current = () => wake === generation && !connection.signal.aborted;
		try {
			const { authenticated } = await authentication.getSession();
			if (!current()) return;
			if (!authenticated) {
				onAuthRequired();
				return;
			}
			await refreshAcquisitionState(queryClient);
			if (current()) console.debug("connection.system_resume_refreshed");
		} catch (error) {
			if (!current()) return;
			const delay = retryDelays[retry];
			if (delay === undefined) {
				console.warn("connection.system_resume_failed", { error });
				return;
			}
			timer = setTimeout(() => void recover(wake, retry + 1), delay);
		}
	}

	const stopResume = platform.onSystemResume(() => {
		cancelRecovery();
		void recover(generation, 0);
	});
	connection.signal.addEventListener(
		"abort",
		() => {
			cancelRecovery();
			stopResume();
		},
		{ once: true },
	);
}
