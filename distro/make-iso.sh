#!/usr/bin/env bash
# Build a hybrid UEFI + BIOS bootable Live ISO from distro/out/kos.qcow2
# so Proxim OS can be flashed to a USB stick and tested on real laptops.
#
# Output:
#   distro/out/proxim-os-live-amd64.iso
set -euo pipefail
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

KOS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISTRO="${KOS}/distro"
OUT="${DISTRO}/out"
IMG="${OUT}/kos.qcow2"
MNT="${DISTRO}/mnt"
STAGE="${OUT}/.iso-stage"
ISO="${OUT}/proxim-os-live-amd64.iso"

if [[ ! -f "$IMG" ]]; then
  echo "No image at ${IMG}. Build it first with: ./build.sh distro" >&2
  exit 1
fi

if pgrep -af 'qemu-system-x86_64' | grep -q 'kos.qcow2'; then
  echo "QEMU is using ${IMG}. Shut it down first." >&2
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
need_cmd e2fsck
need_cmd mksquashfs
need_cmd grub-mkrescue
need_cmd xorriso
need_cmd mformat

mkdir -p "$MNT" "$OUT"
NBD=/dev/nbd0
MOUNTED=0
CONNECTED=0

cleanup() {
  if [[ "$MOUNTED" -eq 1 ]]; then
    "${SUDO[@]}" umount "$MNT/etc/resolv.conf" 2>/dev/null || true
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

echo "Connecting ${IMG} via qemu-nbd"
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

if command -v findmnt >/dev/null; then
  while read -r mp; do
    [[ -n "$mp" ]] || continue
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

# Ensure live-boot is installed in the image + initramfs so USB/ISO boots cleanly.
"${SUDO[@]}" mount --bind /dev "$MNT/dev"
"${SUDO[@]}" mount --bind /dev/pts "$MNT/dev/pts"
"${SUDO[@]}" mount -t proc proc "$MNT/proc"
"${SUDO[@]}" mount -t sysfs sysfs "$MNT/sys"
if [[ -e /etc/resolv.conf ]]; then
  "${SUDO[@]}" touch "$MNT/etc/resolv.conf"
  "${SUDO[@]}" mount --bind /etc/resolv.conf "$MNT/etc/resolv.conf"
fi

"${SUDO[@]}" chroot "$MNT" bash -lc '
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  if ! dpkg -s live-boot >/dev/null 2>&1; then
    echo "Installing live-boot for USB/ISO live boot..."
    apt-get update
    apt-get install -y --no-install-recommends live-boot live-boot-initramfs-tools
    apt-get clean
  fi
'

"${SUDO[@]}" umount "$MNT/etc/resolv.conf" 2>/dev/null || true
"${SUDO[@]}" umount "$MNT/dev/pts"
"${SUDO[@]}" umount "$MNT/dev"
"${SUDO[@]}" umount "$MNT/proc"
"${SUDO[@]}" umount "$MNT/sys"

# Pick latest kernel and matching initrd from the image.
KVER="$(ls -1 "${MNT}/lib/modules" | sort -V | tail -n 1)"
VMLINUZ="${MNT}/boot/vmlinuz-${KVER}"
INITRD="${MNT}/boot/initrd.img-${KVER}"
[[ -f "$VMLINUZ" ]] || VMLINUZ="$(ls -1 "${MNT}"/boot/vmlinuz-* | sort -V | tail -n 1)"
[[ -f "$INITRD" ]] || INITRD="$(ls -1 "${MNT}"/boot/initrd.img-* | sort -V | tail -n 1)"
echo "Using kernel: $(basename "$VMLINUZ"), initrd: $(basename "$INITRD")"

"${SUDO[@]}" rm -rf "$STAGE"
mkdir -p "${STAGE}/live" "${STAGE}/boot/grub"
"${SUDO[@]}" cp "$VMLINUZ" "${STAGE}/live/vmlinuz"
"${SUDO[@]}" cp "$INITRD" "${STAGE}/live/initrd.img"
"${SUDO[@]}" chown "$(id -u):$(id -g)" "${STAGE}/live/vmlinuz" "${STAGE}/live/initrd.img"

echo "Building live/filesystem.squashfs (zstd)..."
"${SUDO[@]}" mksquashfs "$MNT" "${STAGE}/live/filesystem.squashfs" \
  -comp zstd -Xcompression-level 6 -b 1048576 -noappend \
  -wildcards \
  -e "proc/*" "sys/*" "dev/*" "run/*" "tmp/*" "mnt/*" "media/*" \
  -e "boot/initrd.img*" "boot/vmlinuz*" \
  -e "var/cache/apt/archives/*.deb" "var/log/journal/*" "var/tmp/*"

"${SUDO[@]}" umount "$MNT"
MOUNTED=0
"${SUDO[@]}" qemu-nbd --disconnect "$NBD"
CONNECTED=0
trap - EXIT

cat > "${STAGE}/boot/grub/grub.cfg" << 'GRUB'
set default=0
set timeout=3

menuentry "Proxim OS (Live)" {
    linux /live/vmlinuz boot=live quiet splash loglevel=3 plymouth.ignore-serial-consoles
    initrd /live/initrd.img
}

menuentry "Proxim OS (Safe Graphics)" {
    linux /live/vmlinuz boot=live nomodeset quiet splash loglevel=3
    initrd /live/initrd.img
}
GRUB

echo "Creating hybrid UEFI + BIOS ISO at ${ISO}..."
rm -f "$ISO"
grub-mkrescue -o "$ISO" "$STAGE" -- -volid "PROXIM_OS"
rm -rf "$STAGE"

ls -lh "$ISO"
echo "Done! Flash ${ISO} to USB or test in QEMU."
