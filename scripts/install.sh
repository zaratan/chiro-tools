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

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
else
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
fi

mkdir -p "$INSTALL_DIR"
DEST="${INSTALL_DIR}/chiro"
TMP="${DEST}.tmp.$$"

echo "Téléchargement de chiro (${VERSION}) depuis GitHub Releases…"
# Atomic install: download to a tmp file first, only swap if successful.
# Avoids leaving a partial binary at $DEST if curl is interrupted.
curl -fL "$URL" -o "$TMP"
chmod +x "$TMP"
mv "$TMP" "$DEST"

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
