// Home screen: a 7-column grid of large app icons with labels, and page
// dots when the apps don't fit on one page. Icons sit on a dimmed
// wallpaper — no tile boxes, no wordmark, no search field.
//
// The grid lives inside the wallpaper group (Main.layoutManager._backgroundGroup),
// so it paints above the wallpaper and below every app window, like
// position:absolute icons on a <body> background. Each icon is a normal
// reactive St.Button: clicks only reach it when nothing else (an app window,
// the bottom bar) is on top. There is no stage-wide click or key handler.
//
// Why not global.window_group directly: mutter restacks that group on every
// window change, lowering window actors and the background group to the
// bottom, so any other actor there ends up ABOVE all windows.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    DND, KosFolderView, appIcon, getPins, later, loadLayout, lookupApp,
    makeDraggableIcon, makeFolderSquare, pinAt, saveLayout, unpin,
} from './folders.js';
import {closeContextMenu, openContextMenu} from './contextMenu.js';

export const GRID_COLS = 7;
export const ICON_SIZE = 72; // all-apps overlay only; the home grid sizes from the screen
export const MAX_GRID_WIDTH = 1100;
export const LABEL_GAP = 8;
export const DOTS_HEIGHT = 24;

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

export class KosDesktopGrid {
    constructor({extensionPath} = {}) {
        this._extensionPath = extensionPath;
        this._signals = [];
        this._actor = null;
        this._backdrop = null;
        this._dots = null;
        this._page = 0;
        // Grid entries in order: {type: 'app', id} or
        // {type: 'folder', fid, name, apps: [ids]}. Saved in launchpad.json.
        this._items = [];
    }

