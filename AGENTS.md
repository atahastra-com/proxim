# kos — agent instructions

## What kos is
kos is a fully custom desktop OS UI. Debian 13 + GNOME Shell 48 is only the engine underneath. Never restore the default GNOME UI (top bar, Activities, overview, dash, app grid).

## Where the UI lives
Only in `distro/overlay/usr/share/gnome-shell/extensions/kos-shell@kos/`:
- `extension.js`: entry point; enables panel, dock and grid; blocks the overview; sets session settings.
- `panel.js`: moves GNOME's bar to a full-width 72px bottom bar with a frosted blur (Shell.BlurEffect); date + time on the left.
- `dock.js`: pinned and running app icons in the middle of the bar, with a running-app dot.
- `desktopGrid.js`: the Launchpad-style home screen grid of app icons.
- `stylesheet.css`: all colors, sizes and spacing (plain CSS for St widgets).
- `apps.txt`: which apps show on the home screen, one .desktop id per line.
- `metadata.json`: extension id and supported shell version.

App window style (GTK, not the shell): `distro/overlay/home/pratham/.config/gtk-4.0/gtk.css` (libadwaita/GTK4) and `gtk-3.0/gtk.css`, with copies in `distro/overlay/etc/skel/.config/` for new users. Keep the two locations identical.

Wallpaper: `distro/overlay/usr/share/backgrounds/kos/kos-wallpaper.png`. Defaults (animations off, enabled extension): `distro/config/kos.gschema.override` and `distro/config/dconf-kos-shell.ini`.

## Design
- No top bar, Activities, overview, workspaces, or app-grid button.
- One full-width bottom bar, 72px, flush to the bottom edge, dark frosted glass (rgba(16,18,24,0.72) + background blur), no border:
  - left: date + time only;
  - middle: 42px dock icons (46px on hover) sitting flat on the bar, vertically centered, no pill or outline; a small white dot under running apps; a thin divider before running non-pinned apps;
  - right: GNOME's system cluster only (network/volume/power). No extra wifi icon.
- Desktop: Launchpad-style 7-column grid, centered as a block with even spacing, centered labels, no tile boxes, no search bar. Clicking an icon opens the app window.
- Popups (quick settings, calendar, menus, OSD, dialogs) in Deepin (DDE) style: one dark translucent panel (rgba(28,30,38,0.74)), 18px radius, soft large shadow, rounded-square tiles and buttons (12-14px, not pills), thin sliders, accent #0081ff.
- App windows in Deepin style: 16px rounded corners, big soft shadow, flat titlebar the same color as the content, minimize/maximize/close as round buttons on the RIGHT (`button-layout=':minimize,maximize,close'`, set in the gschema override, dconf defaults and extension.js), darker sidebar with rounded blue selection. No macOS traffic lights.
- Icon theme Deepin2022 (`distro/overlay/usr/share/icons/Deepin2022/`, gitignored, must exist locally before a build).
- kos wallpaper with a dim layer over the whole screen, accent #0081ff, animations off.

## Hard rules
- No stage-level click/key handlers or global event capture. Desktop icons are reactive `St.Button`s inside `Main.layoutManager._backgroundGroup` (above the wallpaper, below windows).
- Never hide the overview during the startup animation. `extension.js` sets `Main.sessionMode.hasOverview = false` while starting up; hiding it mid-animation left an invisible layer that ate all clicks.
- Don't edit build scripts (`build.sh`, `distro/*.sh`), `kosinit/`, or `services/` unless asked.
- Never delete `distro/` or `distro/out/kos.qcow2`.
- Only one `./build.sh distro` or `distro-update` at a time (check `pgrep -af build.sh` first); two at once corrupt the image.
- Make small commits; leave nothing uncommitted.
- Test with `./build.sh distro-dev` (live CSS reload) or `./build.sh distro-update` then `./build.sh distro-run`. A change is done only when a screenshot proves it.

## Limits to know
- libadwaita has no real background blur for windows; "frosted" sidebars are just darker/translucent colors. Shell popups get translucency, not blur.
- GTK CSS is per user (~/.config), so changes reach the image only through `distro-update` (or a rebuild), not `distro-dev` hot reload.
