#!/usr/bin/env bash
# Copy kos white-label files into a mounted image root.
# Used by build-image.sh and update-image.sh. Idempotent.
set -euo pipefail

MNT="${1:?usage: apply-branding.sh <mountpoint>}"
DISTRO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="${DISTRO}/config"
OUT="${DISTRO}/out"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi

logo=""
if [[ -f "${OUT}/kos-logo.png" ]]; then
  logo="${OUT}/kos-logo.png"
elif [[ -f "${CFG}/kos-logo.png" ]]; then
  logo="${CFG}/kos-logo.png"
fi

"${SUDO[@]}" cp "${CFG}/os-release" "$MNT/etc/os-release"
"${SUDO[@]}" mkdir -p "$MNT/usr/lib"
"${SUDO[@]}" cp "${CFG}/os-release" "$MNT/usr/lib/os-release"
"${SUDO[@]}" cp "${CFG}/hostname" "$MNT/etc/hostname"
"${SUDO[@]}" cp "${CFG}/hosts" "$MNT/etc/hosts"
"${SUDO[@]}" cp "${CFG}/grub.default" "$MNT/etc/default/grub"
"${SUDO[@]}" cp "${CFG}/lsb-release" "$MNT/etc/lsb-release"
"${SUDO[@]}" cp "${CFG}/issue" "$MNT/etc/issue"
"${SUDO[@]}" cp "${CFG}/issue.net" "$MNT/etc/issue.net"

# Login banners: replace Debian's motd / legal notice. Package copyright
# files under /usr/share/doc are left alone.
printf 'kos 0.1\n' | "${SUDO[@]}" tee "$MNT/etc/motd" >/dev/null
if [[ -e "$MNT/etc/legal" ]]; then
  printf 'kos 0.1\n' | "${SUDO[@]}" tee "$MNT/etc/legal" >/dev/null
fi
# Some Debian installs also ship a motd fragment.
if [[ -d "$MNT/etc/motd.d" ]]; then
  "${SUDO[@]}" find "$MNT/etc/motd.d" -type f -delete || true
fi

if [[ -n "$logo" ]]; then
  "${SUDO[@]}" mkdir -p "$MNT/usr/share/pixmaps"
  "${SUDO[@]}" mkdir -p "$MNT/usr/share/icons/hicolor/256x256/apps"
  # Settings About looks up, in order, $LOGO-text-dark, $LOGO-text,
  # $LOGO-dark, then $LOGO (LOGO=kos-logo). The wordmark is the text
  # variant; the same file is used for all four names so a dark session
  # does not fall back to debian-logo.
  for name in kos-logo kos-logo-dark kos-logo-text kos-logo-text-dark; do
    "${SUDO[@]}" cp "$logo" "$MNT/usr/share/pixmaps/${name}.png"
    "${SUDO[@]}" cp "$logo" "$MNT/usr/share/icons/hicolor/256x256/apps/${name}.png"
  done
  if [[ -d "$MNT/usr/share/plymouth/themes/kos" ]]; then
    "${SUDO[@]}" cp "$logo" "$MNT/usr/share/plymouth/themes/kos/logo.png"
  fi
fi
