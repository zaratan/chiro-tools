#!/usr/bin/env bash
set -euo pipefail

# chiro install script — downloads the binary matching the host OS/arch
# from GitHub Releases and installs it to ~/.local/bin/chiro.
#
# Usage:
#   curl -fL https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh | bash
#
# Optional env vars:
#   CHIRO_VERSION       — pin a specific version (default: latest), e.g. "v0.1.0"
#   CHIRO_INSTALL_DIR   — destination directory (default: ~/.local/bin)

REPO="zaratan/chiro-tools"
VERSION="${CHIRO_VERSION:-latest}"
INSTALL_DIR="${CHIRO_INSTALL_DIR:-$HOME/.local/bin}"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS-$ARCH" in
  Darwin-arm64) ASSET="chiro-darwin-arm64" ;;
  Linux-x86_64) ASSET="chiro-linux-x64" ;;
  *)
    echo "Plateforme non supportée pour le moment : $OS $ARCH" >&2
    echo "(MVP : macOS Apple Silicon + Linux x86_64)" >&2
    exit 1
    ;;
esac

TARBALL="${ASSET}.tar.gz"

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/${REPO}/releases/latest/download/${TARBALL}"
else
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${TARBALL}"
fi

mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/chiro"
TARBALL_TMP="${INSTALL_DIR}/.chiro-tarball.tmp.$$"
SUMS_TMP="${INSTALL_DIR}/.chiro-sha256sums.tmp.$$"
BIN_TMP="${DEST}.tmp.$$"

cleanup() { rm -f "$TARBALL_TMP" "$SUMS_TMP" "$BIN_TMP"; }
trap cleanup EXIT

echo "Téléchargement de chiro (${VERSION}) depuis GitHub Releases…"
# Atomic install: download the tarball, extract the single binary entry to a
# tmp path next to $DEST, then rename. The final `mv` is atomic on the same
# filesystem and never leaves a partial binary at $DEST if curl or tar fail.
#
# INVARIANT — no destructive operation before the `mv` below. This script is
# executed via `curl | bash` by the in-app updater: a truncated download must
# never be able to leave a corrupt or missing $DEST. Keep every write on tmp
# paths until the single atomic rename.
curl -fL "$URL" -o "$TARBALL_TMP"

# Integrity check: verify the tarball's SHA256 against the SHA256SUMS file
# published alongside it (release.yml) before extracting anything.
#
# Fail-open (warn, keep going) if SHA256SUMS is missing or no hash tool is
# available — the threat covered here is network corruption/truncation, not
# a compromised origin (the sums file and the tarball come from the same
# GitHub release), and hard-failing on "missing" would break every install
# in the window between this script landing on main and the next tagged
# release. Hard-fail only on an actual mismatch: the tarball is provably not
# what the release published.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

warn_no_verification() {
  echo ""
  echo "⚠ Impossible de vérifier que le téléchargement est complet"
  echo "  ($1)."
  echo "  L'installation continue normalement."
  echo ""
}

if [ "$VERSION" = "latest" ]; then
  SUMS_URL="https://github.com/${REPO}/releases/latest/download/SHA256SUMS"
else
  SUMS_URL="https://github.com/${REPO}/releases/download/${VERSION}/SHA256SUMS"
fi

if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  warn_no_verification "aucun outil de vérification sur cet ordinateur"
elif ! curl -fsL "$SUMS_URL" -o "$SUMS_TMP" 2>/dev/null; then
  warn_no_verification "cette version ne fournit pas de fichier de contrôle"
else
  # Exact field match via awk, not `grep | awk`: under `set -o pipefail`, a
  # non-matching grep (rc=1) would abort the whole script silently even
  # though awk itself exits 0 — awk alone stays rc=0 whether or not a line
  # matches, so a tarball missing from SHA256SUMS falls through to the
  # "no line" branch below instead of killing the install. `exit` right
  # after the match (rather than piping through `head -n1`) avoids a
  # theoretical SIGPIPE on the pipe under `pipefail` for no extra cost.
  EXPECTED_SUM="$(awk -v f="$TARBALL" '$2 == f { print $1; exit }' "$SUMS_TMP")"
  if [ -z "$EXPECTED_SUM" ]; then
    # Distinct wording from the "file missing" case above: SHA256SUMS did
    # download, it just doesn't list this platform's asset (a genuinely
    # broken release) — don't claim the file itself is absent.
    warn_no_verification "aucune somme de contrôle disponible pour ce fichier"
  else
    ACTUAL_SUM="$(sha256_of "$TARBALL_TMP")"
    if [ "$ACTUAL_SUM" != "$EXPECTED_SUM" ]; then
      echo "" >&2
      echo "⚠ Le fichier téléchargé est incomplet ou abîmé." >&2
      echo "" >&2
      echo "Rien n'a été installé : votre version actuelle de chiro" >&2
      echo "n'a pas été touchée." >&2
      echo "" >&2
      echo "C'est presque toujours une coupure de connexion passagère." >&2
      echo "Il suffit de recommencer l'installation (ou la mise à jour" >&2
      echo "depuis chiro) pour réessayer." >&2
      echo "" >&2
      echo "Détail technique : somme de contrôle SHA256 différente de" >&2
      echo "  celle attendue (à transmettre si vous demandez de l'aide)" >&2
      exit 1
    fi
    echo "✓ Fichier téléchargé vérifié"
  fi
fi

tar -O -xzf "$TARBALL_TMP" "${ASSET}" > "$BIN_TMP"
chmod +x "$BIN_TMP"
mv "$BIN_TMP" "$DEST"

echo "✓ chiro installé dans ${DEST}"

# PATH check (best-effort): warn the user if the install dir is missing from PATH.
case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    echo "Vous pouvez lancer chiro en tapant simplement : chiro"
    ;;
  *)
    echo ""
    echo "⚠ Le dossier ${INSTALL_DIR} n'est pas dans votre PATH."
    echo "Pour le rendre disponible partout, ajoutez cette ligne à votre"
    echo "fichier ~/.zshrc (macOS) ou ~/.bashrc (Linux) :"
    echo ""
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    echo "Puis ouvrez un nouveau terminal."
    echo "En attendant, vous pouvez lancer : ${DEST}"
    ;;
esac
