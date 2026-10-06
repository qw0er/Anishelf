import { useEffect, useState } from "react";
import { externalPlayerPolicy } from "../../../config/external-player-policy.js";
import {
	type CustomExternalPlayer,
	readCustomPlayers,
	validPlayerTemplate,
} from "../external-players.js";

const changeEvent = "anishelf:external-players-changed";
function load() {
	try {
		return { players: readCustomPlayers(window.localStorage), error: false };
	} catch {
		return { players: [] as CustomExternalPlayer[], error: true };
	}
}

export function useExternalPlayers() {
	const [state, setState] = useState(load);
	useEffect(() => {
		const refresh = () => setState(load());
		const onStorage = (event: StorageEvent) => {
			if (event.key === externalPlayerPolicy.storageKey || event.key === null)
				refresh();
		};
		window.addEventListener(changeEvent, refresh);
		window.addEventListener("storage", onStorage);
		return () => {
			window.removeEventListener(changeEvent, refresh);
			window.removeEventListener("storage", onStorage);
		};
	}, []);
	function save(players: CustomExternalPlayer[]) {
		window.localStorage.setItem(
			externalPlayerPolicy.storageKey,
			JSON.stringify(players),
		);
		window.dispatchEvent(new Event(changeEvent));
	}
	return {
		...state,
		add(name: string, template: string) {
			if (
				!name.trim() ||
				name.length > externalPlayerPolicy.maximumNameLength ||
				!validPlayerTemplate(template)
			)
				throw new Error("Invalid player");
			const current = readCustomPlayers(window.localStorage);
			if (current.length >= externalPlayerPolicy.maximumCustomPlayers)
				throw new Error("Too many players");
			save([
				...current,
				{ id: `custom:${crypto.randomUUID()}`, name, template },
			]);
		},
		remove(id: string) {
			save(
				readCustomPlayers(window.localStorage).filter(
					(player) => player.id !== id,
				),
			);
		},
	};
}
