// Launchpad folders and drag-and-drop helpers shared by the grid and the dock.
//
// Drag and drop uses GNOME's own dnd.js: an icon is made draggable with
// DND.makeDraggable(actor), and a drop target is any actor whose _delegate
// has handleDragOver()/acceptDrop(). dnd.js walks up from the actor under
// the pointer to find one. No stage-wide handlers.
//
// The drag "source" every target receives is the dragged actor's _delegate:
//   {kind: 'grid-app' | 'grid-folder' | 'folder-app' | 'dock-app', appId, folder}

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {squircleIcon, squircleRadius} from './icons.js';

export const FOLDER_COLS = 4;

// ---- favorites (dock pins) ------------------------------------------------
// Written straight to org.gnome.shell favorite-apps: AppFavorites' public
// add/remove calls pop a "pinned" notification, which the kos UI doesn't have.

export function getPins() {
    return global.settings.get_strv('favorite-apps');
}

export function setPins(ids) {
    global.settings.set_strv('favorite-apps', ids);
}

export function pinAt(appId, pos) {
    const ids = getPins().filter(id => id !== appId);
    ids.splice(Math.max(0, Math.min(pos, ids.length)), 0, appId);
    setPins(ids);
}

export function unpin(appId) {
    const ids = getPins();
    if (ids.includes(appId))
        setPins(ids.filter(id => id !== appId));
}

// Run after the current drop finishes, so dnd.js never sees its source or
// target actors destroyed mid-drop (GNOME's dash defers the same way).
export function later(fn) {
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        fn();
        return GLib.SOURCE_REMOVE;
    });
}

// ---- inline rename entries ------------------------------------------------
// Like Files/Finder: a new file or folder exists on disk (or in the layout)
// as soon as it is created, and its name entry only renames it. The entry
// commits on Enter, on losing key focus, and on any press outside it. Clicks
// on non-focusable actors don't move Clutter key focus, so the grid, the
// bar and window focus changes call commitPendingEdits() (see desktopGrid.js).
// No stage-wide handler: each caller watches only its own actors.

const _pendingEdits = new Map(); // St.Entry -> commit(pressedActor | null)

export function beginPendingEdit(entry, commit) {
    _pendingEdits.set(entry, commit);
}

export function endPendingEdit(entry) {
    _pendingEdits.delete(entry);
}

// Commit every open rename entry except the one the event happened in.
export function commitPendingEdits(event = null) {
    const target = event ? global.stage.get_event_actor(event) : null;
    for (const [entry, commit] of [..._pendingEdits]) {
        if (target && entry.contains(target))
            continue;
        commit(target);
    }
}

// captured-event handler for our own containers: a press anywhere inside
// commits pending renames, then the event goes on as usual (never stopped,
// so clicks and drag-and-drop are unaffected).
export function commitEditsOnPress(_actor, event) {
    const type = event.type();
    if (_pendingEdits.size &&
        (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN))
        commitPendingEdits(event);
    return Clutter.EVENT_PROPAGATE;
}

export function lookupApp(appId) {
    return Shell.AppSystem.get_default().lookup_app(appId);
}

export function appIcon(appId, size, styleClass = '') {
    const app = lookupApp(appId);
    return squircleIcon({
        gicon: app?.get_icon() ?? null,
        fallback_icon_name: 'application-x-executable',
        icon_size: size,
        style_class: styleClass,
    });
}

// ---- persistence ----------------------------------------------------------
// ~/.config/kos/launchpad.json:
//   {"version": 1, "utilitiesMigrated": true,
//    "items": ["app.desktop", {"folder": "f1", "name": "Folder", "apps": [...], "keep": true}, ...]}
// utilitiesMigrated is a one-shot marker: after the default Utilities
// folder has been created (or skipped because it already existed), it
// stays set so deleting the folder does not bring it back.

const STORE = GLib.build_filenamev([GLib.get_user_config_dir(), 'kos', 'launchpad.json']);

