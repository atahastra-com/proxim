#!/usr/bin/env bash
# Build a Debian 13 (trixie) amd64 disk image, branded kos, with GNOME.
#
# This is a regular "custom distro" script: bootstrap Debian, install a
# desktop, copy our overlays (name, wallpaper, autologin), install GRUB so
# QEMU can boot it with the default PC BIOS.
#
# Usage (from the kos repo, usually via ./build.sh distro):
#   ./distro/build-image.sh
# Output:
#   distro/out/kos.qcow2
#   distro/out/LOGIN.txt
set -euo pipefail

export PATH="/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

KOS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISTRO="${KOS}/distro"
CFG="${DISTRO}/config"
OUT="${DISTRO}/out"
MNT="${DISTRO}/mnt"
RAW="${OUT}/kos.raw"
IMG="${OUT}/kos.qcow2"
LOGIN="${OUT}/LOGIN.txt"
DISK_GIB="${DISK_GIB:-12}"
KOS_USER="${KOS_USER:-pratham}"
# Initial login password. Override with KOS_PASSWORD=... if you want.
KOS_PASSWORD="${KOS_PASSWORD:-kos}"
MIRROR="${MIRROR:-http://deb.debian.org/debian}"

need_cmd() { command -v "$1" >/dev/null || { echo "missing command: $1" >&2; exit 1; }; }

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  need_cmd sudo
  SUDO=(sudo)
  "${SUDO[@]}" -n true
fi

need_cmd debootstrap
need_cmd parted
need_cmd losetup
need_cmd mkfs.ext4
need_cmd qemu-img
need_cmd e2fsck
need_cmd rsync
if command -v magick >/dev/null; then
  IM=(magick)
elif command -v convert >/dev/null; then
  IM=(convert)
else
  echo "missing ImageMagick (magick or convert)" >&2
  exit 1
fi

mkdir -p "$OUT" "$MNT"
LOOP=""
MOUNTED=0

cleanup() {
  if [[ "${MOUNTED}" -eq 1 ]]; then
    "${SUDO[@]}" umount "$MNT/dev/pts" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT/dev" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT/proc" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT/sys" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT" 2>/dev/null || true
    MOUNTED=0
  fi
  if [[ -n "$LOOP" ]]; then
    "${SUDO[@]}" losetup -d "$LOOP" 2>/dev/null || true
    LOOP=""
  fi
}
trap cleanup EXIT

packages_list() {
  # comments and blanks stripped; drop CR (octal 015) without touching newlines
  grep -vE '^[[:space:]]*(#|$)' "${CFG}/packages.txt" | tr -d '\015'
}


generate_art() {
  local wall="${OUT}/kos-wallpaper.png"
  local logo="${OUT}/kos-logo.png"
  local splash="${OUT}/kos-splash-bg.png"
  echo "Generating kos wallpaper and splash art"
  # Desktop wallpaper is a clean dim gradient — no giant logo, so Launchpad-style
  # icons sit on a dark field instead of over a wordmark.
  "${IM[@]}" -size 1920x1080 gradient:'#070b14-#1a2744' \
    \( -size 1920x1080 radial-gradient:'rgba(0,0,0,0)-rgba(0,0,0,0.45)' \) \
    -compose multiply -composite \
    "$wall"
  "${IM[@]}" -size 1280x800 gradient:'#0b1020-#1a2744' "$splash"
  "${IM[@]}" -size 640x240 xc:none \
    -gravity center -fill '#eef2ff' -font DejaVu-Sans-Bold -pointsize 120 -annotate +0+0 'kos' \
    "$logo"
}

partition_and_mount() {
  echo "Creating ${DISK_GIB}GiB raw disk at ${RAW}"
  rm -f "$RAW"
  qemu-img create -f raw "$RAW" "${DISK_GIB}G"
  # One BIOS-bootable partition, starting at 1MiB so GRUB has room in the MBR gap.
  parted -s "$RAW" mklabel msdos
  parted -s "$RAW" mkpart primary ext4 1MiB 100%
  parted -s "$RAW" set 1 boot on

  LOOP="$("${SUDO[@]}" losetup -f --show -P "$RAW")"
  # Wait for the partition node (loop0p1) to appear.
  local part="${LOOP}p1"
  for _ in $(seq 1 20); do
    [[ -b "$part" ]] && break
    sleep 0.1
  done
  [[ -b "$part" ]] || { echo "FAIL: no partition node ${part}" >&2; exit 1; }

  echo "Formatting ${part} as ext4"
  "${SUDO[@]}" mkfs.ext4 -F -L kos "${part}"
  "${SUDO[@]}" mount "$part" "$MNT"
  MOUNTED=1
}

