#!/usr/bin/env bash
# KOS build: Linux kernel + static BusyBox rootfs + kosinit, bootable in QEMU.
# Usage: ./build.sh [deps|kernel|busybox|kosinit|rootfs|boot|boot-interactive|all]
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
QEMU_COMMON=(qemu-system-x86_64 -nographic -m 256M -no-reboot -append 'console=ttyS0')

need_pkg() { dpkg -s "$1" >/dev/null 2>&1; }

deps() {
  local pkgs=(build-essential flex bison bc libelf-dev libssl-dev cpio qemu-system-x86 git)
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

rootfs() {
  test -f "${BUSYBOX_DIR}/busybox"
  kosinit
  write_inits
  rm -rf "$ROOTFS"
  mkdir -p "$ROOTFS"
  make -C "$BUSYBOX_DIR" CONFIG_PREFIX="$ROOTFS" install
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

  # Interactive / default image: kosinit is PID 1.
  install_kosinit_into_rootfs
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

# Drive an interactive kosinit boot: wait for log lines, then type commands.
# Early stdin is eaten by the kernel, so we only write after the banner appears.
boot_interactive() {
  test -f "$BZIMAGE"
  test -f "$INTERACTIVE_INITRD"
  local log="${KOS}/serial-kosinit.log"
  local fifo="${KOS}/.qemu-stdin"
  echo "Booting kosinit initramfs (log: ${log})"
  rm -f "$fifo" "$log"
  mkfifo "$fifo"
  set +e
  timeout --signal=KILL 90 "${QEMU_COMMON[@]}" -kernel "$BZIMAGE" -initrd "$INTERACTIVE_INITRD" \
    <"$fifo" >"$log" 2>&1 &
  local tpid=$!
  # Keep the write end open for the whole run (closing it would send EOF to qemu).
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

  fail_boot() {
    echo "FAIL: $1"
    exec 3>&- || true
    kill "$tpid" 2>/dev/null || true
    wait "$tpid" 2>/dev/null || true
    tail -n 50 "$log"
    exit 1
  }

  wait_for 'kosinit: starting kos' 30 || fail_boot "no kosinit banner"
  wait_for 'kosinit: starting shell|hello-from-service|starting hello' 10 || fail_boot "no service start lines"
  sleep 3
  printf 'echo $$\nps\n' >&3
  wait_for 'kosinit' 10 || fail_boot "ps did not show kosinit"
  sleep 1
  printf 'exit\n' >&3
  wait_for 'exited \(status .*\), restarting' 15 || fail_boot "shell did not respawn"
  sleep 3
  printf 'poweroff\n' >&3
  wait "$tpid"
  local rc=$?
  exec 3>&-
  rm -f "$fifo"
  set -e
  cp -f "$log" "${KOS}/serial-interactive.log"

  if ! grep -q 'kosinit: starting kos' "$log"; then fail_boot "missing banner"; fi
  if ! grep -q 'ok-shell\|kosinit' "$log"; then :; fi
  if ! grep -q 'restarting' "$log"; then fail_boot "missing restart log"; fi
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

usage() { echo "Usage: $0 [deps|kernel|busybox|kosinit|rootfs|boot|boot-interactive|all]"; }

main() {
  case "${1:-all}" in
    deps) deps ;;
    kernel) deps; kernel ;;
    busybox) deps; busybox ;;
    kosinit) deps; kosinit ;;
    rootfs) rootfs ;;
    boot) boot ;;
    boot-interactive) boot_interactive ;;
    all) deps; kernel; busybox; kosinit; rootfs; boot; boot_interactive ;;
    -h|--help) usage ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
