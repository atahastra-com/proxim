#!/usr/bin/env bash
# Shared QEMU flags for distro-run / distro-dev / headless proofs.
# Source this file; it sets KOS_QEMU_ACCEL, KOS_QEMU_MEM, KOS_QEMU_SMP,
# KOS_QEMU_DRIVE_OPTS, and helper functions. It does not launch QEMU.

kos_qemu_detect() {
  if [[ -e /dev/kvm && -w /dev/kvm ]]; then
    # -cpu host lets the guest use the real AMD-V/SVM CPU instead of qemu64.
    KOS_QEMU_ACCEL=(-enable-kvm -cpu host)
  else
    KOS_QEMU_ACCEL=()
    echo "KVM is not usable; the desktop will be very slow." >&2
  fi

  # Leave RAM for WSL itself. A default WSL VM is ~8G; a 4G guest is already
  # tight. If the user raises .wslconfig memory, we automatically give the
  # guest more.
  local avail_kib
  avail_kib=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  local nproc
  nproc=$(nproc)
  if (( avail_kib >= 9 * 1024 * 1024 )); then
    KOS_QEMU_MEM=6G
    KOS_QEMU_SMP=8
  elif (( avail_kib >= 5 * 1024 * 1024 )); then
    KOS_QEMU_MEM=4G
    KOS_QEMU_SMP=6
  else
    KOS_QEMU_MEM=3G
    KOS_QEMU_SMP=4
  fi
  if (( nproc > 4 )) && (( KOS_QEMU_SMP > nproc - 2 )); then
    KOS_QEMU_SMP=$((nproc - 2))
  fi
  if (( KOS_QEMU_SMP < 2 )); then
    KOS_QEMU_SMP=2
  fi

  # writeback + aio=threads is a big disk-speed win vs the default cache=none
  # writethrough path, without the crash-risk of cache=unsafe.
  KOS_QEMU_DRIVE_OPTS="format=qcow2,if=virtio,cache=writeback,aio=threads,discard=unmap"
}

# Windowed display for WSLg. Do not use virtio-vga-gl / gtk,gl=on here:
# this QEMU build's GL module fails ("OpenGL is not supported by the
# display" / undefined symbol qemu_egl_display), which would refuse to boot.
kos_qemu_window_display() {
  # show-menubar=off so the QEMU Machine/View menu cannot steal keys/clicks.
  KOS_QEMU_DISPLAY=(-device virtio-vga -display gtk,show-menubar=off)
}

kos_qemu_headless_display() {
  # Monitor + QMP + VNC for screendumps. Same GPU device as the windowed path.
  KOS_QEMU_DISPLAY=(
    -device virtio-vga
    -display vnc=127.0.0.1:99
    -monitor unix:/tmp/kos-ui-mon.sock,server,nowait
    -qmp unix:/tmp/kos-ui-qmp.sock,server,nowait
  )
}

kos_qemu_print() {
  echo "QEMU: ${KOS_QEMU_ACCEL[*]} -m ${KOS_QEMU_MEM} -smp ${KOS_QEMU_SMP} drive=${KOS_QEMU_DRIVE_OPTS}"
}