bootstrap() {
  echo "Bootstrapping Debian 13 (trixie) into the image (this takes a while)"
  "${SUDO[@]}" debootstrap --arch=amd64 --variant=minbase trixie "$MNT" "$MIRROR"

  "${SUDO[@]}" mkdir -p "$MNT/etc/apt/sources.list.d"
  "${SUDO[@]}" tee "$MNT/etc/apt/sources.list" >/dev/null << 'SRC'
deb http://deb.debian.org/debian trixie main contrib non-free-firmware
deb http://deb.debian.org/debian trixie-updates main contrib non-free-firmware
deb http://security.debian.org/debian-security trixie-security main contrib non-free-firmware
SRC

  # Bind mounts so apt and grub can work inside the image.
  "${SUDO[@]}" mount --bind /dev "$MNT/dev"
  "${SUDO[@]}" mount --bind /dev/pts "$MNT/dev/pts"
  "${SUDO[@]}" mount -t proc proc "$MNT/proc"
  "${SUDO[@]}" mount -t sysfs sysfs "$MNT/sys"
  "${SUDO[@]}" cp /etc/resolv.conf "$MNT/etc/resolv.conf"

  # Don't start services while we install packages in the chroot.
  "${SUDO[@]}" tee "$MNT/usr/sbin/policy-rc.d" >/dev/null << 'PRC'
#!/bin/sh
exit 101
PRC
  "${SUDO[@]}" chmod +x "$MNT/usr/sbin/policy-rc.d"

  echo "Installing desktop and firmware packages"
  packages_list > "${OUT}/packages.list"
  echo "Packages:" && cat "${OUT}/packages.list"
  "${SUDO[@]}" mkdir -p "$MNT/tmp"
  "${SUDO[@]}" cp "${OUT}/packages.list" "$MNT/tmp/packages.list"
  "${SUDO[@]}" chroot "$MNT" bash -lc '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    export LANG=C.UTF-8
    apt-get update
    xargs -a /tmp/packages.list apt-get install -y --no-install-recommends
    apt-get clean
  '
}

install_overlays() {
  echo "Applying kos branding and desktop defaults"
  "${SUDO[@]}" cp "${CFG}/os-release" "$MNT/etc/os-release"
  "${SUDO[@]}" cp "${CFG}/os-release" "$MNT/usr/lib/os-release"
  "${SUDO[@]}" cp "${CFG}/hostname" "$MNT/etc/hostname"
  "${SUDO[@]}" cp "${CFG}/hosts" "$MNT/etc/hosts"
  "${SUDO[@]}" cp "${CFG}/grub.default" "$MNT/etc/default/grub"
  "${SUDO[@]}" mkdir -p "$MNT/etc/gdm3"
  # Debian reads daemon.conf; Ubuntu-style custom.conf is kept in sync.
  "${SUDO[@]}" cp "${CFG}/gdm-custom.conf" "$MNT/etc/gdm3/daemon.conf"
  "${SUDO[@]}" cp "${CFG}/gdm-custom.conf" "$MNT/etc/gdm3/custom.conf"

  "${SUDO[@]}" mkdir -p "$MNT/etc/dconf/profile" "$MNT/etc/dconf/db/gdm.d"
  "${SUDO[@]}" cp "${CFG}/gdm-dconf-profile" "$MNT/etc/dconf/profile/gdm"
  "${SUDO[@]}" cp "${CFG}/gdm-dconf-kos.ini" "$MNT/etc/dconf/db/gdm.d/00-kos"

  "${SUDO[@]}" mkdir -p "$MNT/usr/share/backgrounds/kos"
  "${SUDO[@]}" cp "${OUT}/kos-wallpaper.png" "$MNT/usr/share/backgrounds/kos/kos-wallpaper.png"
  "${SUDO[@]}" mkdir -p "$MNT/usr/share/pixmaps"
  "${SUDO[@]}" cp "${OUT}/kos-logo.png" "$MNT/usr/share/pixmaps/kos-logo.png"
  "${SUDO[@]}" mkdir -p "$MNT/usr/share/gnome-background-properties"
  "${SUDO[@]}" cp "${CFG}/kos-backgrounds.xml" "$MNT/usr/share/gnome-background-properties/kos.xml"
  "${SUDO[@]}" mkdir -p "$MNT/usr/share/glib-2.0/schemas"
  "${SUDO[@]}" cp "${CFG}/kos.gschema.override" "$MNT/usr/share/glib-2.0/schemas/90-kos.gschema.override"

  "${SUDO[@]}" mkdir -p "$MNT/usr/share/plymouth/themes/kos"
  "${SUDO[@]}" cp "${CFG}/kos.plymouth" "$MNT/usr/share/plymouth/themes/kos/kos.plymouth"
  "${SUDO[@]}" cp "${CFG}/kos.script" "$MNT/usr/share/plymouth/themes/kos/kos.script"
  "${SUDO[@]}" cp "${OUT}/kos-splash-bg.png" "$MNT/usr/share/plymouth/themes/kos/background.png"
  "${SUDO[@]}" cp "${OUT}/kos-logo.png" "$MNT/usr/share/plymouth/themes/kos/logo.png"

  # Extension, dconf defaults, and schema overrides (shared with distro-update).
  "${DISTRO}/sync-overlay.sh" "$MNT"
}

