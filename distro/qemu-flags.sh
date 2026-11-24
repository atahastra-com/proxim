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

  # Leave plenty of RAM/CPU for WSL + IDE. On an ~8G WSL host, a 4G/6-vCPU
  # guest pushes the host into swap; cap at 2560M / 4 vCPUs unless the host
  # has >10G available or the caller overrides KOS_QEMU_MEM / KOS_QEMU_SMP.
  local avail_kib total_kib
  avail_kib=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  total_kib=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
  local nproc
  nproc=$(nproc)
  local mem_auto smp_auto
  if (( total_kib >= 12 * 1024 * 1024 && avail_kib >= 9 * 1024 * 1024 )); then
    mem_auto=4G
    smp_auto=6
  elif (( total_kib >= 9 * 1024 * 1024 && avail_kib >= 5 * 1024 * 1024 )); then
    mem_auto=3G
    smp_auto=4
  else
    mem_auto=2560M
    smp_auto=3
  fi
  KOS_QEMU_MEM="${KOS_QEMU_MEM:-$mem_auto}"
  KOS_QEMU_SMP="${KOS_QEMU_SMP:-$smp_auto}"
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