    enable() {
        this._actor = new St.Widget({
            name: 'kos-desktop-grid',
            style_class: 'kos-desktop-grid',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
        });

        // The dimmer is reactive only so mouse-wheel paging works on empty
        // desktop space. It sits below windows, so it never covers them.
        this._backdrop = new St.Widget({
            style_class: 'kos-launchpad-dim',
            reactive: true,
        });
        this._backdrop.connect('scroll-event', this._onScroll.bind(this));
        // Empty desktop space is a drop target: move an icon there, or drop
        // a dock icon there to unpin it.
        this._backdrop._delegate = this;
        // Right-click on empty desktop space: "New Folder".
        this._backdrop.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            this._folderView?.close();
            openContextMenu(x, y, [
                {label: 'New Folder', action: () => this._newFolder([], this._cellIndexAt(x, y))},
            ]);
            return Clutter.EVENT_STOP;
        });
        this._actor.add_child(this._backdrop);

        this._dots = new St.BoxLayout({
            style_class: 'kos-page-dots',
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._actor.add_child(this._dots);

        this._folderView = null;

        const bg = Main.layoutManager._backgroundGroup;
        bg.add_child(this._actor);
        this._raise();
        // The shell re-creates wallpaper actors (monitor change, wallpaper
        // change) and they could land on top of the grid; keep it on top
        // of its siblings, which are all wallpaper.
        this._connect(bg, 'child-added', (_g, child) => {
            if (child !== this._actor)
                this._raise();
        });

        this._rebuild();

        const appsys = Shell.AppSystem.get_default();
        this._connect(appsys, 'installed-changed', () => this._rebuild());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._rebuild());
        this._connect(Main.layoutManager, 'startup-complete', () => this._rebuild());
        // An app lives in one place: pinned apps leave the grid, unpinned
        // ones come back. Reload whenever the dock's pins change.
        this._connect(global.settings, 'changed::favorite-apps', () => later(() => this._rebuild()));
        this._connect(this._actor, 'notify::allocation', () => this._logAllocation());
    }

    disable() {
        closeContextMenu();
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        this._folderView = null;
        if (this._actor) {
            this._actor.destroy();
            this._actor = null;
        }
        this._backdrop = null;
        this._dots = null;
    }

    _connect(obj, signal, cb) {
        const id = obj.connect(signal, cb);
        this._signals.push([obj, id]);
    }

    _raise() {
        const bg = this._actor?.get_parent();
        if (bg)
            bg.set_child_above_sibling(this._actor, null);
    }

    _logAllocation() {
        if (!this._actor || this._loggedAlloc)
            return;
        const box = this._actor.get_allocation_box();
        const bg = this._actor.get_parent();
        const kids = bg ? bg.get_children().map(c => c === this._actor ? 'GRID' : c.constructor.name) : [];
        log(`kos-shell: grid alloc ${box.x1},${box.y1} ${box.get_width()}x${box.get_height()} ` +
            `visible=${this._actor.visible} mapped=${this._actor.mapped} opacity=${this._actor.opacity} ` +
            `parent=${bg?.constructor.name} order=[${kids.join(',')}] icons=${this._actor.get_n_children() - 2}`);
        if (this._actor.mapped && box.get_width() > 0)
            this._loggedAlloc = true;
    }

    _rebuild() {
        if (!this._actor)
            return;
        const openFid = this._folderView?.isOpen ? this._folderView.folder?.fid : null;
        this._items = this._loadItems();
        if (this._page < 0)
            this._page = 0;
        this._layout();
        if (openFid) {
            const f = this._items.find(e => e.type === 'folder' && e.fid === openFid);
            if (f)
                this._folderView.open(f, Main.layoutManager.primaryMonitor);
            else
                this._folderView.close();
        }
    }

    // Saved layout first (order, folders), then any home app it doesn't
    // mention yet. Apps that are gone, and apps pinned in the dock, are
    // left out; a folder left with one app turns back into that app.
    _loadItems() {
        const pinned = new Set(getPins());
        const home = listHomeApps(this._extensionPath).map(a => a.get_id())
            .filter(id => !pinned.has(id));
        const saved = loadLayout();
        if (!saved)
            return home.map(id => ({type: 'app', id}));

        const used = new Set(pinned);
        const take = id => {
            if (typeof id !== 'string' || used.has(id) || !loadApp(id))
                return false;
            used.add(id);
            return true;
        };
        const items = [];
        for (const e of saved) {
            if (typeof e === 'string') {
                if (take(e))
                    items.push({type: 'app', id: e});
            } else if (e && Array.isArray(e.apps)) {
                const apps = e.apps.filter(take);
                const keep = e.keep === true;
                if (apps.length >= 2 || keep)
                    items.push({type: 'folder', fid: String(e.folder ?? GLib.uuid_string_random()), name: String(e.name || 'Folder'), apps, ...(keep ? {keep} : {})});
                else if (apps.length === 1)
                    items.push({type: 'app', id: apps[0]});
            }
        }
        for (const id of home) {
            if (!used.has(id) && !pinned.has(id)) {
                used.add(id);
                items.push({type: 'app', id});
            }
        }
        return items;
    }

    // Save, then redraw after the current drop has finished.
    _commit() {
        saveLayout(this._items);
        later(() => {
            if (!this._actor)
                return;
            this._layoutIcons();
            if (this._folderView?.isOpen) {
                const f = this._items.find(e => e.type === 'folder' && e === this._folderView.folder);
                if (f)
                    this._folderView.open(f, Main.layoutManager.primaryMonitor);
                else
                    this._folderView.close();
            }
        });
    }

    _workArea() {
        const monitor = Main.layoutManager.primaryMonitor;
        const panelH = (Main.panel && Main.panel.height) ? Main.panel.height : 72;
        return {
            x: monitor.x,
            y: monitor.y,
            w: monitor.width,
            h: monitor.height - panelH,
        };
    }

    _layout() {
        const monitor = Main.layoutManager.primaryMonitor;
        // Cover the full monitor with the dim backdrop so there is never a
        // 1px seam line between the dimmer and the bottom dock bar.
        this._actor.set_position(monitor.x, monitor.y);
        this._actor.set_size(monitor.width, monitor.height);
        this._backdrop.set_position(0, 0);
        this._backdrop.set_size(monitor.width, monitor.height);
        this._raise();
        this._layoutIcons();
    }

    // All spacing comes from the work area, so it scales with resolution.
    // At 1280x744 (1280x800 minus the bar): 68px icons, a 1000px-wide block
    // (~11% margin each side), 7 x 143px columns, 128px rows.
    _metrics(wa, appCount) {
        const iconSize = clamp(Math.round(Math.min(wa.w / 19, wa.h / 11) / 4) * 4, 48, 112);
        const gridW = Math.min(Math.round(wa.w * 0.78), MAX_GRID_WIDTH);
        const colW = Math.floor(gridW / GRID_COLS);
        const labelH = Math.round(iconSize * 0.26) + LABEL_GAP;
        // Rows a bit shorter than columns: the label fills part of the
        // vertical gap, so icon-to-icon spacing looks even both ways.
        const rowH = Math.max(iconSize + labelH + 20, Math.round(colW * 0.9));
        const padY = Math.max(32, Math.round(wa.h * 0.07));
        const band = Math.max(rowH, wa.h - 2 * padY - DOTS_HEIGHT);
        const rows = Math.max(1, Math.floor(band / rowH));
        const perPage = GRID_COLS * rows;
        const count = appCount ?? this._items.length;
        const onPage = Math.min(perPage, Math.max(0, count));
        const usedRows = Math.max(1, Math.ceil(onPage / GRID_COLS));
        const blockW = colW * GRID_COLS;
        const blockH = usedRows * rowH;
        // Center the block in the area above the bar (dots get their own strip).
        const left = Math.round((wa.w - blockW) / 2);
        const top = padY + Math.max(0, Math.round((band - blockH) / 2));
        return {iconSize, colW, rowH, labelH, rows, perPage, left, top, padY};
    }

    _layoutIcons() {
        if (!this._actor)
            return;

        // Drop previous icon actors; keep backdrop, dots and the folder view.
        const keep = new Set([this._backdrop, this._dots, this._folderView?.actor]);
        for (const child of this._actor.get_children()) {
            if (!keep.has(child))
                child.destroy();
        }

        const wa = this._workArea();
        const items = this._items;
        const m = this._metrics(wa, items.length);
        this._m = m;
        const pages = Math.max(1, Math.ceil(items.length / m.perPage));
        if (this._page >= pages)
            this._page = pages - 1;

        const start = this._page * m.perPage;
        const pageItems = items.slice(start, start + m.perPage);
        // The button (and its hover highlight) is a tidy tile centered in
        // its cell, not the whole cell.
        const tileW = Math.min(m.colW - 12, m.iconSize + 64);
        const tileH = m.iconSize + m.labelH + 16;
        this._tileSize = [tileW, tileH];

        this._ensureFolderView(m.iconSize);

        pageItems.forEach((item, i) => {
            const col = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);
            const icon = item.type === 'folder'
                ? this._makeFolderIcon(item, tileW, m.iconSize)
                : this._makeIcon(item, tileW, m.iconSize);
            if (!icon)
                return;
            icon.set_size(tileW, tileH);
            icon.set_position(
                m.left + col * m.colW + Math.round((m.colW - tileW) / 2),
                m.top + row * m.rowH + Math.round((m.rowH - tileH) / 2));
            this._actor.add_child(icon);
        });
        if (this._folderView)
            this._actor.set_child_above_sibling(this._folderView.actor, null);

        this._layoutDots(pages, wa, m);
        log(`kos-shell: launchpad ${items.length} items, page ${this._page + 1}/${pages}, ` +
            `${m.rows} rows x ${GRID_COLS} cols, icon ${m.iconSize}px, cell ${m.colW}x${m.rowH}, ` +
            `block at ${m.left},${m.top}`);
    }

    // An app tile. `item` is a grid entry ({type: 'app', id}); inside an
    // open folder `folder` is set and the tile drags out of that folder.
    _makeIcon(item, tileW, iconSize, folder = null) {
        const app = lookupApp(item.id);
        if (!app)
            return null;
        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        const gicon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: iconSize,
            style_class: 'kos-desktop-icon-app',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const label = new St.Label({
            text: app.get_name(),
            style_class: 'kos-desktop-icon-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        // One line, centered, "Disk Usage Ana…" for long names.
        const ct = label.clutter_text;
        ct.line_wrap = false;
        ct.ellipsize = Pango.EllipsizeMode.END;
        ct.line_alignment = Pango.Alignment.CENTER;
        label.set_width(tileW - 8);

        box.add_child(gicon);
        box.add_child(label);

        // A real button, like <button> with an <img>: only gets the click
        // when the pointer is over it and no window is on top.
        const button = new St.Button({
            style_class: 'kos-desktop-icon',
            reactive: true,
            can_focus: false,
            track_hover: true,
            button_mask: St.ButtonMask.ONE,
            child: box,
            accessible_name: app.get_name(),
        });
        button.connect('clicked', () => {
            this._folderView?.close();
            launchApp(app);
        });

        const source = folder
            ? {kind: 'folder-app', appId: item.id, folder}
            : {kind: 'grid-app', appId: item.id, item};
        this._onRightClick(button, (x, y) => this._appMenu(x, y, item.id, folder));
        makeDraggableIcon(button, source, () => appIcon(item.id, iconSize), gicon);
        if (!folder) {
            // Dropping on this tile: on the icon itself makes or fills a
            // folder; on the rest of the tile it moves the icon here.
            Object.assign(button._delegate, {
                handleDragOver: src => this._dragOk(src),
                acceptDrop: (src, _a, x, y) => this._dropOnItem(src, item, x, y, tileW, iconSize),
            });
        }
        return button;
    }

    _makeFolderIcon(folder, tileW, iconSize) {
        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });
        const square = makeFolderSquare(folder, iconSize);
        const label = new St.Label({
            text: folder.name,
            style_class: 'kos-desktop-icon-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const ct = label.clutter_text;
        ct.line_wrap = false;
        ct.ellipsize = Pango.EllipsizeMode.END;
        ct.line_alignment = Pango.Alignment.CENTER;
        label.set_width(tileW - 8);
        box.add_child(square);
        box.add_child(label);

        const button = new St.Button({
            style_class: 'kos-desktop-icon',
            reactive: true,
            can_focus: false,
            track_hover: true,
            button_mask: St.ButtonMask.ONE,
            child: box,
            accessible_name: folder.name,
        });
        button.connect('clicked', () =>
            this._folderView.open(folder, Main.layoutManager.primaryMonitor));
        this._onRightClick(button, (x, y) => openContextMenu(x, y, [
            {label: 'Rename', action: () => this._openFolder(folder, true)},
            {label: 'Delete Folder', action: () => this._deleteFolder(folder)},
        ]));
        makeDraggableIcon(button, {kind: 'grid-folder', folder},
            () => makeFolderSquare(folder, iconSize), square);
        Object.assign(button._delegate, {
            handleDragOver: src => this._dragOk(src),
            acceptDrop: (src, _a, x, y) => this._dropOnItem(src, folder, x, y, tileW, iconSize),
        });
        return button;
    }

    // ---- right-click menus ------------------------------------------------

    _onRightClick(actor, open) {
        actor.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            open(x, y);
            return Clutter.EVENT_STOP;
        });
    }

    _appMenu(x, y, appId, inFolder) {
        const source = inFolder
            ? {kind: 'folder-app', appId, folder: inFolder}
            : {kind: 'grid-app', appId};
        const folders = this._items.filter(e => e.type === 'folder' && e !== inFolder);
        const submenu = folders.map(f => ({
            label: f.name,
            action: () => this._place(source, -1, f),
        }));
        submenu.push({label: 'New Folder with this app', action: () => this._newFolderWith(appId)});
        const entries = [{label: 'Move to Folder', submenu}];
        if (inFolder)
            entries.push({label: 'Remove from Folder', action: () => this._place(source, this._items.indexOf(inFolder) + 1, null)});
        entries.push({label: 'Add to Dock', action: () => {
            this._folderView?.close();
            pinAt(appId, getPins().length);
        }});
        openContextMenu(x, y, entries);
    }

    // A kept (never auto-dissolved) folder at grid index `index`, opened
    // with its title ready to type.
    _newFolder(apps, index) {
        const folder = {type: 'folder', fid: GLib.uuid_string_random(), name: 'Folder', apps, keep: true};
        this._items.splice(clamp(index, 0, this._items.length), 0, folder);
        this._commit();
        later(() => this._openFolder(folder, true));
    }

    _newFolderWith(appId) {
        let index = this._items.findIndex(e =>
            (e.type === 'app' && e.id === appId) || (e.type === 'folder' && e.apps.includes(appId)));
        const top = index >= 0 && this._items[index].type === 'app';
        this._removeId(appId);
        if (!top)
            index = index >= 0 ? index + 1 : this._items.length;
        this._folderView?.close();
        this._newFolder([appId], index);
    }

    _openFolder(folder, rename) {
        if (!this._folderView || !this._items.includes(folder))
            return;
        this._folderView.open(folder, Main.layoutManager.primaryMonitor);
        if (rename)
            this._folderView.beginRename();
    }

    // Apps go back to the grid where the folder was.
    _deleteFolder(folder) {
        const i = this._items.indexOf(folder);
        if (i < 0)
            return;
        if (this._folderView?.folder === folder)
            this._folderView.close();
        this._items.splice(i, 1, ...folder.apps.map(id => ({type: 'app', id})));
        this._commit();
    }

    _ensureFolderView(iconSize) {
        if (this._folderView)
            return;
        this._folderView = new KosFolderView({
            parent: this._actor,
            tileSize: this._tileSize,
            iconSize,
            makeTile: (id, folder) => {
                const [tw] = this._tileSize;
                const tile = this._makeIcon({type: 'app', id}, tw, iconSize, folder);
                tile?.set_size(...this._tileSize);
                return tile;
            },
            onRename: (folder, name) => {
                folder.name = name;
                this._commit();
            },
        });
    }

    // ---- drag and drop ---------------------------------------------------

    _dragOk(source) {
        return ['grid-app', 'grid-folder', 'folder-app', 'dock-app'].includes(source?.kind)
            ? DND.DragMotionResult.MOVE_DROP
            : DND.DragMotionResult.CONTINUE;
    }

    // Empty space: dnd.js calls these on the backdrop's _delegate (this).
    handleDragOver(source) {
        return this._dragOk(source);
    }

    acceptDrop(source) {
        if (this._dragOk(source) === DND.DragMotionResult.CONTINUE)
            return false;
        const [px, py] = global.get_pointer();
        this._place(source, this._cellIndexAt(px, py), null);
        return true;
    }

    // Grid index of the cell under a stage point (clamped to the list end).
    _cellIndexAt(px, py) {
        const m = this._m;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!m)
            return this._items.length;
        const col = clamp(Math.floor((px - monitor.x - m.left) / m.colW), 0, GRID_COLS - 1);
        const row = clamp(Math.floor((py - monitor.y - m.top) / m.rowH), 0, m.rows - 1);
        return Math.min(this._page * m.perPage + row * GRID_COLS + col, this._items.length);
    }

    _dropOnItem(source, target, x, y, tileW, iconSize) {
        if (this._dragOk(source) === DND.DragMotionResult.CONTINUE)
            return false;
        // The icon image is centered at the top of the tile, 8px down.
        const onIcon = Math.abs(x - tileW / 2) <= iconSize / 2 && y <= 8 + iconSize;
        const sameThing = source.item === target || source.folder === target ||
            (target.type === 'app' && source.appId === target.id && source.kind !== 'folder-app');
        if (sameThing)
            return false;
        if (onIcon && source.kind !== 'grid-folder')
            this._place(source, -1, target);
        else
            this._place(source, this._items.indexOf(target), null);
        return true;
    }

    // Move `source` to grid index `index`, or into `folderTarget` (an app
    // entry becomes a new folder; a folder entry gains the app).
    _place(source, index, folderTarget) {
        // Dock -> grid is a move: the app lands here and leaves the dock.
        // The layout is saved (in _commit) before the unpin runs, so the
        // reload the unpin triggers already sees it at this spot.
        if (source.kind === 'dock-app')
            later(() => unpin(source.appId));

        let entry;
        let removedAt = -1;
        if (source.kind === 'grid-folder') {
            removedAt = this._items.indexOf(source.folder);
            if (removedAt >= 0)
                this._items.splice(removedAt, 1);
            entry = source.folder;
        } else {
            removedAt = this._removeId(source.appId);
            entry = {type: 'app', id: source.appId};
        }

        if (folderTarget) {
            if (folderTarget.type === 'folder') {
                if (!folderTarget.apps.includes(entry.id))
                    folderTarget.apps.push(entry.id);
            } else {
                // Turn the target app entry into a folder in place.
                const first = folderTarget.id;
                delete folderTarget.id;
                Object.assign(folderTarget, {
                    type: 'folder',
                    fid: GLib.uuid_string_random(),
                    name: 'Folder',
                    apps: [first, entry.id],
                });
            }
        } else {
            if (removedAt >= 0 && removedAt < index)
                index--;
            index = clamp(index, 0, this._items.length);
            this._items.splice(index, 0, entry);
        }
        this._commit();
    }

    // Remove an app from the top level or from its folder. A folder left
    // with one app turns into that app in place. Returns the top-level
    // index it was removed from, or -1.
    _removeId(appId) {
        for (let i = 0; i < this._items.length; i++) {
            const e = this._items[i];
            if (e.type === 'app' && e.id === appId) {
                this._items.splice(i, 1);
                return i;
            }
            if (e.type === 'folder' && e.apps.includes(appId)) {
                e.apps = e.apps.filter(id => id !== appId);
                // Folders made from the right-click menu stay until deleted.
                if (e.keep)
                    return -1;
                if (e.apps.length === 1) {
                    const last = e.apps[0];
                    for (const k of ['fid', 'name', 'apps'])
                        delete e[k];
                    Object.assign(e, {type: 'app', id: last});
                } else if (e.apps.length === 0) {
                    this._items.splice(i, 1);
                    return i;
                }
                return -1;
            }
        }
        return -1;
    }

    _layoutDots(pages, wa, m) {
        this._dots.destroy_all_children();
        if (pages <= 1) {
            this._dots.visible = false;
            return;
        }
        this._dots.visible = true;
        this._dots.set_position(0, wa.h - m.padY - DOTS_HEIGHT);
        this._dots.set_size(wa.w, DOTS_HEIGHT);
        for (let i = 0; i < pages; i++) {
            const dot = new St.Button({
                style_class: i === this._page ? 'kos-page-dot active' : 'kos-page-dot',
                reactive: true,
                can_focus: true,
            });
            const page = i;
            dot.connect('clicked', () => this._setPage(page));
            this._dots.add_child(dot);
        }
    }

    _setPage(page) {
        const items = this._items;
        const {perPage} = this._metrics(this._workArea(), items.length);
        const pages = Math.max(1, Math.ceil(items.length / perPage));
        const next = Math.max(0, Math.min(pages - 1, page));
        if (next === this._page)
            return;
        this._page = next;
        this._layoutIcons();
    }

    _onScroll(_actor, event) {
        const dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
            this._setPage(this._page + 1);
        else if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
            this._setPage(this._page - 1);
        else
            return Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_STOP;
    }
}

