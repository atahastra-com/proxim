// Launchpad-style home screen: a 7-column grid of large app icons with
// labels, a rounded search field at the top, and page dots when the apps
// don't fit on one page. Icons sit directly on a dimmed (and, when the
// GPU allows, blurred) wallpaper — no tile boxes, no wordmark behind them.
//
// The grid lives in the wallpaper group, behind open windows (like
// position:absolute icons on a <body> background). The full-width bottom
// bar is left alone; this file only draws the desktop.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const GRID_COLS = 7;
export const ICON_SIZE = 80;
export const LABEL_HEIGHT = 22;
export const CELL_HEIGHT = 118;
export const SIDE_PAD = 48;
export const SEARCH_TOP = 28;
export const SEARCH_HEIGHT = 28;
export const SEARCH_TO_GRID = 28;
export const DOTS_HEIGHT = 24;
export const DOTS_BOTTOM = 16;

export class KosDesktopGrid {
    constructor({extensionPath} = {}) {
        this._extensionPath = extensionPath;
        this._signals = [];
        this._actor = null;
        this._backdrop = null;
        this._search = null;
        this._dots = null;
        this._stageId = 0;
        this._keyId = 0;
        this._page = 0;
        this._filter = '';
        this._apps = [];
        this.iconBounds = [];
    }

    enable() {
        this._actor = new St.Widget({
            name: 'kos-desktop-grid',
            style_class: 'kos-desktop-grid',
            layout_manager: new Clutter.BinLayout(),
            // The container itself is not reactive — a fullscreen reactive
            // actor (especially one with a blur effect) can end up painted
            // and picked above application windows. Icons and the search
            // field opt into clicks individually.
            reactive: false,
            x_expand: true,
            y_expand: true,
        });

        this._backdrop = new St.Widget({
            style_class: 'kos-launchpad-dim',
            reactive: false,
            x_expand: true,
            y_expand: true,
        });
        this._actor.add_child(this._backdrop);

        this._search = new St.Entry({
            style_class: 'kos-search',
            hint_text: 'Search',
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });
        this._search.clutter_text.connect('text-changed', () => {
            this._filter = this._search.get_text().trim().toLowerCase();
            this._page = 0;
            this._layoutIcons();
        });
        this._actor.add_child(this._search);

        this._dots = new St.BoxLayout({
            style_class: 'kos-page-dots',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            visible: false,
        });
        this._actor.add_child(this._dots);

        Main.layoutManager._backgroundGroup.add_child(this._actor);

        this._rebuild();

        const appsys = Shell.AppSystem.get_default();
        this._connect(appsys, 'installed-changed', () => this._rebuild());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._rebuild());
        this._connect(Main.layoutManager, 'startup-complete', () => this._rebuild());