configure_system() {
  local part="${LOOP}p1"
  local uuid
  uuid="$("${SUDO[@]}" blkid -s UUID -o value "$part")"
  echo "Root UUID is ${uuid}"

  "${SUDO[@]}" tee "$MNT/etc/fstab" >/dev/null << FSTAB
# /etc/fstab: static file system information.
UUID=${uuid}  /  ext4  errors=remount-ro  0  1
FSTAB

  # virtio drivers so the image can boot with -drive if=virtio
  "${SUDO[@]}" tee -a "$MNT/etc/initramfs-tools/modules" >/dev/null << 'MOD'
virtio_pci
virtio_blk
virtio_scsi
virtio_net
MOD

  "${SUDO[@]}" chroot "$MNT" bash -lc "
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    export LANG=C.UTF-8

    echo 'en_US.UTF-8 UTF-8' > /etc/locale.gen
    locale-gen
    update-locale LANG=en_US.UTF-8

    ln -sf /usr/share/zoneinfo/Asia/Kolkata /etc/localtime
    echo Asia/Kolkata > /etc/timezone

    if ! id '${KOS_USER}' >/dev/null 2>&1; then
      useradd -m -s /bin/bash '${KOS_USER}'
    fi
    for g in sudo adm cdrom video audio plugdev netdev; do
      getent group "\$g" >/dev/null && usermod -aG "\$g" '${KOS_USER}'
    done
    echo '${KOS_USER}:${KOS_PASSWORD}' | chpasswd
    mkdir -p /home/${KOS_USER}/.config
    # Skip the first-login setup wizard so we land on the desktop.
    echo yes > /home/${KOS_USER}/.config/gnome-initial-setup-done
    mkdir -p /etc/xdg/autostart
    if [[ -f /etc/xdg/autostart/gnome-initial-setup-first-login.desktop ]]; then
      printf '\nHidden=true\n' >> /etc/xdg/autostart/gnome-initial-setup-first-login.desktop
    fi
    chown -R ${KOS_USER}:${KOS_USER} /home/${KOS_USER}

    glib-compile-schemas /usr/share/glib-2.0/schemas
    if command -v dconf >/dev/null; then
      dconf update
    fi
    if command -v plymouth-set-default-theme >/dev/null; then
      plymouth-set-default-theme -R kos || plymouth-set-default-theme -R spinner || true
    fi

    systemctl enable gdm3 || systemctl enable gdm || true
    systemctl enable NetworkManager || true
    systemctl enable kos-tune.service || true
    /usr/libexec/kos-tune || true
    systemctl set-default graphical.target

    update-initramfs -u
    update-grub
    grub-install --target=i386-pc --recheck ${LOOP}
  "

  "${SUDO[@]}" rm -f "$MNT/usr/sbin/policy-rc.d"
  # Don't copy the host resolver into a shipped image as a hard bind.
  "${SUDO[@]}" tee "$MNT/etc/resolv.conf" >/dev/null << 'RES'
nameserver 1.1.1.1
nameserver 8.8.8.8
RES
}

finalize() {
  # Unmount first, fsck the ext4, then detach the loop and convert.
  if [[ "${MOUNTED}" -eq 1 ]]; then
    "${SUDO[@]}" umount "$MNT/dev/pts" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT/dev" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT/proc" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT/sys" 2>/dev/null || true
    "${SUDO[@]}" umount "$MNT" 2>/dev/null || true
    MOUNTED=0
  fi
  sync
  if [[ -n "$LOOP" ]]; then
    local part="${LOOP}p1"
    echo "Running e2fsck on ${part}"
    set +e
    "${SUDO[@]}" e2fsck -fy "$part"
    local ec=$?
    set -e
    if (( ec != 0 && ec != 1 && ec != 2 )); then
      echo "FAIL: e2fsck exited ${ec}" >&2
      exit "$ec"
    fi
    "${SUDO[@]}" losetup -d "$LOOP" 2>/dev/null || true
    LOOP=""
  fi
  trap - EXIT
  echo "Converting to qcow2 at ${IMG}"
  rm -f "$IMG"
  qemu-img convert -p -f raw -O qcow2 "$RAW" "$IMG"
  rm -f "$RAW"
  qemu-img info "$IMG"
  ls -lh "$IMG"
  umask 077
  cat > "$LOGIN" << LOGIN
kos 0.1
username: ${KOS_USER}
password: ${KOS_PASSWORD}
hostname: kos
desktop: GNOME (autologin)
Change the password after the first login (Settings → Users, or passwd).
LOGIN
  chmod 600 "$LOGIN"
  echo "Login details written to ${LOGIN}"
}

main() {
  local start end
  start="$(date +%s)"
  generate_art
  partition_and_mount
  bootstrap
  install_overlays
  configure_system
  finalize
  end="$(date +%s)"
  echo "Image build finished in $((end - start))s"
}

main "$@"