export function loadLayout() {
    try {
        const [ok, bytes] = GLib.file_get_contents(STORE);
        if (!ok)
            return null;
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (!Array.isArray(data?.items))
            return null;
        return {
            items: data.items,
            utilitiesMigrated: data.utilitiesMigrated === true,
        };
    } catch (_e) {
        return null;
    }
}

export function saveLayout(items, {utilitiesMigrated = false} = {}) {
    const out = items.map(e => {
        if (e.type === 'folder')
            return {folder: e.fid, name: e.name, apps: [...e.apps], ...(e.keep ? {keep: true} : {})};
        if (e.type === 'file')
            return {file: e.name};
        if (e.type === 'dir')
            return {dir: e.name};
        return e.id;
    });
    const doc = {version: 1, items: out};
    if (utilitiesMigrated)
        doc.utilitiesMigrated = true;
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(STORE), 0o755);
        GLib.file_set_contents(STORE, JSON.stringify(doc, null, 1));
    } catch (e) {
        logError(e, 'kos-shell: saving launchpad layout');
    }
}

// ---- desktop files & folders ----------------------------------------------

export function desktopDirPath() {
    return GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) ||
        GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
}

export function desktopFile(name) {
    return Gio.File.new_for_path(GLib.build_filenamev([desktopDirPath(), name]));
}

function desktopEntryType(name) {
    if (!name || name.includes('/'))
        return null;
    const f = desktopFile(name);
    if (!f.query_exists(null))
        return null;
    try {
        const info = f.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_file_type() === Gio.FileType.DIRECTORY ? 'dir' : 'file';
    } catch (_e) {
        return null;
    }
}

export function desktopFileExists(name) {
    return desktopEntryType(name) === 'file';
}

export function desktopDirExists(name) {
    return desktopEntryType(name) === 'dir';
}

export function listUserDesktopEntries() {
    const dir = Gio.File.new_for_path(desktopDirPath());
    if (!dir.query_exists(null))
        return [];
    const entries = [];
    try {
        const en = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null))) {
            const name = info.get_name();
            if (!name || name.startsWith('.'))
                continue;
            entries.push({
                name,
                isDir: info.get_file_type() === Gio.FileType.DIRECTORY,
            });
        }
    } catch (_e) {
        return [];
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
}

export function createDesktopFile(base = 'Untitled', ext = '.txt') {
    const dir = desktopDirPath();
    GLib.mkdir_with_parents(dir, 0o755);
    for (let i = 1; i < 1000; i++) {
        const name = i === 1 ? `${base}${ext}` : `${base} ${i}${ext}`;
        const f = desktopFile(name);
        if (f.query_exists(null))
            continue;
        try {
            const stream = f.create(Gio.FileCreateFlags.NONE, null);
            stream.close(null);
            return name;
        } catch (e) {
            logError(e, `kos-shell: creating file ${name}`);
            return null;
        }
    }
    return null;
}

export function createDesktopDir(base = 'New Folder') {
    const dir = desktopDirPath();
    GLib.mkdir_with_parents(dir, 0o755);
    for (let i = 1; i < 1000; i++) {
        const name = i === 1 ? base : `${base} ${i}`;
        const f = desktopFile(name);
        if (f.query_exists(null))
            continue;
        try {
            f.make_directory(null);
            return name;
        } catch (e) {
            logError(e, `kos-shell: creating folder ${name}`);
            return null;
        }
    }
    return null;
}

export function moveDesktopFileToDir(fileName, dirName) {
    const src = desktopFile(fileName);
    const dst = Gio.File.new_for_path(GLib.build_filenamev([desktopDirPath(), dirName, fileName]));
    if (!src.query_exists(null) || dst.query_exists(null))
        return false;
    try {
        src.move(dst, Gio.FileCopyFlags.NONE, null, null);
        return true;
    } catch (e) {
        logError(e, `kos-shell: moving ${fileName} into ${dirName}`);
        return false;
    }
}

