#!/usr/bin/env bash
# Boot the kos desktop with the extension directory shared from the host,
# so CSS/JS edits reload in a couple of seconds. See distro/README.md.
set -euo pipefail
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

KOS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMG="${KOS}/distro/out/kos.qcow2"
SHARE="${KOS}/distro/overlay/usr/share/gnome-shell/extensions/kos-shell@kos"

if [[ ! -f "$IMG" ]]; then
  echo "No image at ${IMG}. Build it first with: ./build.sh distro" >&2
  exit 1
fi
if [[ ! -f "${SHARE}/metadata.json" ]]; then
  echo "Extension sources missing at ${SHARE}" >&2
  exit 1
fi
# shellcheck source=qemu-flags.sh
source "${KOS}/distro/qemu-flags.sh"
kos_qemu_detect
if [[ ${#KOS_QEMU_ACCEL[@]} -eq 0 ]]; then
  echo "KVM is not available. The desktop would be very slow." >&2
  exit 1
fi

if pgrep -af 'qemu-system-x86_64' | grep -q 'kos.qcow2'; then
  echo "The kos image is already booted in QEMU. Shut that down first." >&2
  exit 1
fi

QEMU_EXTRA=()
DISPLAY_ARGS=()
if [[ "${KOS_DISTRO_HEADLESS:-}" == "1" ]]; then
  kos_qemu_headless_display
  DISPLAY_ARGS=("${KOS_QEMU_DISPLAY[@]}")
else
  kos_qemu_window_display
  DISPLAY_ARGS=("${KOS_QEMU_DISPLAY[@]}")
  echo "Booting kos desktop in dev mode."
  echo "Edit files in:"
  echo "  ${SHARE}"
  echo "stylesheet.css is the CSS; *.js is the GNOME Shell UI. Saves should"
  echo "reload the extension in about two seconds."
  echo "Limit: some JavaScript module changes are cached by GJS/ESM and may"
  echo "need a log out/in (or a VM reboot) to take effect. CSS usually does not."
fi

# Prefer virtiofsd when it is clearly usable; otherwise 9p, which works in
# stock QEMU + the Debian guest kernel without a helper daemon.
VIRTIOFSD=""
for c in virtiofsd /usr/lib/qemu/virtiofsd /usr/libexec/virtiofsd; do
  if command -v "$c" >/dev/null 2>&1 || [[ -x "$c" ]]; then
    VIRTIOFSD="$c"
    break
  fi
done

FS_KIND="9p"
if [[ -n "$VIRTIOFSD" && -d /dev/shm && "${KOS_DISTRO_FORCE_9P:-}" != "1" ]]; then
  # virtiofs needs a vhost-user socket and shared memory. This is flaky in
  # some WSL setups, so we fall back to 9p if the daemon fails to start.
  SOCK="/tmp/kos-virtiofs.sock"
  rm -f "$SOCK"
  if "$VIRTIOFSD" --socket-path="$SOCK" --shared-dir="$SHARE" --cache=auto >/tmp/kos-virtiofs.log 2>&1 & then
    VPID=$!
    sleep 0.4
    if [[ -S "$SOCK" ]] && kill -0 "$VPID" 2>/dev/null; then
      FS_KIND="virtiofs"
      QEMU_EXTRA+=(
        -chardev "socket,id=kosfs,path=${SOCK}"
        -device vhost-user-fs-pci,queue-size=1024,chardev=kosfs,tag=kosdev
        -object memory-backend-memfd,id=mem,size=4G,share=on
        -numa node,memdev=mem
      )
      echo "Sharing extension dir via virtiofs (${SHARE})"
    else
      echo "virtiofsd did not start; falling back to 9p" >&2
      kill "$VPID" 2>/dev/null || true
      FS_KIND="9p"
    fi
  fi
fi

if [[ "$FS_KIND" == "9p" ]]; then
  echo "Sharing extension dir via 9p (${SHARE})"
  QEMU_EXTRA+=(-virtfs "local,path=${SHARE},mount_tag=kosdev,security_model=none,id=kosdev")
fi

# Headless stays attached to this tool; interactive exec's QEMU (replaces us).
if [[ "${KOS_DISTRO_HEADLESS:-}" == "1" ]]; then
  rm -f /tmp/kos-ui-mon.sock /tmp/kos-ui-qmp.sock /tmp/kos-ui-qemu.pid
  kos_qemu_print
  qemu-system-x86_64 \
    "${KOS_QEMU_ACCEL[@]}" -m "${KOS_QEMU_MEM}" -smp "${KOS_QEMU_SMP}" \
    "${DISPLAY_ARGS[@]}" \
    -drive "file=${IMG},${KOS_QEMU_DRIVE_OPTS}" \
    -nic user,model=virtio-net-pci \
    -usb -device usb-tablet \
    "${QEMU_EXTRA[@]}" \
    -pidfile /tmp/kos-ui-qemu.pid \
    -daemonize
  echo "Headless dev VM started"
else
  kos_qemu_print
  exec qemu-system-x86_64 \
    "${KOS_QEMU_ACCEL[@]}" -m "${KOS_QEMU_MEM}" -smp "${KOS_QEMU_SMP}" \
    "${DISPLAY_ARGS[@]}" \
    -drive "file=${IMG},${KOS_QEMU_DRIVE_OPTS}" \
    -nic user,model=virtio-net-pci \
    -usb -device usb-tablet \
    "${QEMU_EXTRA[@]}"
fi
