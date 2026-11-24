#!/usr/bin/env bash
# Copy kos customisations (extension, dconf defaults, schemas) into a
# mounted root filesystem. Used by both the full image build and the
# fast distro-update path.
set -euo pipefail
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

MNT="${1:?usage: sync-overlay.sh <mountpoint>}"
KOS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISTRO="${KOS}/distro"
CFG="${DISTRO}/config"
OVERLAY="${DISTRO}/overlay"

if [[ ! -d "$MNT/usr" ]]; then
  echo "Does not look like a mounted root: ${MNT}" >&2
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi

if [[ -d "$OVERLAY" ]]; then
  echo "Syncing ${OVERLAY} -> ${MNT}"
  # --chown so we never apply the host user's uid to the image root
  # (rsync -a src/ dest/ would otherwise chown "/" to pratham and break systemd).
  # F644 would strip the execute bit from /usr/libexec/kos-shell-reload.
  # u=rwX,go=rX keeps +x on files that are executable in the overlay.
  "${SUDO[@]}" rsync -a --exclude '.git' --chown=root:root --chmod=D755,Fu=rwX,go=rX "${OVERLAY}/" "${MNT}/"
fi

# Files under overlay/home/<user> (e.g. ~/.config/gtk-4.0/gtk.css) were
# copied as root above; give them back to that user, or GNOME can't write ~/.config.
if [[ -d "$OVERLAY/home" ]]; then
  for d in "$OVERLAY"/home/*/; do
    u="$(basename "$d")"
    ids="$(awk -F: -v u="$u" '$1 == u {print $3 ":" $4}' "$MNT/etc/passwd")"
    [[ -n "$ids" && -d "$MNT/home/$u" ]] && "${SUDO[@]}" chown -R "$ids" "$MNT/home/$u"
  done
fi

# dconf system defaults (user profile + local database)
"${SUDO[@]}" mkdir -p "$MNT/etc/dconf/profile" "$MNT/etc/dconf/db/local.d"
"${SUDO[@]}" cp "${CFG}/dconf-user-profile" "$MNT/etc/dconf/profile/user"
"${SUDO[@]}" cp "${CFG}/dconf-kos-shell.ini" "$MNT/etc/dconf/db/local.d/00-kos-shell"

# Keep gschema overrides in sync too (wallpaper, workspaces, enabled-extensions)
"${SUDO[@]}" mkdir -p "$MNT/usr/share/glib-2.0/schemas"
"${SUDO[@]}" cp "${CFG}/kos.gschema.override" "$MNT/usr/share/glib-2.0/schemas/90-kos.gschema.override"

# Permissions on the extension and helper scripts should be consistent
if [[ -d "$MNT/usr/share/gnome-shell/extensions/kos-shell@kos" ]]; then
  "${SUDO[@]}" chmod -R a+rX "$MNT/usr/share/gnome-shell/extensions/kos-shell@kos"
fi
for bin in kos-shell-reload kos-mount-dev kos-tune kos-setup-software kos-whitelabel; do
  if [[ -f "$MNT/usr/libexec/${bin}" ]]; then
    "${SUDO[@]}" chmod 755 "$MNT/usr/libexec/${bin}"
  fi
done

# rsync -a src/ dest/ updates dest's own metadata; force the guest root back to root.
"${SUDO[@]}" chown root:root "$MNT"
# If an earlier sync left host-uid files under system dirs, put them back.
# Skip when running as root: id -u would be 0 and chown of every root-owned
# file would strip setuid from sudo, su, pkexec, etc.
host_uid="${SUDO_UID:-$(id -u)}"
if [[ "$host_uid" != 0 ]]; then
  "${SUDO[@]}" find "$MNT/usr" "$MNT/etc" "$MNT/lib" "$MNT/boot" "$MNT/var" "$MNT/tmp" \
    -uid "$host_uid" -exec chown root:root {} + 2>/dev/null || true
fi

echo "Overlay sync finished"