export function renameDesktopFile(oldName, newName) {
    const clean = (newName || '').replace(/\//g, '').trim();
    if (!clean || clean === '.' || clean === '..' || clean === oldName)
        return null;
    const src = desktopFile(oldName);
    const dst = desktopFile(clean);
    if (!src.query_exists(null) || dst.query_exists(null))
        return null;
    try {
        src.move(dst, Gio.FileCopyFlags.NONE, null, null);
        return clean;
    } catch (e) {
        logError(e, `kos-shell: renaming ${oldName} -> ${clean}`);
        return null;
    }
}

export function deleteDesktopFile(name) {
    const f = desktopFile(name);
    if (!f.query_exists(null))
        return;
    try {
        f.trash(null);
    } catch (_e) {
        try {
            f.delete(null);
        } catch (e2) {
            logError(e2, `kos-shell: deleting ${name}`);
        }
    }
}

export function dirIcon(size) {
    return squircleIcon({
        icon_name: 'folder',
        fallback_icon_name: 'folder',
        icon_size: size,
        style_class: 'kos-desktop-icon-app',
    });
}

export function fileIcon(name, size) {
    const f = desktopFile(name);
    let gicon = null;
    try {
        const info = f.query_info('standard::icon', Gio.FileQueryInfoFlags.NONE, null);
        gicon = info.get_icon();
    } catch (_e) {
        // fall back to content-type guess
    }
    if (!gicon) {
        const [ctype] = Gio.content_type_guess(name, null);
        gicon = Gio.content_type_get_icon(ctype || 'text/plain');
    }
    return squircleIcon({
        gicon,
        fallback_icon_name: 'text-x-generic',
        icon_size: size,
        style_class: 'kos-desktop-icon-app',
    });
}

// ---- folder icon ----------------------------------------------------------

// Rounded frosted square with a 2x2 (up to 4 apps) or 3x3 grid of mini icons.
export function makeFolderSquare(folder, size) {
    const square = new St.Widget({
        style_class: 'kos-folder-icon',
        layout_manager: new Clutter.FixedLayout(),
        width: size,
        height: size,
        x_align: Clutter.ActorAlign.CENTER,
        style: `border-radius: ${squircleRadius(size)}px;`,
    });
    const grid = folder.apps.length > 4 ? 3 : 2;
    const pad = Math.round(size * 0.12);
    const cell = (size - 2 * pad) / grid;
    const mini = Math.floor(cell * 0.82);
    folder.apps.slice(0, grid * grid).forEach((id, i) => {
        const icon = appIcon(id, mini);
        icon.set_position(
            Math.round(pad + (i % grid) * cell + (cell - mini) / 2),
            Math.round(pad + Math.floor(i / grid) * cell + (cell - mini) / 2));
        square.add_child(icon);
    });
    return square;
}

// ---- open folder ----------------------------------------------------------

// Centered dark frosted panel with an editable title and the folder's apps.
// Lives in the desktop layer above the grid (below app windows), like the
// grid itself. Clicking outside the panel closes it.
export class KosFolderView {
    constructor({parent, onLaunch, onRename, onClosed, makeTile, tileSize, iconSize}) {
        this._onLaunch = onLaunch;
        this._onRename = onRename;
        this._onClosed = onClosed;
        this._makeTile = makeTile;
        this._tile = tileSize;
        this._iconSize = iconSize;
        this.folder = null;

        this.actor = new St.Widget({
            style_class: 'kos-folder-backdrop',
            reactive: true,
            visible: false,
            layout_manager: new Clutter.FixedLayout(),
        });
        // Clicks on the backdrop itself (not on the panel) close the folder.
        this.actor.connect('button-release-event', (_a, event) => {
            if (global.stage.get_event_actor(event) === this.actor)
                this.close();
            return Clutter.EVENT_STOP;
        });
        // Dragging an app out of the panel closes the folder so the drop
        // lands on the grid underneath (see handleDragOver).
        this.actor._delegate = this;

        this._panel = new St.BoxLayout({
            style_class: 'kos-folder-panel',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
        });
        // Stop the walk up to the backdrop while the pointer is on the panel.
        this._panel._delegate = {
            handleDragOver: () => DND.DragMotionResult.NO_DROP,
        };
        this.actor.add_child(this._panel);

        this._title = new St.Entry({
            style_class: 'kos-folder-title',
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._title.clutter_text.set({
            max_length: 40,
            single_line_mode: true,
            ellipsize: Pango.EllipsizeMode.END,
            line_alignment: Pango.Alignment.CENTER,
        });
        // Keyboard goes to the shell only when no window has focus; take it
        // when the title is clicked, so typing renames the folder.
        this._title.connect('button-press-event', () => {
            global.display.unset_input_focus(global.get_current_time());
            this._title.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        });
        this._title.clutter_text.connect('activate', () => this._commitTitle(true));
        this._title.clutter_text.connect('key-focus-in', () =>
            beginPendingEdit(this._title, () => this._commitTitle(true)));
        this._title.clutter_text.connect('key-focus-out', () => this._commitTitle(false));
        // Escape keeps the old name (the folder already exists) and closes.
        this._title.clutter_text.connect('key-press-event', (_t, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                if (this.folder)
                    this._title.text = this.folder.name;
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._panel.add_child(this._title);

        this._grid = new St.Widget({
            style_class: 'kos-folder-grid',
            layout_manager: new Clutter.FixedLayout(),
        });
        this._panel.add_child(this._grid);

        parent.add_child(this.actor);
    }

    get isOpen() {
        return this.actor.visible;
    }

    open(folder, monitor) {
        this.folder = folder;
        this._title.text = folder.name;
        this._grid.destroy_all_children();

        const cols = Math.min(FOLDER_COLS, Math.max(2, folder.apps.length));
        const rows = Math.max(1, Math.ceil(folder.apps.length / cols));
        const [tw, th] = this._tile;
        folder.apps.forEach((id, i) => {
            const tile = this._makeTile(id, folder);
            tile.set_position((i % cols) * (tw + 12), Math.floor(i / cols) * (th + 8));
            this._grid.add_child(tile);
        });
        this._grid.set_size(cols * tw + (cols - 1) * 12, rows * th + (rows - 1) * 8);

        this.actor.set_position(0, 0);
        this.actor.set_size(monitor.width, monitor.height);
        this.actor.show();
        // Center the panel once it has its natural size.
        const [, natW] = this._panel.get_preferred_width(-1);
        const [, natH] = this._panel.get_preferred_height(natW);
        this._panel.set_position(
            Math.round((monitor.width - natW) / 2),
            Math.round((monitor.height - 72 - natH) / 2));
    }

    // Put the title in edit mode with the name selected (right-click
    // "New Folder" / "Rename").
    beginRename() {
        if (!this.isOpen)
            return;
        global.display.unset_input_focus(global.get_current_time());
        this._title.grab_key_focus();
        this._title.clutter_text.set_selection(0, -1);
    }

    close() {
        if (!this.actor.visible)
            return;
        this._commitTitle(false);
        this.actor.hide();
        this.folder = null;
        this._onClosed?.();
    }

    _commitTitle(unfocus) {
        endPendingEdit(this._title);
        if (!this.folder)
            return;
        const name = this._title.text.trim() || 'Folder';
        if (unfocus)
            global.stage.set_key_focus(null);
        if (name !== this.folder.name)
            this._onRename(this.folder, name);
    }

    handleDragOver(source) {
        if (source?.kind === 'folder-app')
            this.close();
        return DND.DragMotionResult.CONTINUE;
    }

    destroy() {
        endPendingEdit(this._title);
        this.actor.destroy();
    }
}

// Make a grid/folder/dock icon draggable. `delegate` describes the source.
export function makeDraggableIcon(button, delegate, dragIconFn, sourceActor) {
    button._delegate = Object.assign(delegate, {
        getDragActor: dragIconFn,
        getDragActorSource: () => (typeof sourceActor === 'function' ? sourceActor() : sourceActor),
    });
    const draggable = DND.makeDraggable(button);
    return draggable;
}

export {DND};