function listDesktopFiles() {
    const seen = new Set();
    const files = [];
    const dataDirs = GLib.get_system_data_dirs().concat([GLib.get_user_data_dir()]);
    for (const dir of dataDirs) {
        const appsDir = Gio.File.new_for_path(`${dir}/applications`);
        if (!appsDir.query_exists(null))
            continue;
        let children;
        try {
            children = appsDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        } catch (_e) {
            continue;
        }
        let info;
        while ((info = children.next_file(null))) {
            const name = info.get_name();
            if (!name.endsWith('.desktop') || seen.has(name))
                continue;
            seen.add(name);
            files.push(name);
        }
    }
    files.sort();
    return files;
}

export function loadApp(id) {
    const info = Gio.DesktopAppInfo.new(id);
    if (!info || !info.should_show())
        return null;
    const app = Shell.AppSystem.get_default().lookup_app(id);
    return app || null;
}

function loadCuratedIds(extensionPath) {
    try {
        const file = Gio.File.new_for_path(`${extensionPath}/apps.txt`);
        const [, bytes] = file.load_contents(null);
        const text = new TextDecoder().decode(bytes);
        return text.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    } catch (_e) {
        return [];
    }
}

export function listHomeApps(extensionPath) {
    const ids = loadCuratedIds(extensionPath);
    const apps = [];
    const seen = new Set();
    for (const id of ids) {
        const app = loadApp(id);
        if (app && !seen.has(app.get_id())) {
            seen.add(app.get_id());
            apps.push(app);
        }
    }
    if (apps.length >= 8)
        return apps;
    for (const id of listDesktopFiles()) {
        if (seen.has(id))
            continue;
        const app = loadApp(id);
        if (app) {
            seen.add(id);
            apps.push(app);
        }
        if (apps.length >= 28)
            break;
    }
    return apps;
}

