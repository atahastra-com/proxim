# kos distro

A Debian 13 (trixie) based desktop image, branded kos. Debian 13 ships
GNOME 48 (this image uses gnome-shell / mutter 48.7). The kos look is a
GNOME Shell extension, `kos-shell@kos`, not a fork of GNOME itself.

The desktop is a macOS Launchpad-style home screen on a full-width bottom
bar: 7 columns of large app icons with labels (no dark tiles), a dimmed
wallpaper without a wordmark, and page dots if the apps overflow one
screen. The bar keeps date and time on the left, dock app icons sitting
directly on the bar (no extra pill), and GNOME's stock system status
cluster (network/volume/power) on the right. Clicking an icon opens the app in a normal window.

## Build and boot

From the kos repo root (needs sudo, a few GB of disk, and a network):

```
./build.sh distro
```

or `./distro/build-image.sh`. The result is `distro/out/kos.qcow2`.
Login details are written to `distro/out/LOGIN.txt` (that file is not committed).

```
./build.sh distro-run
```

opens a QEMU window (via WSLg) with KVM. Shut the machine down from the
power menu, or close the window.

## Fast UI iteration

Do not rebuild the whole image to change the look. Edit the extension and
sync it into the existing disk:

```
./build.sh distro-update
```

That mounts `distro/out/kos.qcow2` (so QEMU must not be running), copies
`distro/overlay/`, refreshes dconf/schemas, and unmounts. The copy itself
is seconds; a full run is typically 1–3 minutes. Then `./build.sh distro-run`
again. Set `KOS_SKIP_APT=1` to skip package installs inside the image
(useful when the chroot has no DNS).

## Editing the kos look

The desktop chrome is a GNOME Shell 48 extension written in ESM JavaScript
(the same `import`/`export` style as a modern web app) plus CSS:

- `overlay/usr/share/gnome-shell/extensions/kos-shell@kos/stylesheet.css`
  — colours, the translucent bottom bar, dock icons, and icon labels.
  Accent colour is kos blue (`#3b82f6`).
- `overlay/usr/share/gnome-shell/extensions/kos-shell@kos/extension.js`
  — entry point (`enable` / `disable`).
- `overlay/usr/share/gnome-shell/extensions/kos-shell@kos/panel.js`
  — moves the bar to the bottom and puts date and time on the left.
    The stock system status cluster stays on the right.
- `overlay/usr/share/gnome-shell/extensions/kos-shell@kos/dock.js`
  — the centre dock (pinned apps + All apps).
- `overlay/usr/share/gnome-shell/extensions/kos-shell@kos/desktopGrid.js`
  — the Launchpad-style 7-column icon grid and page dots.
- `overlay/usr/share/gnome-shell/extensions/kos-shell@kos/apps.txt`
  — the home-screen app list (one `.desktop` id per line). Leave it
  empty to show every visible installed app. The All apps button always
  lists everything.

System defaults (workspaces, enabled-extensions, clock, wallpaper) live
in `config/dconf-kos-shell.ini` and `config/kos.gschema.override`.

## Hot-reload dev loop

```
./build.sh distro-dev
```

boots the image in a QEMU window and shares this directory into the guest:

```
distro/overlay/usr/share/gnome-shell/extensions/kos-shell@kos
```

The guest bind-mounts that folder over the installed extension. A user
service watches the files (it polls, because a 9p share often does not
fire inotify events) and runs
`gnome-extensions disable kos-shell@kos && gnome-extensions enable kos-shell@kos`
on the session D-Bus, so CSS and many JS changes show up in about one
or two seconds — the same idea as a web dev server.

Limits: GNOME Shell loads extensions as ESM modules. A CSS tweak almost
always appears after the reload (the search-field accent change in
`hotreload-before.png` / `hotreload-after.png` is an example). Some
JavaScript changes (especially to imports or top-level module state) are
cached by GJS and need a log out/in, or a VM reboot, to take effect.

The share uses virtiofs when `virtiofsd` starts cleanly, otherwise 9p
(`-virtfs local,...,mount_tag=kosdev`). Ordinary `./build.sh distro-run`
does not attach the share; the installed copy of the extension is used.

Proof screenshots from a headless KVM boot live at the repo root:
`kos-ui.png` (Launchpad home screen), `kos-ui-window.png` (Files opened
from an icon click), `hotreload-before.png` and `hotreload-after.png`.

## Speed

`./build.sh distro-run` and `distro-dev` use KVM (`-enable-kvm -cpu host`),
a writeback virtio disk, and a guest with GNOME animations off and some
background services (Tracker, PackageKit, GNOME Software, Evolution)
disabled. Virgl/OpenGL is not used: this WSL QEMU's virtio-vga-gl module
fails to load, so the guest stays on virtio-vga (typically llvmpipe).
Disabling animations is the main smoothness win on that path.

The default WSL VM is about 8 GB RAM, which is tight for a 4 GB guest.
To give the VM more, create `%UserProfile%\.wslconfig` (see the notes
in the latest report) and run `wsl --shutdown` once. `distro-run` then
picks a larger `-m` / `-smp` automatically.
