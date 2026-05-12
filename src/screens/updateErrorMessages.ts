import type { FetchErrorCode } from "../lib/update/fetchLatestVersion.js";

export type UpdateErrorCode = FetchErrorCode | "parse-local";

const ERROR_TITLES: Record<UpdateErrorCode, string> = {
  network: "Impossible de vérifier la dernière version.",
  timeout: "Impossible de vérifier la dernière version.",
  "http-403": "GitHub bloque temporairement les vérifications.",
  "http-404": "Impossible de vérifier la dernière version.",
  parse: "Impossible de vérifier la dernière version.",
  "parse-local": "Impossible de comparer les versions.",
};

const ERROR_HINTS: Record<UpdateErrorCode, string> = {
  network: "Vérifiez votre connexion internet, puis réessayez.",
  timeout: "Vérifiez votre connexion internet, puis réessayez.",
  "http-403":
    "C'est normal si vous lancez chiro très souvent.\nRéessayez dans une heure.",
  "http-404": "Aucune version publiée. Contactez le développeur.",
  parse: "Réessayez ; si le problème persiste, contactez le développeur.",
  "parse-local":
    "Réinstallez chiro depuis https://github.com/zaratan/chiro-tools.",
};

const ERROR_LABELS: Record<UpdateErrorCode, string> = {
  network: "pas de connexion",
  timeout: "délai dépassé",
  "http-403": "quota GitHub atteint",
  "http-404": "aucune version publiée",
  parse: "réponse inattendue",
  "parse-local": "version locale illisible",
};

export const getErrorTitle = (code: UpdateErrorCode): string =>
  ERROR_TITLES[code];

export const getErrorHint = (code: UpdateErrorCode): string =>
  ERROR_HINTS[code];

export const getErrorLabel = (code: UpdateErrorCode): string =>
  ERROR_LABELS[code];
