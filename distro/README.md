# kos distro

A Debian 13 (trixie) based desktop image, branded kos. Think of this as a
small custom distribution: Debian's kernel and packages, our name, wallpaper,
and a GNOME desktop that signs in automatically.

## Build

From the kos repo root (needs sudo, a few GB of disk, and a network):

```
./build.sh distro
```

or `./distro/build-image.sh`. The result is `distro/out/kos.qcow2`.
Login details are written to `distro/out/LOGIN.txt` (that file is not committed).

## Boot on this PC (WSL + WSLg)

```
./build.sh distro-run
```

That opens a QEMU window (via WSLg) with KVM. Shut the machine down from the
GNOME menu, or close the window.

The image is BIOS-bootable, so this also works:

```
qemu-system-x86_64 -enable-kvm -m 4G -smp 4 -vga virtio \
  -drive file=distro/out/kos.qcow2,format=qcow2,if=virtio
```
