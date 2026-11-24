#!/usr/bin/env bash
# Copy the white-label files (Proxim OS by Atahastra) into a mounted image
# root. Used by build-image.sh and update-image.sh. Idempotent.
#
# The name, version, vendor and logo id come from branding/branding.env.
# Images are pre-rendered in branding/gen (branding/make-assets.py), so a
# build needs no fonts or image tools. Steps that must run inside the
# image (plymouth default + initramfs, update-grub, the Settings About
# emblem alternative, icon caches) are in /usr/libexec/kos-whitelabel.
set -euo pipefail

MNT="${1:?usage: apply-branding.sh <mountpoint>}"
DISTRO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="${DISTRO}/config"
BR="${DISTRO}/branding"
GEN="${BR}/gen"

# shellcheck source=branding/branding.env
source "${BR}/branding.env"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi
put() { "${SUDO[@]}" install -D -m 0644 "$1" "$MNT/$2"; }
write() { "${SUDO[@]}" mkdir -p "$(dirname "$MNT/$1")"; "${SUDO[@]}" tee "$MNT/$1" >/dev/null; }

pretty="${OS_NAME} ${OS_VERSION}"

# --- Names -------------------------------------------------------------
# VERSION_CODENAME stays trixie so apt and Software keep Debian's suites.
osr="PRETTY_NAME=\"${pretty}\"
NAME=\"${OS_NAME}\"
VERSION_ID=\"${OS_VERSION}\"
VERSION=\"${OS_VERSION}\"
VERSION_CODENAME=trixie
ID=${OS_ID}
ID_LIKE=debian
VENDOR_NAME=\"${OS_VENDOR}\"
ANSI_COLOR=\"1;37\"
LOGO=${OS_LOGO}"
# On Debian /etc/os-release is a symlink to ../usr/lib/os-release.
printf '%s\n' "$osr" | write usr/lib/os-release
if [[ ! -L "$MNT/etc/os-release" ]]; then
  printf '%s\n' "$osr" | write etc/os-release
fi

write etc/lsb-release << LSB
DISTRIB_ID="${OS_NAME}"
DISTRIB_RELEASE=${OS_VERSION}
DISTRIB_CODENAME=trixie
DISTRIB_DESCRIPTION="${pretty}"
LSB
printf '%s \\n \\l\n\n' "$pretty" | write etc/issue
printf '%s\n' "$pretty" | write etc/issue.net
printf '%s by %s\n' "$pretty" "$OS_VENDOR" | write etc/motd
if [[ -e "$MNT/etc/legal" ]]; then
  printf '%s\n' "$pretty" | write etc/legal
fi
if [[ -d "$MNT/etc/motd.d" ]]; then
  "${SUDO[@]}" find "$MNT/etc/motd.d" -type f -delete || true
fi
printf '%s\n' "$OS_HOSTNAME" | write etc/hostname
write etc/hosts << HOSTS
127.0.0.1	localhost
127.0.1.1	${OS_HOSTNAME}

::1	localhost ip6-localhost ip6-loopback
ff02::1	ip6-allnodes
ff02::2	ip6-allrouters
HOSTS
put "${CFG}/grub.default" etc/default/grub
put "${GEN}/grub-bg.png" usr/share/kos/grub-bg.png
put "${BR}/branding.env" usr/share/kos/branding.env

# --- Logo --------------------------------------------------------------
# Icon theme entries. Settings About and other apps look up $LOGO,
# $LOGO-dark, $LOGO-text and $LOGO-text-dark. The mark is silver, so the
# same art serves the (locked) dark theme everywhere.
for s in 16 24 32 48 64 96 128 256; do
  for n in "${OS_LOGO}" "${OS_LOGO}-dark"; do
    put "${GEN}/proxim-logo-${s}.png" "usr/share/icons/hicolor/${s}x${s}/apps/${n}.png"
  done
done
for n in "${OS_LOGO}-text" "${OS_LOGO}-text-dark"; do
  put "${GEN}/proxim-logo-text-256.png" "usr/share/icons/hicolor/256x256/apps/${n}.png"
done
put "${GEN}/proxim-logo-256.png" "usr/share/pixmaps/${OS_LOGO}.png"
put "${GEN}/proxim-logo-text-256.png" "usr/share/pixmaps/${OS_LOGO}-text.png"
put "${GEN}/proxim-gdm.png" usr/share/pixmaps/proxim-gdm.png
# Debian's Settings About shows the vendor-logos emblem, not $LOGO;
# kos-whitelabel points that alternative at these files.
V=usr/share/kos/vendor-logos
put "${GEN}/proxim-about.svg" "$V/emblem.svg"
for s in 64 128 256; do
  put "${GEN}/proxim-logo-${s}.png" "$V/emblem-${s}.png"
done

# Boot splash
P=usr/share/plymouth/themes/${PLYMOUTH_THEME}
put "${BR}/plymouth/proxim.plymouth" "$P/${PLYMOUTH_THEME}.plymouth"
put "${BR}/plymouth/proxim.script" "$P/proxim.script"
for f in "${GEN}"/splash-*.png "${GEN}"/spinner-*.png; do
  put "$f" "$P/$(basename "$f")"
done

# GDM login screen logo + background
put "${CFG}/gdm-dconf-profile" etc/dconf/profile/gdm
put "${CFG}/gdm-dconf-kos.ini" etc/dconf/db/gdm.d/00-kos