        this._stageId = global.stage.connect('button-press-event', this._onStageClick.bind(this));
        this._keyId = global.stage.connect('key-press-event', this._onStageKey.bind(this));
        this._actor.connect('scroll-event', this._onScroll.bind(this));
    }

    disable() {
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        if (this._stageId) {
            global.stage.disconnect(this._stageId);
            this._stageId = 0;
        }
        if (this._keyId) {
            global.stage.disconnect(this._keyId);
            this._keyId = 0;
        }
        if (this._actor) {
            this._actor.destroy();
            this._actor = null;
        }
        this._backdrop = null;
        this._search = null;
        this._dots = null;
        this.iconBounds = [];
    }

    _connect(obj, signal, cb) {
        const id = obj.connect(signal, cb);
        this._signals.push([obj, id]);
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

        this._search.set_size(240, SEARCH_HEIGHT);
        this._search.set_position(Math.round((wa.w - 240) / 2), SEARCH_TOP);

        this._layoutIcons();
    }

    _filteredApps() {
        if (!this._filter)
            return this._apps;
        return this._apps.filter(app => {
            const name = (app.get_name() || '').toLowerCase();
            return name.includes(this._filter);
        });
    }

    _pageMetrics(wa) {
        const gridTop = SEARCH_TOP + SEARCH_HEIGHT + SEARCH_TO_GRID;
        const gridBottom = wa.h - DOTS_BOTTOM - DOTS_HEIGHT;
        const gridH = Math.max(CELL_HEIGHT, gridBottom - gridTop);
        const rows = Math.max(1, Math.floor(gridH / CELL_HEIGHT));
        const perPage = GRID_COLS * rows;
        return {gridTop, gridBottom, rows, perPage};
    }

    _layoutIcons() {
        if (!this._actor)
            return;

        // Drop previous icon actors; keep backdrop, search, and dots.
        const keep = new Set([this._backdrop, this._search, this._dots]);
        for (const child of this._actor.get_children()) {
            if (!keep.has(child))
                child.destroy();
        }
        this.iconBounds = [];

        const wa = this._workArea();
        const apps = this._filteredApps();
        const {gridTop, rows, perPage} = this._pageMetrics(wa);
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
            this._actor.add_child(icon);

            // Use the work area, not get_transformed_position(): at layout
            // time the actor may not have a stage transform yet, which
            // produced NaN bounds and made clicks miss every icon.
            this.iconBounds.push({
                app,
                x: wa.x + x,
                y: wa.y + y,
                w: Math.round(slotW),
                h: CELL_HEIGHT,
            });
        });

        this._layoutDots(pages, wa);
        log(`kos-shell: launchpad ${apps.length} apps, page ${this._page + 1}/${pages}, ${rows} rows x ${GRID_COLS} cols`);
        if (this.iconBounds[0])
            log(`kos-shell: first-icon center ${Math.round(this.iconBounds[0].x + this.iconBounds[0].w / 2)},${Math.round(this.iconBounds[0].y + ICON_SIZE / 2)}`);
    }

    _makeIcon(app, width) {
        const box = new St.BoxLayout({
            vertical: true,
            reactive: true,
            track_hover: true,
            can_focus: true,
            style_class: 'kos-desktop-icon',
            x_align: Clutter.ActorAlign.CENTER,
            width,
        });

        // No tile box: just the app's own icon, larger, on the wallpaper.
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
        label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        label.clutter_text.set_line_wrap(false);
        label.set_width(width);

        box.add_child(gicon);
        box.add_child(label);
        box._kosApp = app;
        box.connect('button-press-event', (_a, event) => {
            if (event.get_button() === 1) {
                launchApp(app);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return box;
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
        const apps = this._filteredApps();
        const {perPage} = this._pageMetrics(this._workArea());
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

    _frontWindowAt(x, y) {
        const windows = global.get_window_actors();
        for (let i = windows.length - 1; i >= 0; i--) {
            const actor = windows[i];
            if (!actor.visible)
                continue;
            const win = actor.meta_window;
            if (!win || win.minimized)
                continue;
            if (win.get_window_type() !== Meta.WindowType.NORMAL)
                continue;
            if (x >= actor.x && x <= actor.x + actor.width &&
                y >= actor.y && y <= actor.y + actor.height)
                return win;
        }
        return null;
    }

    _inSearch(x, y) {
        if (!this._search)
            return false;
        const [sx, sy] = this._search.get_transformed_position();
        const sw = this._search.width;
        const sh = this._search.height;
        return x >= sx && x <= sx + sw && y >= sy && y <= sy + sh;
    }

    _onStageClick(_stage, event) {
        const [x, y] = event.get_coords();
        if (this._frontWindowAt(x, y))
            return Clutter.EVENT_PROPAGATE;
        if (Main.overview && Main.overview.visible)
            return Clutter.EVENT_PROPAGATE;
        if (Main.panel && y >= Main.layoutManager.primaryMonitor.height - (Main.panel.height || 56))
            return Clutter.EVENT_PROPAGATE;
        if (this._inSearch(x, y))
            return Clutter.EVENT_PROPAGATE;

        for (const b of this.iconBounds) {
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                launchApp(b.app);
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // When the desktop is in front, typing goes into the search field
    // (Launchpad-style filter-as-you-type). Leave keys alone if a window
    // or the overview has the user's attention.
    _onStageKey(_stage, event) {
        if (Main.overview && Main.overview.visible)
            return Clutter.EVENT_PROPAGATE;

        const focusWin = global.display.focus_window;
        if (focusWin && focusWin.get_window_type() === Meta.WindowType.NORMAL)
            return Clutter.EVENT_PROPAGATE;

        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            if (this._filter) {
                this._search.set_text('');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        if (symbol === Clutter.KEY_Left) {
            this._setPage(this._page - 1);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Right) {
            this._setPage(this._page + 1);
            return Clutter.EVENT_STOP;
        }

        const clutterText = this._search.clutter_text;
        if (global.stage.get_key_focus() === clutterText)
            return Clutter.EVENT_PROPAGATE;

        const ch = String.fromCodePoint(event.get_key_unicode());
        if (!ch || !ch.trim())
            return Clutter.EVENT_PROPAGATE;

        global.stage.set_key_focus(clutterText);
        this._search.set_text((this._search.get_text() || '') + ch);
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
