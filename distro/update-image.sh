#!/usr/bin/env bash
# Fast path: mount the existing kos qcow2 and sync distro/overlay into it.
# Takes seconds or a minute, not a 20-minute rebuild.
#
# Usage (from the kos repo, usually via ./build.sh distro-update):
#   ./distro/update-image.sh
set -euo pipefail
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

KOS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISTRO="${KOS}/distro"
IMG="${KOS}/distro/out/kos.qcow2"
MNT="${DISTRO}/mnt"
KOS_USER="${KOS_USER:-pratham}"

if [[ ! -f "$IMG" ]]; then
  echo "No image at ${IMG}. Build it first with: ./build.sh distro" >&2
  exit 1
fi

if pgrep -af 'qemu-system-x86_64' | grep -q 'kos.qcow2'; then
  echo "QEMU is using the image. Close that window first; this script will not kill it." >&2
  exit 3
fi

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
  "${SUDO[@]}" -n true
fi

need_cmd() { command -v "$1" >/dev/null || { echo "missing command: $1" >&2; exit 1; }; }
need_cmd qemu-nbd
need_cmd rsync
need_cmd e2fsck

mkdir -p "$MNT"
NBD=/dev/nbd0
MOUNTED=0
CONNECTED=0

cleanup() {
  if [[ "$MOUNTED" -eq 1 ]]; then
    "${SUDO[@]}" umount "$MNT/dev/pts" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT/dev" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT/proc" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT/sys" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT" 2>/dev/null || true
    MOUNTED=0
  fi
  if [[ "$CONNECTED" -eq 1 ]]; then
    "${SUDO[@]}" qemu-nbd --disconnect "$NBD" 2>/dev/null || true
    CONNECTED=0
  fi
}
trap cleanup EXIT

echo "Mounting ${IMG} via qemu-nbd"
"${SUDO[@]}" modprobe nbd max_part=8
"${SUDO[@]}" qemu-nbd --disconnect "$NBD" 2>/dev/null || true
sleep 0.3
"${SUDO[@]}" qemu-nbd --connect="$NBD" "$IMG"
CONNECTED=1
for _ in $(seq 1 20); do
  [[ -e ${NBD}p1 ]] && break
  "${SUDO[@]}" partprobe "$NBD" 2>/dev/null || true
  sleep 0.3
done
[[ -e ${NBD}p1 ]] || { echo "FAIL: no ${NBD}p1" >&2; exit 1; }

# WSL/udev/udisks may auto-mount the just-attached partition, which
# makes e2fsck refuse to run.
if command -v findmnt >/dev/null; then
  while read -r mp; do
    [[ -n "$mp" ]] || continue
    echo "Unmounting auto-mount ${mp}"
    "${SUDO[@]}" umount "$mp" || true
  done < <(findmnt -nro TARGET "${NBD}p1" 2>/dev/null || true)
fi
sleep 0.2

set +e
"${SUDO[@]}" e2fsck -fy "${NBD}p1"
ec=$?
set -e
if (( ec != 0 && ec != 1 && ec != 2 )); then
  echo "FAIL: e2fsck exited ${ec}" >&2
  exit "$ec"
fi

"${SUDO[@]}" mount "${NBD}p1" "$MNT"
MOUNTED=1

start="$(date +%s)"
"${DISTRO}/sync-overlay.sh" "$MNT"

# Bind-mount so we can chroot to compile schemas and refresh dconf
"${SUDO[@]}" mount --bind /dev "$MNT/dev"
"${SUDO[@]}" mount --bind /dev/pts "$MNT/dev/pts"
"${SUDO[@]}" mount -t proc proc "$MNT/proc"
"${SUDO[@]}" mount -t sysfs sysfs "$MNT/sys"

"${SUDO[@]}" tee "$MNT/tmp/kos-apply-dconf.sh" >/dev/null << APPLY
#!/bin/bash
set -euo pipefail
glib-compile-schemas /usr/share/glib-2.0/schemas
dconf update
systemd-tmpfiles --create /usr/lib/tmpfiles.d/kos-x11.conf || true
export DEBIAN_FRONTEND=noninteractive
# Chroot has no resolver unless we bind /etc/resolv.conf; skip apt when
# KOS_SKIP_APT=1 or DNS is down so a CSS/JS tweak does not wait minutes.
if [[ "${KOS_SKIP_APT:-0}" == 1 ]]; then
  echo "Skipping apt (KOS_SKIP_APT=1)"
elif ! dpkg -s inotify-tools >/dev/null 2>&1; then
  if apt-get update && apt-get install -y --no-install-recommends inotify-tools; then
    :
  else
    echo "WARN: could not install inotify-tools (network?); hot-reload watcher may be missing"
  fi
fi
systemctl enable mnt-kosdev.mount || true
systemctl enable kos-shell-dev.service || true
systemctl --global enable kos-shell-reload.service || true
systemctl enable kos-tune.service || true
/usr/libexec/kos-tune || true
if id '${KOS_USER}' >/dev/null 2>&1; then
  sudo -u '${KOS_USER}' dbus-run-session dconf write /org/gnome/shell/enabled-extensions "['kos-shell@kos']" || true
  sudo -u '${KOS_USER}' dbus-run-session dconf write /org/gnome/shell/disable-user-extensions false || true
  sudo -u '${KOS_USER}' dbus-run-session dconf write /org/gnome/mutter/dynamic-workspaces false || true
  sudo -u '${KOS_USER}' dbus-run-session dconf write /org/gnome/desktop/wm/preferences/num-workspaces 1 || true
  sudo -u '${KOS_USER}' dbus-run-session dconf write /org/gnome/desktop/interface/enable-hot-corners false || true
  sudo -u '${KOS_USER}' dbus-run-session dconf write /org/gnome/desktop/interface/clock-show-date true || true
  sudo -u '${KOS_USER}' dbus-run-session dconf write /org/gnome/desktop/interface/icon-theme "'kos-icons'" || true
  sudo -u '${KOS_USER}' dbus-run-session dconf write /org/gnome/desktop/interface/enable-animations false || true
  sudo -u '${KOS_USER}' dbus-run-session dconf write /org/gnome/mutter/experimental-features "@as []" || true
fi
APPLY
  "${SUDO[@]}" chmod +x "$MNT/tmp/kos-apply-dconf.sh"
  "${SUDO[@]}" chroot "$MNT" /tmp/kos-apply-dconf.sh
  "${SUDO[@]}" rm -f "$MNT/tmp/kos-apply-dconf.sh"

"${SUDO[@]}" umount "$MNT/dev/pts"
"${SUDO[@]}" umount "$MNT/dev"
"${SUDO[@]}" umount "$MNT/proc"
"${SUDO[@]}" umount "$MNT/sys"
"${SUDO[@]}" umount "$MNT"
MOUNTED=0

set +e
"${SUDO[@]}" e2fsck -fy "${NBD}p1"
ec=$?
set -e
if (( ec != 0 && ec != 1 && ec != 2 )); then
  echo "FAIL: post-sync e2fsck exited ${ec}" >&2
  exit "$ec"
fi

"${SUDO[@]}" qemu-nbd --disconnect "$NBD"
CONNECTED=0
trap - EXIT

end="$(date +%s)"
echo "Image updated in $((end - start))s"
echo "Boot it with: ./build.sh distro-run"
