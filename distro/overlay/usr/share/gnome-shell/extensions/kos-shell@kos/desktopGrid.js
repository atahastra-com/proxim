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

export const GRID_COLS = 7;
export const ICON_SIZE = 80;
export const LABEL_HEIGHT = 22;
export const CELL_HEIGHT = 118;
export const SIDE_PAD = 48;
export const GRID_PAD_Y = 32;
export const DOTS_HEIGHT = 24;
export const DOTS_BOTTOM = 16;

export class KosDesktopGrid {
    constructor({extensionPath} = {}) {
        this._extensionPath = extensionPath;
        this._signals = [];
        this._actor = null;
        this._backdrop = null;
        this._dots = null;
        this._page = 0;
        this._apps = [];
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
        this._actor.add_child(this._backdrop);

        this._dots = new St.BoxLayout({
            style_class: 'kos-page-dots',
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._actor.add_child(this._dots);

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
        this._connect(this._actor, 'notify::allocation', () => this._logAllocation());
    }

    disable() {
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
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
        this._apps = listHomeApps(this._extensionPath);
        if (this._page < 0)
            this._page = 0;
        this._layout();
    }

    _workArea() {
        const monitor = Main.layoutManager.primaryMonitor;
        const panelH = (Main.panel && Main.panel.height) ? Main.panel.height : 56;
        return {
            x: monitor.x,
            y: monitor.y,
            w: monitor.width,
            h: monitor.height - panelH,
        };
    }

    _layout() {
        const wa = this._workArea();
        this._actor.set_position(wa.x, wa.y);
        this._actor.set_size(wa.w, wa.h);
        this._backdrop.set_position(0, 0);
        this._backdrop.set_size(wa.w, wa.h);
        this._raise();
        this._layoutIcons();
    }

    _pageMetrics(wa, appCount) {
        // Leave room for page dots; center the used rows in the leftover band.
        const topLimit = GRID_PAD_Y;
        const bottomLimit = wa.h - DOTS_BOTTOM - DOTS_HEIGHT;
        const band = Math.max(CELL_HEIGHT, bottomLimit - topLimit);
        const rowsFit = Math.max(1, Math.floor(band / CELL_HEIGHT));
        const perPage = GRID_COLS * rowsFit;
        const count = appCount !== undefined ? appCount : this._apps.length;
        const onPage = Math.min(perPage, Math.max(0, count));
        const usedRows = Math.max(1, Math.ceil(onPage / GRID_COLS) || 1);
        const usedH = usedRows * CELL_HEIGHT;
        const gridTop = topLimit + Math.max(0, Math.floor((band - usedH) / 2));
        return {gridTop, rows: rowsFit, perPage, usedRows};
    }

    _layoutIcons() {
        if (!this._actor)
            return;

        // Drop previous icon actors; keep backdrop and dots.
        const keep = new Set([this._backdrop, this._dots]);
        for (const child of this._actor.get_children()) {
            if (!keep.has(child))
                child.destroy();
        }

        const wa = this._workArea();
        const apps = this._apps;
        const {gridTop, rows, perPage} = this._pageMetrics(wa, apps.length);
        const pages = Math.max(1, Math.ceil(apps.length / perPage));
        if (this._page >= pages)
            this._page = pages - 1;

        const slotW = (wa.w - 2 * SIDE_PAD) / GRID_COLS;
        const start = this._page * perPage;
        const pageApps = apps.slice(start, start + perPage);

        pageApps.forEach((app, i) => {
            const col = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);
            const x = Math.round(SIDE_PAD + col * slotW);
            const y = gridTop + row * CELL_HEIGHT;
            const icon = this._makeIcon(app, Math.round(slotW));
            icon.set_position(x, y);
            icon.set_size(Math.round(slotW), CELL_HEIGHT);
            this._actor.add_child(icon);
        });

        this._layoutDots(pages, wa);
        log(`kos-shell: launchpad ${apps.length} apps, page ${this._page + 1}/${pages}, ${rows} rows x ${GRID_COLS} cols`);
        if (pageApps.length)
            log(`kos-shell: first-icon center ${Math.round(wa.x + SIDE_PAD + slotW / 2)},${Math.round(wa.y + gridTop + ICON_SIZE / 2)}`);
    }

    _makeIcon(app, width) {
        const box = new St.BoxLayout({
            vertical: true,
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
        });

        // No tile box: icon and label are both centered in the cell.
        const gicon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: ICON_SIZE,
            style_class: 'kos-desktop-icon-app',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const label = new St.Label({
            text: app.get_name(),
            style_class: 'kos-desktop-icon-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        // St.Label x_align centers the actor; the text inside a full-width
        // label still defaults to left, so set Pango alignment explicitly.
        const ct = label.clutter_text;
        ct.ellipsize = Pango.EllipsizeMode.END;
        ct.line_wrap = true;
        ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        ct.line_alignment = Pango.Alignment.CENTER;
        label.set_width(width - 8);

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
        button.connect('clicked', () => launchApp(app));
        return button;
    }

    _layoutDots(pages, wa) {
        this._dots.destroy_all_children();
        if (pages <= 1) {
            this._dots.visible = false;
            return;
        }
        this._dots.visible = true;
        this._dots.set_position(0, wa.h - DOTS_BOTTOM - DOTS_HEIGHT);
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
        const apps = this._apps;
        const {perPage} = this._pageMetrics(this._workArea(), apps.length);
        const pages = Math.max(1, Math.ceil(apps.length / perPage));
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

function loadApp(id) {
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
