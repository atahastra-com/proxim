#!/usr/bin/env bash
# KOS build: Linux kernel + static BusyBox rootfs + kosinit + kosd, bootable in QEMU.
# Usage: ./build.sh [targets...]
#   deps|kernel|busybox|kosinit|rust|rootfs|boot|boot-interactive|test|dev|distro|distro-run|distro-update|distro-dev|all
# Multiple targets run in order, e.g. ./build.sh rust rootfs boot-interactive
set -euo pipefail

KOS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$KOS"

KERNEL_TAG="${KERNEL_TAG:-v7.3.5}"
KERNEL_DIR="${KOS}/linux"
KERNEL_GIT="${KERNEL_GIT:-https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git}"
KERNEL_GIT_FALLBACK="${KERNEL_GIT_FALLBACK:-https://github.com/gregkh/linux.git}"
BUSYBOX_VERSION="${BUSYBOX_VERSION:-1.36.1}"
BUSYBOX_DIR="${KOS}/busybox-${BUSYBOX_VERSION}"
BUSYBOX_URL="${BUSYBOX_URL:-https://busybox.net/downloads/busybox-${BUSYBOX_VERSION}.tar.bz2}"
ROOTFS="${KOS}/rootfs"
BZIMAGE="${KERNEL_DIR}/arch/x86/boot/bzImage"
PROOF_INITRD="${KOS}/initramfs-proof.cpio.gz"
INTERACTIVE_INITRD="${KOS}/initramfs-interactive.cpio.gz"
KOSINIT_SRC="${KOS}/kosinit/kosinit.c"
KOSINIT_BIN="${KOS}/kosinit/kosinit"
KOSINIT_SERVICES="${KOS}/kosinit/services"
KOSD_DIR="${KOS}/services/kosd"
KOSD_BIN="${KOSD_DIR}/target/x86_64-unknown-linux-musl/release/kosd"
BUSYBOX_STAMP="${KOS}/.busybox-rootfs-stamp"
QEMU_COMMON=(qemu-system-x86_64 -nographic -m 256M -no-reboot -append 'console=ttyS0')

need_pkg() { dpkg -s "$1" >/dev/null 2>&1; }

