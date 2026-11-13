import { useEffect, useState } from "react";
import { getClientRuntime } from "../../../shared/api/connection.js";
import { externalPlayerPolicy } from "../external-player-policy.js";
import {
	type CustomExternalPlayer,
	readCustomPlayers,
	validPlayerTemplate,
} from "../external-players.js";

function load() {
	try {
		return {
			players: readCustomPlayers(getClientRuntime().platform.preferences),
			error: false,
		};
	} catch {
		return { players: [] as CustomExternalPlayer[], error: true };
	}
}

export function useExternalPlayers() {
	const [state, setState] = useState(load);
	const { platform } = getClientRuntime();
	useEffect(
		() =>
			platform.onPreferenceChange(externalPlayerPolicy.storageKey, () =>
				setState(load()),
			),
		[platform],
	);
	function save(players: CustomExternalPlayer[]) {
		getClientRuntime().platform.preferences.setItem(
			externalPlayerPolicy.storageKey,
			JSON.stringify(players),
		);
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
			const current = readCustomPlayers(
				getClientRuntime().platform.preferences,
			);
			if (current.length >= externalPlayerPolicy.maximumCustomPlayers)
				throw new Error("Too many players");
			save([
				...current,
				{ id: `custom:${crypto.randomUUID()}`, name, template },
			]);
		},
		remove(id: string) {
			save(
				readCustomPlayers(getClientRuntime().platform.preferences).filter(
					(player) => player.id !== id,
				),
			);
		},
	};
}
