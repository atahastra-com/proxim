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
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

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

export function lookupApp(appId) {
    return Shell.AppSystem.get_default().lookup_app(appId);
}

export function appIcon(appId, size) {
    const app = lookupApp(appId);
    return new St.Icon({
        gicon: app?.get_icon() ?? null,
        fallback_icon_name: 'application-x-executable',
        icon_size: size,
    });
}

// ---- persistence ----------------------------------------------------------
// ~/.config/kos/launchpad.json:
//   {"version": 1, "items": ["app.desktop", {"folder": "f1", "name": "Folder", "apps": [...]}, ...]}

const STORE = GLib.build_filenamev([GLib.get_user_config_dir(), 'kos', 'launchpad.json']);

export function loadLayout() {
    try {
        const [ok, bytes] = GLib.file_get_contents(STORE);
        if (!ok)
            return null;
        const data = JSON.parse(new TextDecoder().decode(bytes));
        return Array.isArray(data?.items) ? data.items : null;
    } catch (_e) {
        return null;
    }
}

export function saveLayout(items) {
    const out = items.map(e => e.type === 'folder'
        ? {folder: e.fid, name: e.name, apps: [...e.apps]}
        : e.id);
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(STORE), 0o755);
        GLib.file_set_contents(STORE, JSON.stringify({version: 1, items: out}, null, 1));
    } catch (e) {
        logError(e, 'kos-shell: saving launchpad layout');
    }
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
        this._title.clutter_text.connect('key-focus-out', () => this._commitTitle(false));
        this._title.clutter_text.connect('key-press-event', (_t, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
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
        const rows = Math.ceil(folder.apps.length / cols);
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

    close() {
        if (!this.actor.visible)
            return;
        this._commitTitle(false);
        this.actor.hide();
        this.folder = null;
        this._onClosed?.();
    }

    _commitTitle(unfocus) {
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
        this.actor.destroy();
    }
}

// Make a grid/folder/dock icon draggable. `delegate` describes the source.
export function makeDraggableIcon(button, delegate, dragIconFn, sourceActor) {
    button._delegate = Object.assign(delegate, {
        getDragActor: dragIconFn,
        getDragActorSource: () => sourceActor,
    });
    const draggable = DND.makeDraggable(button);
    return draggable;
}

export {DND};
