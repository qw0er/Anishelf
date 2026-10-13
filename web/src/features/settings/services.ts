import { saveSettings as internal_saveSettings } from "./api.js";
export const saveSettings = (
	...args: Parameters<typeof internal_saveSettings>
) => internal_saveSettings(...args);

import { settingsQuery as internal_settingsQuery } from "./queries.js";
export const settingsQuery = (
	...args: Parameters<typeof internal_settingsQuery>
) => internal_settingsQuery(...args);

import { profilesQuery as internal_profilesQuery } from "./queries.js";
export const profilesQuery = (
	...args: Parameters<typeof internal_profilesQuery>
) => internal_profilesQuery(...args);

import { buildPlayerUrl as internal_buildPlayerUrl } from "./external-players.js";
export const buildPlayerUrl = (
	...args: Parameters<typeof internal_buildPlayerUrl>
) => internal_buildPlayerUrl(...args);

import { detectClientPlatform as internal_detectClientPlatform } from "./external-player-policy.js";
export const detectClientPlatform = (
	...args: Parameters<typeof internal_detectClientPlatform>
) => internal_detectClientPlatform(...args);

import { presetsForPlatform as internal_presetsForPlatform } from "./external-player-policy.js";
export const presetsForPlatform = (
	...args: Parameters<typeof internal_presetsForPlatform>
) => internal_presetsForPlatform(...args);

import { useExternalPlayers as internal_useExternalPlayers } from "./hooks/use-external-players.js";
export const useExternalPlayers = (
	...args: Parameters<typeof internal_useExternalPlayers>
) => internal_useExternalPlayers(...args);
