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
- One full-width bottom bar, 72px, flush to the bottom edge, DARK blurred glass (rgba(20,22,30,0.60) tint + Shell.BlurEffect radius 60, brightness 0.75 in panel.js), white icons, text and clock, no border.:
  - left: date + time only;
  - middle: 42px dock icons (46px on hover) sitting flat on the bar, vertically centered, no pill or outline; a small white dot under running apps (blue under the focused one); a thin divider before running non-pinned apps;
  - right: GNOME's system cluster only (network/volume/power). No extra wifi icon.
- Desktop: Launchpad-style 7-column grid, centered as a block with even spacing, centered labels, no tile boxes, no search bar. Clicking an icon opens the app window.
- Folders and drag and drop (`folders.js`, `desktopGrid.js`, `dock.js`), macOS Launchpad style:
  - Drag an icon onto another icon's image -> a folder named "Folder" with both; onto a folder -> added. Dropping on the label area or empty space moves the icon to that cell.
  - Folder icon: dark frosted 18px rounded square with 2x2 (3x3 above 4 apps) mini icons. Click opens a centered dark frosted panel above the grid (below windows) with an editable title (click it, type, Enter/Escape); clicking outside closes it; clicking an app launches it.
  - Dragging an app out of the open panel closes it and drops on the grid underneath; a folder left with one app turns back into that app.
  - An app is in exactly ONE place (a MOVE, never a copy): grid/folder icon -> dock pins it at the drop slot and it leaves the grid/folder (a folder left with one app dissolves); dock icon -> grid unpins it and puts it at the drop cell (or into the folder it was dropped on). Pinned apps are never shown in the grid, including default favorites on first boot. Running apps that aren't pinned still show in the dock after the divider, with a dot. Dock icons reorder by drag.
  - The WHOLE bottom bar is the dock's drop target (`Main.panel._delegate` = the dock, restored on disable): a drop on the clock, status icons, gaps or bar edges pins at the nearest slot (before the first pinned icon whose center is right of the pointer; left of all -> first, right of all -> last). Don't make the drop target smaller again: drops outside the icon box used to snap back.
  - The grid reloads itself on `changed::favorite-apps` (via `later()`), filtering pinned ids out of top-level items and folders; dock -> grid saves the layout BEFORE the deferred unpin so the reload keeps the app at its drop cell.
  - Grid order and folders persist in `~/.config/kos/launchpad.json` (`{"version":1,"items":["app.desktop",{"folder","name","apps"}]}`); new apps from `apps.txt` are appended. Pins are `org.gnome.shell favorite-apps`, written directly (AppFavorites' add/remove would show a notification).
  - DnD only through GNOME's dnd.js: `DND.makeDraggable(actor)` plus `_delegate.handleDragOver/acceptDrop` on targets. No stage handlers or drag monitors. Change models in `acceptDrop`, but rebuild actors later (`later()` in folders.js) so dnd.js never loses its source or target mid-drop.
- Theme is DARK everywhere (Deepin DDE 23 dark): `color-scheme='prefer-dark'` in the gschema override and dconf defaults. extension.js switches an existing user to dark once (marker `~/.config/kos/dark-default-v1`), then leaves the Dark Style tile in charge. Don't switch to light unless asked.
- Popups (calendar, menus, OSD, dialogs, quick settings): one dark frosted panel (rgba(30,32,40,0.84) + blur), 18px radius, soft shadow (0 16px 44px rgba(0,0,0,0.45-0.50)), white text, rounded-square buttons (10-12px, not pills), accent #0081ff.
- Quick settings = Deepin control center. `quickPanel.js` switches GNOME's grid to 4 columns and reorders it; `.kos-cc*` classes style it. Top to bottom:
  - wide tiles (2 columns) for network and bluetooth, then night light ("eye comfort"): translucent gray 12px tile, icon in a circle on the left (pink #e0407a when on, gray when off), bold title, gray status line (filled in when GNOME leaves it empty), chevron on the right;
  - small square tiles (1 column) for every other toggle, plus our own DND Mode, Screenshot, Record, System Monitor: icon on top, 10px label under it, blue #0081ff when on;
  - each slider in its own gray card: thick light filled track, white round knob, a settings button on the right (display / sound);
  - bottom row: settings gear left, lock + power right (the screenshot button moved into a tile).
  - New quick settings items from GNOME or other extensions are picked up automatically (sliders become cards, toggles become small tiles). `disable()` must restore every span, order and style.
- App windows in Deepin Control Center style (`~/.config/gtk-4.0/gtk.css`, `gtk-3.0/gtk.css`, same files in `/etc/skel`): dark (#1f2128 window and content), 14px corners, soft shadow, flat titlebar the same color as the content, minimize/maximize/close on the RIGHT as thin plain glyphs (no circles; hover square on the icon, red on close) via `button-layout=':minimize,maximize,close'`; gray (#2c2f38) rounded header buttons, round '...' menu, gray pill search entry.
  - Sidebar slightly darker (#1a1c22), 40px rows with 8px corners, selected row solid #0081ff with white text and icon.
  - Grouped lists (`boxed-list`) are separate gray (#2c2f38) 9px cards with 6px gaps, label left, value right in gray. No macOS traffic lights.
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
- libadwaita has no real background blur for windows. Shell popups and the bar get a Shell.BlurEffect, but windows behind still show through.
- GTK CSS can't move widgets: GNOME Settings keeps its own header layout (search button + '...' in the sidebar header, not Deepin's centered search entry), and sidebar icons are monochrome symbolic icons. Colorful round sidebar icons need a custom icon set.
- Brightness only shows on hardware with a backlight, bluetooth only with an adapter, night light only where mutter supports it, so the QEMU VM shows fewer tiles than Deepin.
- Hot reload (`distro-dev`) re-applies CSS, but GJS caches ES modules: JS changes in a new or changed module need a fresh session (re-login or reboot) to show.
- GTK CSS is per user (~/.config), so changes reach the image only through `distro-update` (or a rebuild), not `distro-dev` hot reload.
