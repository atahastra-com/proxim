# KOS

A small Linux-based OS: the Linux kernel, a static BusyBox userland, `kosinit` (PID 1, in C), and `kosd` (a Rust heartbeat service). It boots only in QEMU. Do not install it on a real disk.

Work in the WSL Ubuntu copy at `~/kos` (Linux filesystem, not `/mnt/c`).

## Daily loop

1. Open the project in VS Code from Windows:

   ```
   wsl -d Ubuntu-24.04 --cd ~/kos code .
   ```

   Or, from a WSL terminal: `code ~/kos`.

2. Edit `kosinit/*.c` or `services/*` (for example `services/kosd`).

3. Rebuild the rootfs and boot:

   ```
   ./build.sh rootfs boot-interactive
   ```

   After a kernel or BusyBox change, or on a first setup, run `./build.sh all` instead.

4. Leave QEMU with `poweroff` at the kos shell, or press Ctrl-A then X.

`./build.sh` is relative to this directory, so it works from `~/kos` or any other clone.

## Other useful targets

```
./build.sh rust                 # rebuild kosd (static musl)
./build.sh kosinit              # rebuild PID 1
./build.sh rootfs               # pack initramfs after userspace changes
./build.sh boot                 # non-interactive proof boot
./build.sh boot-interactive     # interactive proof boot
```

To get a shell after a successful rootfs build:

```
qemu-system-x86_64 -kernel linux/arch/x86/boot/bzImage \
  -initrd initramfs-interactive.cpio.gz \
  -append 'console=ttyS0' -nographic -m 256M -no-reboot
```