deps() {
  local pkgs=(build-essential flex bison bc libelf-dev libssl-dev cpio qemu-system-x86 git musl-tools file)
  local missing=() p
  for p in "${pkgs[@]}"; do
    need_pkg "$p" || missing+=("$p")
  done
  if ((${#missing[@]})); then
    echo "Installing: ${missing[*]}"
    sudo apt-get update
    sudo apt-get install -y "${missing[@]}"
  fi
}

kernel() {
  if [[ ! -d "$KERNEL_DIR/.git" ]]; then
    echo "Cloning ${KERNEL_GIT} (${KERNEL_TAG})"
    if ! git clone --depth 1 --branch "$KERNEL_TAG" "$KERNEL_GIT" "$KERNEL_DIR"; then
      echo "kernel.org failed, falling back to ${KERNEL_GIT_FALLBACK}"
      rm -rf "$KERNEL_DIR"
      git clone --depth 1 --branch "$KERNEL_TAG" "$KERNEL_GIT_FALLBACK" "$KERNEL_DIR"
    fi
  fi
  git -C "$KERNEL_DIR" checkout -B kos "$KERNEL_TAG"
  if [[ ! -f "$KERNEL_DIR/.config" ]]; then
    make -C "$KERNEL_DIR" x86_64_defconfig
  fi
  make -C "$KERNEL_DIR" olddefconfig
  echo "Building bzImage (log: ${KOS}/kernel-build.log)"
  local start end
  start=$(date +%s)
  make -C "$KERNEL_DIR" -j"$(nproc)" bzImage >"${KOS}/kernel-build.log" 2>&1
  end=$(date +%s)
  echo "Kernel build finished in $((end - start))s"
  ls -l "$BZIMAGE"
}

busybox() {
  if [[ ! -d "$BUSYBOX_DIR" ]]; then
    local tb="busybox-${BUSYBOX_VERSION}.tar.bz2"
    [[ -f "$tb" ]] || curl -fL --retry 3 -o "$tb" "$BUSYBOX_URL"
    tar -xf "$tb"
  fi
  make -C "$BUSYBOX_DIR" defconfig
  # Static build. CONFIG_TC often breaks against glibc; leave it off.
  if grep -q '^CONFIG_STATIC=' "${BUSYBOX_DIR}/.config"; then
    sed -i 's/^CONFIG_STATIC=.*/CONFIG_STATIC=y/' "${BUSYBOX_DIR}/.config"
  else
    echo 'CONFIG_STATIC=y' >> "${BUSYBOX_DIR}/.config"
  fi
  sed -i 's/^# CONFIG_STATIC is not set$/CONFIG_STATIC=y/' "${BUSYBOX_DIR}/.config"
  sed -i 's/^CONFIG_TC=y$/# CONFIG_TC is not set/' "${BUSYBOX_DIR}/.config"
  make -C "$BUSYBOX_DIR" oldconfig </dev/null
  echo "Building BusyBox (log: ${KOS}/busybox-build.log)"
  local start end
  start=$(date +%s)
  make -C "$BUSYBOX_DIR" -j"$(nproc)" >"${KOS}/busybox-build.log" 2>&1
  end=$(date +%s)
  echo "BusyBox build finished in $((end - start))s"
}

kosinit() {
  test -f "$KOSINIT_SRC"
  test -f "$KOSINIT_SERVICES"
  echo "Building kosinit (static)"
  gcc -static -O2 -Wall -Wextra -o "$KOSINIT_BIN" "$KOSINIT_SRC"
  ls -l "$KOSINIT_BIN"
}

rust() {
  if [[ -f "${HOME}/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    . "${HOME}/.cargo/env"
  fi
  if ! command -v rustc >/dev/null || ! command -v cargo >/dev/null; then
    echo "rust: rustup/cargo not found. Install with:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal"
    echo "  rustup target add x86_64-unknown-linux-musl"
    exit 1
  fi
  test -f "${KOSD_DIR}/Cargo.toml"
  echo "Building kosd (static musl, rustc $(rustc --version))"
  cargo build --release --target x86_64-unknown-linux-musl --manifest-path "${KOSD_DIR}/Cargo.toml"
  strip "$KOSD_BIN"
  file "$KOSD_BIN"
  ls -l "$KOSD_BIN"
}

write_inits() {
  cat > "${KOS}/init.proof.sh" << 'EOF'
#!/bin/sh
# KOS proof init (milestone 2): mount, banner, a few commands, poweroff -f.
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
echo "welcome to kos"
uname -a
ls /
cat /proc/version
poweroff -f
EOF
}

install_kosinit_into_rootfs() {
  test -f "$KOSINIT_BIN"
  cp "$KOSINIT_BIN" "${ROOTFS}/sbin/kosinit"
  cp "$KOSINIT_BIN" "${ROOTFS}/init"
  chmod 755 "${ROOTFS}/sbin/kosinit" "${ROOTFS}/init"
  mkdir -p "${ROOTFS}/etc/kos" "${ROOTFS}/run"
  cp "$KOSINIT_SERVICES" "${ROOTFS}/etc/kos/services"
}

busybox_rootfs_current() {
  [[ -x "${ROOTFS}/bin/busybox" && -x "${BUSYBOX_DIR}/busybox" && -f "$BUSYBOX_STAMP" ]] || return 1
  cmp -s "${BUSYBOX_DIR}/busybox" "${ROOTFS}/bin/busybox" || return 1
  [[ ! "${BUSYBOX_DIR}/busybox" -nt "$BUSYBOX_STAMP" ]]
}

install_busybox_rootfs() {
  if busybox_rootfs_current; then
    echo "BusyBox already installed in rootfs, skipping reinstall"
    return 0
  fi
  echo "Installing BusyBox into rootfs (log: ${KOS}/busybox-install.log)"
  rm -rf "$ROOTFS"
  mkdir -p "$ROOTFS"
  make -C "$BUSYBOX_DIR" CONFIG_PREFIX="$ROOTFS" install >"${KOS}/busybox-install.log" 2>&1
  touch "$BUSYBOX_STAMP"
  echo "BusyBox installed into ${ROOTFS}"
}

rootfs() {
  test -f "${BUSYBOX_DIR}/busybox"
  kosinit
  rust
  write_inits
  install_busybox_rootfs
  mkdir -p "$ROOTFS"/{proc,sys,dev,etc,tmp,root,run}
  chmod 1777 "$ROOTFS/tmp"
  cat > "$ROOTFS/etc/profile" << 'EOF'
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
export PS1='kos# '
EOF
  echo kos > "$ROOTFS/etc/hostname"

  # Milestone-2 script initramfs (automated proof, no kosinit).
  cp "${KOS}/init.proof.sh" "$ROOTFS/init"
  chmod 755 "$ROOTFS/init"
  (cd "$ROOTFS" && find . | cpio -o -H newc) | gzip -9 > "$PROOF_INITRD"

  # Interactive / default image: kosinit is PID 1, kosd is a respawn service.
  install_kosinit_into_rootfs
  mkdir -p "${ROOTFS}/usr/bin"
  cp "$KOSD_BIN" "${ROOTFS}/usr/bin/kosd"
  chmod 755 "${ROOTFS}/usr/bin/kosd"
  (cd "$ROOTFS" && find . | cpio -o -H newc) | gzip -9 > "$INTERACTIVE_INITRD"

  ls -l "$PROOF_INITRD" "$INTERACTIVE_INITRD"
}

boot() {
  test -f "$BZIMAGE"
  test -f "$PROOF_INITRD"
  echo "Booting proof initramfs (log: ${KOS}/serial-proof.log)"
  set +e
  timeout --signal=KILL 60 "${QEMU_COMMON[@]}" -kernel "$BZIMAGE" -initrd "$PROOF_INITRD" \
    >"${KOS}/serial-proof.log" 2>&1
  local rc=$?
  set -e
  if ! grep -q 'welcome to kos' "${KOS}/serial-proof.log"; then
    echo "FAIL: did not find 'welcome to kos' (qemu rc=${rc})"
    tail -n 40 "${KOS}/serial-proof.log"
    exit 1
  fi
  echo "SUCCESS (qemu rc=${rc})"
}

# Automated kosinit+kosd proof. Early stdin is eaten by the kernel, so
# commands are typed only after the banner appears.
boot_test_interactive() {
  test -f "$BZIMAGE"
  test -f "$INTERACTIVE_INITRD"
  local log="${KOS}/serial-kosinit.log"
  local fifo="${KOS}/.qemu-stdin"
  echo "Testing kosinit+kosd initramfs (log: ${log})"
  rm -f "$fifo" "$log"
  mkfifo "$fifo"
  set +e
  timeout --signal=KILL 120 "${QEMU_COMMON[@]}" -kernel "$BZIMAGE" -initrd "$INTERACTIVE_INITRD" \
    <"$fifo" >"$log" 2>&1 &
  local tpid=$!
  exec 3>"$fifo"

  wait_for() {
    local pat="$1" secs="$2" i
    for i in $(seq 1 $((secs * 10))); do
      if grep -q -E "$pat" "$log" 2>/dev/null; then
        return 0
      fi
      if ! kill -0 "$tpid" 2>/dev/null; then
        return 1
      fi
      sleep 0.1
    done
    return 1
  }

  wait_count() {
    local pat="$1" want="$2" secs="$3" i n
    for i in $(seq 1 $((secs * 10))); do
      n=$(grep -c -E "$pat" "$log" 2>/dev/null || true)
      if [[ "${n:-0}" -ge "$want" ]]; then
        return 0
      fi
      if ! kill -0 "$tpid" 2>/dev/null; then
        return 1
      fi
      sleep 0.1
    done
    return 1
  }

  fail_boot() {
    echo "FAIL: $1"
    exec 3>&- || true
    kill "$tpid" 2>/dev/null || true
    wait "$tpid" 2>/dev/null || true
    tail -n 80 "$log"
    exit 1
  }

  wait_for 'kosinit: starting kos' 30 || fail_boot "no kosinit banner"
  wait_for 'kosinit: starting kosd' 10 || fail_boot "kosd was not started"
  wait_for 'kosd: hello from rust \(pid ' 10 || fail_boot "no kosd hello"
  wait_for 'kosd: status ' 10 || fail_boot "no kosd status"
  wait_count 'kosd: heartbeat uptime=' 2 40 || fail_boot "did not see 2 kosd heartbeats"
  sleep 1
  printf 'ps\n' >&3
  wait_for '/usr/bin/kosd' 10 || fail_boot "ps did not show kosd"

  local kpid
  kpid=$(sed -n 's/.*kosd: hello from rust (pid \([0-9][0-9]*\)).*/\1/p' "$log" | tr -d '\r' | head -1)
  if [[ -z "$kpid" ]]; then
    kpid=$(awk '/\/usr\/bin\/kosd$/ { print $1; exit }' "$log" | tr -d '\r')
  fi
  if [[ -z "$kpid" ]]; then
    fail_boot "could not parse kosd pid"
  fi
  echo "Killing kosd pid ${kpid}"
  printf 'kill %s\n' "$kpid" >&3
  wait_for 'kosinit: kosd exited \(status .*\), restarting' 15 || fail_boot "kosd did not respawn"
  wait_count 'kosd: hello from rust \(pid ' 2 15 || fail_boot "kosd did not print hello after restart"
  sleep 1
  printf 'poweroff\n' >&3
  wait "$tpid"
  local rc=$?
  exec 3>&-
  rm -f "$fifo"
  set -e
  cp -f "$log" "${KOS}/serial-interactive.log"

  if ! grep -q 'reboot: Power down' "$log"; then
    echo "FAIL: did not power down cleanly (qemu rc=${rc})"
    tail -n 40 "$log"
    exit 1
  fi
  if [[ "$rc" -ne 0 ]]; then
    echo "FAIL: qemu rc=${rc} (expected 0)"
    tail -n 40 "$log"
    exit 1
  fi
  echo "SUCCESS (qemu rc=${rc})"
}

run_tests() {
  boot
  boot_test_interactive
}

# Real interactive boot: qemu is attached to this terminal.
# Exit with `poweroff` at the kos shell, or Ctrl-A then X.
boot_interactive() {
  test -f "$BZIMAGE"
  test -f "$INTERACTIVE_INITRD"
  echo "Booting KOS (exit with poweroff, or Ctrl-A then X)"
  exec qemu-system-x86_64 -nographic -m 256M -no-reboot \
    -append 'console=ttyS0' \
    -kernel "$BZIMAGE" -initrd "$INTERACTIVE_INITRD"
}

# Build the Debian-based kos desktop image (see distro/README.md).
distro_image() {
  "${KOS}/distro/build-image.sh"
}

# Sync distro/overlay into the existing qcow2 (seconds, not a full rebuild).
distro_update() {
  "${KOS}/distro/update-image.sh"
}

# Boot the desktop with the extension dir shared from the host (hot reload).
distro_dev() {
  "${KOS}/distro/run-dev.sh"
}

# Open the kos desktop in a QEMU window (KVM + WSLg on Windows).
distro_run() {
  local img="${KOS}/distro/out/kos.qcow2"
  if [[ ! -f "$img" ]]; then
    echo "No image at ${img}. Build it first with: ./build.sh distro" >&2
    exit 1
  fi
  if [[ ! -e /dev/kvm ]]; then
    echo "KVM is not available (/dev/kvm missing). The window would be very slow." >&2
    exit 1
  fi
  if [[ ! -w /dev/kvm ]]; then
    echo "This user cannot write /dev/kvm. Add yourself to the kvm group and start a new shell:" >&2
    echo "  sudo usermod -aG kvm \$USER" >&2
    exit 1
  fi
  # shellcheck source=distro/qemu-flags.sh
  source "${KOS}/distro/qemu-flags.sh"
  kos_qemu_detect
  kos_qemu_window_display
  kos_qemu_print
  echo "Booting kos desktop (shut down from the GNOME menu, or close the window)"
  exec qemu-system-x86_64 \
    "${KOS_QEMU_ACCEL[@]}" -m "${KOS_QEMU_MEM}" -smp "${KOS_QEMU_SMP}" \
    "${KOS_QEMU_DISPLAY[@]}" \
    -drive "file=${img},${KOS_QEMU_DRIVE_OPTS}" \
    -nic user,model=virtio-net-pci \
    -usb -device usb-tablet
}

usage() {
  echo "Usage: $0 [deps|kernel|busybox|kosinit|rust|rootfs|boot|boot-interactive|test|dev|distro|distro-run|distro-update|distro-dev|all]..."
}

run_target() {
  case "$1" in
    deps) deps ;;
    kernel) deps; kernel ;;
    busybox) deps; busybox ;;
    kosinit) deps; kosinit ;;
    rust) rust ;;
    rootfs) rootfs ;;
    boot) boot ;;
    boot-interactive) boot_interactive ;;
    test) run_tests ;;
    dev) kosinit; rust; rootfs; boot_interactive ;;
    distro) distro_image ;;
    distro-run) distro_run ;;
    distro-update) distro_update ;;
    distro-dev) distro_dev ;;
    all) deps; kernel; busybox; kosinit; rust; rootfs; run_tests ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
}

main() {
  if (($# == 0)); then
    set -- all
  fi
  local t
  for t in "$@"; do
    run_target "$t"
  done
}

main "$@"
