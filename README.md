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

3. Rebuild userspace and boot into an interactive QEMU shell:

   ```
   ./build.sh dev
   ```

   That rebuilds `kosinit` and `kosd`, packs the rootfs, and attaches QEMU to your terminal.

   After a kernel or BusyBox change, or on a first setup, run `./build.sh all` instead.

4. Leave QEMU with `poweroff` at the kos shell, or press Ctrl-A then X.

`./build.sh` is relative to this directory, so it works from `~/kos` or any other clone. You can also pass several targets in order, for example `./build.sh rust rootfs boot-interactive`.

## Other useful targets

```
./build.sh dev                  # kosinit + rust + rootfs, then an interactive shell
./build.sh rust                 # rebuild kosd (static musl)
./build.sh kosinit              # rebuild PID 1
./build.sh rootfs               # pack initramfs after userspace changes
./build.sh boot-interactive     # boot the interactive image in this terminal
./build.sh test                 # automated QEMU proofs (not an interactive shell)
./build.sh all                  # kernel, busybox, userspace, then test
./build.sh distro               # build the Debian-based kos desktop image
./build.sh distro-run           # boot that image in a QEMU window (KVM)
```
