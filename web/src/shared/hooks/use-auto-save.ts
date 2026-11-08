import { useEffect, useRef } from "react";

/** Wait for a typing pause before persisting a single-value setting. */
const autoSaveDelayMs = 500;

/**
 * Persist a single-value setting after the user stops editing it.
 *
 * The caller owns the draft, so a failed save stays editable and a later
 * change retries with the corrected value. Call the returned flush function
 * from `onBlur` to save without waiting for the typing pause.
 */
export function useAutoSave<T>(
	value: T,
	saved: T,
	save: (value: T) => void,
	enabled = true,
) {
	const saveRef = useRef(save);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const requested = useRef<{ value: T; saved: T } | null>(null);
	useEffect(() => {
		saveRef.current = save;
	});
	useEffect(() => {
		if (!enabled || Object.is(value, saved)) return;
		const request = { value, saved };
		timer.current = setTimeout(() => {
			timer.current = null;
			requested.current = request;
			saveRef.current(value);
		}, autoSaveDelayMs);
		return () => {
			if (timer.current !== null) clearTimeout(timer.current);
			timer.current = null;
		};
	}, [value, saved, enabled]);
	return () => {
		if (timer.current !== null) {
			clearTimeout(timer.current);
			timer.current = null;
		}
		if (!enabled || Object.is(value, saved)) return;
		const previous = requested.current;
		if (
			previous &&
			Object.is(previous.value, value) &&
			Object.is(previous.saved, saved)
		)
			return;
		requested.current = { value, saved };
		saveRef.current(value);
	};
}