export function listAllVisibleApps() {
    const apps = [];
    const seen = new Set();
    for (const id of listDesktopFiles()) {
        const app = loadApp(id);
        if (app && !seen.has(app.get_id())) {
            seen.add(app.get_id());
            apps.push(app);
        }
    }
    apps.sort((a, b) => a.get_name().localeCompare(b.get_name()));
    return apps;
}

export function launchApp(app) {
    try {
        app.open_new_window(-1);
        return;
    } catch (_e) {
        // fall through
    }
    try {
        app.activate();
    } catch (e) {
        log(`kos-shell: failed to launch ${app.get_id()}: ${e}`);
    }
}

export const KosAllAppsOverlay = GObject.registerClass(
class KosAllAppsOverlay extends St.Widget {
    _init() {
        super._init({
            style_class: 'kos-all-apps-overlay',
            reactive: true,
            visible: false,
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._panel = new St.BoxLayout({
            vertical: true,
            style_class: 'kos-all-apps-panel',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title = new St.Label({
            text: 'All apps',
            style_class: 'kos-all-apps-title',
        });
        this._grid = new St.Widget({
            layout_manager: new Clutter.FlowLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                homogeneous: true,
            }),
        });
        this._panel.add_child(this._title);
        this._panel.add_child(this._grid);
        this.add_child(this._panel);
        this.connect('button-press-event', () => {
            this.hide();
            return Clutter.EVENT_STOP;
        });
    }

    toggle() {
        if (this.visible)
            this.hide();
        else
            this.showAll();
    }

    showAll() {
        this._grid.destroy_all_children();
        const apps = listAllVisibleApps();
        for (const app of apps) {
            const box = new St.BoxLayout({
                vertical: true,
                reactive: true,
                track_hover: true,
                style_class: 'kos-desktop-icon',
                width: 140,
            });
            box.add_child(new St.Icon({
                gicon: app.get_icon(),
                icon_size: ICON_SIZE,
                style_class: 'kos-desktop-icon-app',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            box.add_child(new St.Label({
                text: app.get_name(),
                style_class: 'kos-desktop-icon-label',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            box.connect('button-press-event', () => {
                launchApp(app);
                this.hide();
                return Clutter.EVENT_STOP;
            });
            this._grid.add_child(box);
        }
        this.visible = true;
        this.grab_key_focus();
    }
});
