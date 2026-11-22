// The center of the bottom bar is a macOS-style dock of pinned apps.
// Each item is a button (like an <button> with an <img>).
// A blue dot under the icon means the app has an open window (a running state).
// There is no "all apps" grid button — the desktop already shows every app.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

export const ALL_APPS_ID = 'kos-all-apps';

export class KosDock {
    constructor({onAllApps} = {}) {
        this._onAllApps = onAllApps;
        this._signals = [];
        this._actor = null;
    }

    enable() {
        this._actor = new St.BoxLayout({
            style_class: 'kos-dock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        this._rebuild();
        Main.panel._centerBox.add_child(this._actor);

        const fav = AppFavorites.getAppFavorites();
        this._connect(fav, 'changed', () => this._rebuild());
        this._connect(Shell.AppSystem.get_default(), 'app-state-changed', () => this._syncRunning());
    }

    disable() {
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        if (this._actor) {
            this._actor.destroy();
            this._actor = null;
        }
    }

    _connect(obj, signal, cb) {
        const id = obj.connect(signal, cb);
        this._signals.push([obj, id]);
        return id;
    }

    _rebuild() {
        if (!this._actor)
            return;
        this._actor.destroy_all_children();

        const favorites = AppFavorites.getAppFavorites().getFavorites();
        for (const app of favorites) {
            if (!app)
                continue;
            this._actor.add_child(new DockItem({
                app,
                onClick: () => this._activate(app),
            }));
        }

        this._syncRunning();
    }

    _activate(app) {
        // app.activate() focuses an existing window or launches a new one
        // (like clicking a dock icon on macOS).
        app.activate();
        Main.overview.hide();
    }

    _syncRunning() {
        if (!this._actor)
            return;
        for (const child of this._actor.get_children()) {
            if (typeof child.syncRunning === 'function')
                child.syncRunning();
        }
    }
}

const DockItem = GObject.registerClass(
class DockItem extends St.Button {
    _init({app = null, iconName = null, label = '', onClick = null} = {}) {
        super._init({
            style_class: 'kos-dock-item',
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE,
        });
        this._app = app;
        this._onClick = onClick;

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const icon = new St.Icon({style_class: 'kos-dock-item-icon'});
        if (app)
            icon.set_gicon(app.app_info.get_icon());
        else if (iconName)
            icon.icon_name = iconName;
        box.add_child(icon);

        this._dot = new St.Widget({
            style_class: 'kos-dock-dot',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._dot);

        this.set_child(box);
        this.tooltip_text = app ? app.get_name() : label;

        this.connect('clicked', () => this._onClick?.());
        this.syncRunning();
    }

    syncRunning() {
        const running = !!(this._app && this._app.get_n_windows() > 0);
        if (running)
            this._dot.add_style_class_name('running');
        else
            this._dot.remove_style_class_name('running');
    }
});
