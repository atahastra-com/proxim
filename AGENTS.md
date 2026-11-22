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

Wallpaper: `distro/overlay/usr/share/backgrounds/kos/kos-wallpaper.png`. Defaults (animations off, enabled extension): `distro/config/kos.gschema.override` and `distro/config/dconf-kos-shell.ini`.

## Design
- No top bar, Activities, overview, workspaces, or app-grid button.
- One full-width bottom bar, 72px, flush to the bottom edge, dark frosted glass (rgba(16,18,24,0.72) + background blur), no border:
  - left: date + time only;
  - middle: 42px dock icons (46px on hover) sitting flat on the bar, vertically centered, no pill or outline; a small white dot under running apps; a thin divider before running non-pinned apps;
  - right: GNOME's system cluster only (network/volume/power). No extra wifi icon.
- Desktop: Launchpad-style 7-column grid, centered as a block with even spacing, centered labels, no tile boxes, no search bar. Clicking an icon opens the app window.
- Dark navy wallpaper with a dim layer over the whole screen, kos blue accent (#3b82f6), animations off.

## Hard rules
- No stage-level click/key handlers or global event capture. Desktop icons are reactive `St.Button`s inside `Main.layoutManager._backgroundGroup` (above the wallpaper, below windows).
- Never hide the overview during the startup animation. `extension.js` sets `Main.sessionMode.hasOverview = false` while starting up; hiding it mid-animation left an invisible layer that ate all clicks.
- Don't edit build scripts (`build.sh`, `distro/*.sh`), `kosinit/`, or `services/` unless asked.
- Never delete `distro/` or `distro/out/kos.qcow2`.
- Only one `./build.sh distro` or `distro-update` at a time (check `pgrep -af build.sh` first); two at once corrupt the image.
- Make small commits; leave nothing uncommitted.
- Test with `./build.sh distro-dev` (live CSS reload) or `./build.sh distro-update` then `./build.sh distro-run`. A change is done only when a screenshot proves it.

## Planned
- Custom icon theme from `distro/icons/<appid>.svg` (folder not created yet).
