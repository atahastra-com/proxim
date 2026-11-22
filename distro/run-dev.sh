#!/usr/bin/env bash
# Boot the kos desktop with the extension directory shared from the host,
# so CSS/JS/apps.txt edits reload in about a second. See distro/README.md.
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
  echo "stylesheet.css is the CSS; *.js is the GNOME Shell UI; apps.txt is the grid list."
  echo "Saves reload the extension in ~1 second."
  echo "Limit: some JavaScript module changes are cached by GJS/ESM and may"
  echo "need a log out/in (or a VM reboot) to take effect. CSS and apps.txt usually do not."
fi

# Default to 9p: zero helper daemon, works reliably in WSL + stock QEMU + Debian.
# Opt into virtiofs with KOS_DISTRO_USE_VIRTIOFS=1 if virtiofsd works on your host.
FS_KIND="9p"
VPID=""
cleanup_virtiofs() {
  if [[ -n "$VPID" ]]; then
    kill "$VPID" 2>/dev/null || true
    rm -f /tmp/kos-virtiofs.sock
  fi
}

if [[ "${KOS_DISTRO_USE_VIRTIOFS:-0}" == "1" && -d /dev/shm ]]; then
  VIRTIOFSD=""
  for c in virtiofsd /usr/lib/qemu/virtiofsd /usr/libexec/virtiofsd; do
    if command -v "$c" >/dev/null 2>&1 || [[ -x "$c" ]]; then
      VIRTIOFSD="$c"
      break
    fi
  done
  if [[ -n "$VIRTIOFSD" ]]; then
    SOCK="/tmp/kos-virtiofs.sock"
    rm -f "$SOCK"
    "$VIRTIOFSD" --socket-path="$SOCK" --shared-dir="$SHARE" --cache=auto >/tmp/kos-virtiofs.log 2>&1 &
    VPID=$!
    sleep 0.4
    if [[ -S "$SOCK" ]] && kill -0 "$VPID" 2>/dev/null; then
      FS_KIND="virtiofs"
      QEMU_EXTRA+=(
        -chardev "socket,id=kosfs,path=${SOCK}"
        -device vhost-user-fs-pci,queue-size=1024,chardev=kosfs,tag=kosdev
        -object "memory-backend-memfd,id=mem,size=${KOS_QEMU_MEM},share=on"
        -numa node,memdev=mem
      )
      echo "Sharing extension dir via virtiofs (${SHARE})"
    else
      echo "virtiofsd did not start; falling back to 9p" >&2
      cleanup_virtiofs
      VPID=""
      FS_KIND="9p"
    fi
  fi
fi

if [[ "$FS_KIND" == "9p" ]]; then
  echo "Sharing extension dir via 9p (${SHARE})"
  QEMU_EXTRA+=(-virtfs "local,path=${SHARE},mount_tag=kosdev,security_model=none,id=kosdev")
fi

# Headless daemonizes; interactive waits if virtiofsd needs cleanup, else execs QEMU.
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
elif [[ -n "$VPID" ]]; then
  trap cleanup_virtiofs EXIT
  kos_qemu_print
  qemu-system-x86_64 \
    "${KOS_QEMU_ACCEL[@]}" -m "${KOS_QEMU_MEM}" -smp "${KOS_QEMU_SMP}" \
    "${DISPLAY_ARGS[@]}" \
    -drive "file=${IMG},${KOS_QEMU_DRIVE_OPTS}" \
    -nic user,model=virtio-net-pci \
    -usb -device usb-tablet \
    "${QEMU_EXTRA[@]}"
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
