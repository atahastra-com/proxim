#!/usr/bin/env bash
# Build a clean, hybrid UEFI + BIOS bootable Live & Installer ISO from
# distro/out/kos.qcow2 so Proxim OS can be flashed to USB and tested or
# installed on real laptops.
#
# Uses a temporary overlayfs on top of the mounted qcow2 so:
#   - dev user files (/home/pratham) are completely excluded from the ISO
#   - a clean live user ("proxim") + Installer + First-Boot Setup are enabled
#   - distro/out/kos.qcow2 remains untouched for dev VM usage
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
ISO_WORK="${OUT}/.iso-work"
UPPER="${ISO_WORK}/upper"
WORK="${ISO_WORK}/work"
MERGED="${ISO_WORK}/merged"
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
MERGED_MOUNTED=0
CONNECTED=0

cleanup() {
  if [[ "$MERGED_MOUNTED" -eq 1 ]]; then
    "${SUDO[@]}" umount "$MERGED/dev/pts" 2>/dev/null || true
    "${SUDO[@]}" umount "$MERGED/dev" 2>/dev/null || true
    "${SUDO[@]}" umount "$MERGED/proc" 2>/dev/null || true
    "${SUDO[@]}" umount "$MERGED/sys" 2>/dev/null || true
    "${SUDO[@]}" umount "$MERGED" 2>/dev/null || true
    MERGED_MOUNTED=0
  fi
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
  "${SUDO[@]}" rm -rf "$ISO_WORK" 2>/dev/null || true
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

# Sync latest overlay changes so kos.qcow2 has our latest installer + icons.js.
"${DISTRO}/sync-overlay.sh" "$MNT"

# Ensure live-boot + installer tools (parted, dosfstools, squashfs-tools, grub-efi) are installed.
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
  need=(live-boot live-boot-initramfs-tools parted dosfstools squashfs-tools grub-efi-amd64-bin efibootmgr)
  miss=()
  for p in "${need[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || miss+=("$p")
  done
  if ((${#miss[@]} > 0)); then
    echo "Installing live/installer packages: ${miss[*]}"
    apt-get update
    apt-get install -y --no-install-recommends "${miss[@]}"
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

"${SUDO[@]}" rm -rf "$STAGE" "$ISO_WORK"
mkdir -p "${STAGE}/live" "${STAGE}/boot/grub"
"${SUDO[@]}" mkdir -p "$UPPER" "$WORK" "$MERGED"
"${SUDO[@]}" cp "$VMLINUZ" "${STAGE}/live/vmlinuz"
"${SUDO[@]}" cp "$INITRD" "${STAGE}/live/initrd.img"
"${SUDO[@]}" chown "$(id -u):$(id -g)" "${STAGE}/live/vmlinuz" "${STAGE}/live/initrd.img"

# Prepare a clean OOBE / Live rootfs via overlayfs (leaves kos.qcow2 untouched).
echo "Preparing clean Live/Installer rootfs (removing dev user data)..."
"${SUDO[@]}" mount -t overlay overlay -o "lowerdir=${MNT},upperdir=${UPPER},workdir=${WORK}" "$MERGED"
MERGED_MOUNTED=1

"${SUDO[@]}" mount --bind /dev "$MERGED/dev"
"${SUDO[@]}" mount --bind /dev/pts "$MERGED/dev/pts"
"${SUDO[@]}" mount -t proc proc "$MERGED/proc"
"${SUDO[@]}" mount -t sysfs sysfs "$MERGED/sys"

"${SUDO[@]}" chroot "$MERGED" bash -lc '
  set -euo pipefail
  # Remove dev user "pratham" and any dev files/folders from the live ISO.
  if id pratham >/dev/null 2>&1; then
    userdel -f -r pratham >/dev/null 2>&1 || true
  fi
  rm -rf /home/pratham

  # Create clean temporary live/OOBE user "proxim" from /etc/skel.
  if ! id proxim >/dev/null 2>&1; then
    useradd -m -s /bin/bash -G sudo,adm,audio,video,netdev,plugdev -c "Proxim OS" proxim
  fi
  echo "proxim:proxim" | chpasswd
  echo "proxim ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/proxim-live
  chmod 440 /etc/sudoers.d/proxim-live

  mkdir -p /home/proxim/.config/gtk-3.0
  for folder in Desktop Documents Downloads Music Pictures Public Templates Videos; do
    mkdir -p "/home/proxim/${folder}"
    printf "file:///home/proxim/%s\n" "$folder" >> /home/proxim/.config/gtk-3.0/bookmarks
  done
  chown -R proxim:proxim /home/proxim

  # Point GDM autologin to the temporary "proxim" live/OOBE user.
  for conf in /etc/gdm3/daemon.conf /etc/gdm3/custom.conf; do
    if [[ -f "$conf" ]]; then
      sed -i "s/^AutomaticLogin=.*/AutomaticLogin=proxim/; s/^TimedLogin=.*/TimedLogin=proxim/" "$conf"
    fi
  done

  # Mark as Live ISO + Setup Pending so Welcome/Installer launches on boot.
  mkdir -p /var/lib/kos
  rm -f /var/lib/kos/setup-done
  touch /var/lib/kos/live-iso /var/lib/kos/setup-pending

  # Add "Install Proxim OS" launcher on the Live desktop/launchpad.
  cat > /usr/share/applications/org.proxim.Installer.desktop << "DESK"
[Desktop Entry]
Type=Application
Name=Install Proxim OS
Comment=Install Proxim OS onto your computer
Exec=/usr/bin/proxim-setup --install
Icon=proxim-logo
Terminal=false
StartupNotify=true
Categories=System;
DESK
'

"${SUDO[@]}" umount "$MERGED/dev/pts"
"${SUDO[@]}" umount "$MERGED/dev"
"${SUDO[@]}" umount "$MERGED/proc"
"${SUDO[@]}" umount "$MERGED/sys"

echo "Building live/filesystem.squashfs (zstd)..."
"${SUDO[@]}" mksquashfs "$MERGED" "${STAGE}/live/filesystem.squashfs" \
  -comp zstd -Xcompression-level 6 -b 1048576 -noappend \
  -wildcards \
  -e "proc/*" "sys/*" "dev/*" "run/*" "tmp/*" "mnt/*" "media/*" \
  -e "boot/initrd.img*" "boot/vmlinuz*" \
  -e "var/cache/apt/archives/*.deb" "var/log/journal/*" "var/tmp/*"

"${SUDO[@]}" umount "$MERGED"
MERGED_MOUNTED=0
"${SUDO[@]}" rm -rf "$ISO_WORK"

"${SUDO[@]}" umount "$MNT"
MOUNTED=0
"${SUDO[@]}" qemu-nbd --disconnect "$NBD"
CONNECTED=0
trap - EXIT

cat > "${STAGE}/boot/grub/grub.cfg" << 'GRUB'
set default=0
set timeout=3

menuentry "Proxim OS (Live & Install)" {
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
