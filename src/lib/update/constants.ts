import { homedir } from "node:os";
import path from "node:path";
import { CHIRO_VERSION } from "../../version.js";

export const GITHUB_REPO = "zaratan/chiro-tools";
export const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// Pinned to THIS binary's own release tag: the embedded self-update always
// runs the install.sh that shipped with — and was tested against — this
// exact version (it downloads latest, but the *script* itself must be the
// known-good one). This intentionally does NOT match the README's
// first-install curl|bash command, which stays on `main` on purpose: at
// first-install time there is no local version to pin to yet. See
// FALLBACK_INSTALL_SCRIPT_URL below and docs/architecture.md § "Contrat
// install.sh" for the tradeoff (a broken install.sh in a past release stays
// broken for that release's self-update until fallback/manual reinstall).
//
// Only release.yml rewrites package.json's version to match the git tag at
// build time. A local/dev run (`bun src/index.tsx` without that CI step)
// keeps whatever version is last committed to package.json, so it pins to
// THAT tag's install.sh — stale, not a 404 — rather than failing outright.
// Maintainer-only concern: every compiled binary users actually run comes
// from release.yml, where the tag always matches.
export const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/v${CHIRO_VERSION}/scripts/install.sh`;

// Used only for the message shown when the pinned self-update script fails
// (e.g. a deleted tag, or a dev build with no matching release) — points at
// the same URL documented in README.md for a manual first install.
export const FALLBACK_INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.sh`;

/** 15 s — generous for field use in low-signal areas */
export const UPDATE_FETCH_TIMEOUT_MS = 15_000;

/**
 * 6 h — compromise between GitHub anonymous rate limit (60 req/h, so ~3
 * fresh boots/h tolerated across all users sharing the same IP) and perceived
 * freshness for the end user (worst case: notices an update 6 h after release).
 */
export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const UPDATE_CACHE_PATH = path.join(
  homedir(),
  ".chiro",
  "update-check.json",
);
