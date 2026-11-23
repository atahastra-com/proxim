// The center of the bottom bar is a macOS-style dock of pinned favorites
// plus any currently running non-pinned apps (after a subtle divider).
// A blue dot under the icon means the app has an open window.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

import {DND, appIcon, getPins, later, makeDraggableIcon, pinAt} from './folders.js';

export class KosDock {
    constructor() {
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
        // Drop target: a grid icon dropped here is pinned at that spot; a
        // dock icon dropped here moves. dnd.js finds this via _delegate.
        this._actor._delegate = this;
        // The whole bottom bar accepts the drop too (clock, gaps, status
        // area, edges): dnd.js walks up from the actor under the pointer, and
        // the clock and status buttons have no drop handlers of their own.
        this._panelHadDelegate = '_delegate' in Main.panel;
        this._panelDelegate = Main.panel._delegate;
        Main.panel._delegate = this;
        this._rebuild();
        Main.panel._centerBox.add_child(this._actor);

        const fav = AppFavorites.getAppFavorites();
        const appsys = Shell.AppSystem.get_default();
        const tracker = Shell.WindowTracker.get_default();
        this._connect(fav, 'changed', () => this._rebuild());
        this._connect(appsys, 'app-state-changed', () => this._rebuild());
        this._connect(tracker, 'notify::focus-app', () => this._syncRunning());
    }

    disable() {
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        if (Main.panel._delegate === this) {
            if (this._panelHadDelegate)
                Main.panel._delegate = this._panelDelegate;
            else
                delete Main.panel._delegate;
        }
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
        const pinnedIds = new Set();
        for (const app of favorites) {
            if (!app)
                continue;
            pinnedIds.add(app.get_id());
            this._actor.add_child(this._makeItem(app, true));
        }

        // Also show open apps that aren't pinned, so you can always get
        // back to them with one click even without the Activities overview.
        const runningExtras = Shell.AppSystem.get_default()
            .get_running()
            .filter(app => app && !pinnedIds.has(app.get_id()) && app.get_n_windows() > 0);

        if (runningExtras.length > 0 && pinnedIds.size > 0) {
            this._actor.add_child(new St.Widget({
                style_class: 'kos-dock-separator',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        for (const app of runningExtras)
            this._actor.add_child(this._makeItem(app, false));

        this._syncRunning();
    }

    _makeItem(app, pinned) {
        const item = new DockItem({
            app,
            onClick: () => this._activate(app),
        });
        item.pinned = pinned;
        makeDraggableIcon(item, {kind: 'dock-app', appId: app.get_id()},
            () => appIcon(app.get_id(), 42), item._kosIcon);
        Object.assign(item._delegate, {
            handleDragOver: src => this.handleDragOver(src),
            acceptDrop: src => this.acceptDrop(src),
        });
        return item;
    }

    handleDragOver(source) {
        return source?.appId && ['grid-app', 'folder-app', 'dock-app'].includes(source.kind)
            ? DND.DragMotionResult.MOVE_DROP
            : DND.DragMotionResult.CONTINUE;
    }

    // Pin (or move) the app to the slot under the pointer: before the first
    // pinned icon whose center is right of the pointer. The grid drops a
    // newly pinned app itself when favorite-apps changes (one place only).
    acceptDrop(source) {
        if (this.handleDragOver(source) === DND.DragMotionResult.CONTINUE)
            return false;
        const [px] = global.get_pointer();
        const pinnedItems = this._actor.get_children().filter(c => c.pinned);
        let pos = pinnedItems.findIndex(c => {
            const [x] = c.get_transformed_position();
            return px < x + c.width / 2;
        });
        if (pos < 0)
            pos = pinnedItems.length;
        // Moving right past its own slot: the slot shifts once it's removed.
        const current = getPins().indexOf(source.appId);
        if (current >= 0 && current < pos)
            pos--;
        later(() => pinAt(source.appId, pos));
        return true;
    }

    _activate(app) {
        // Focus an existing window (unminimizing if needed) or launch it.
        const windows = app.get_windows();
        if (windows.length > 0) {
            const focused = Shell.WindowTracker.get_default().focus_app === app;
            if (focused && windows.length === 1 && windows[0].can_minimize()) {
                windows[0].minimize();
            } else {
                app.activate();
            }
        } else {
            app.activate();
        }
        Main.overview.hide();
    }

    _syncRunning() {
        if (!this._actor)
            return;
        const focusApp = Shell.WindowTracker.get_default().focus_app;
        for (const child of this._actor.get_children()) {
            if (typeof child.syncRunning === 'function')
                child.syncRunning(focusApp);
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
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            button_mask: St.ButtonMask.ONE,
        });
        this._app = app;
        this._onClick = onClick;

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const icon = this._kosIcon = new St.Icon({
            style_class: 'kos-dock-item-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const gicon = app ? (app.get_icon() || app.app_info?.get_icon()) : null;
        if (gicon)
            icon.set_gicon(gicon);
        else if (iconName)
            icon.icon_name = iconName;
        else
            icon.icon_name = 'application-x-executable-symbolic';
        box.add_child(icon);

        this._dot = new St.Widget({
            style_class: 'kos-dock-dot',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._dot);

        this.set_child(box);
        this.tooltip_text = app ? app.get_name() : label;

        this.connect('clicked', () => this._onClick?.());
        this.syncRunning(null);
    }

    syncRunning(focusApp) {
        const running = !!(this._app && this._app.get_n_windows() > 0);
        const focused = !!(running && focusApp && this._app === focusApp);
        if (running)
            this._dot.add_style_class_name('running');
        else
            this._dot.remove_style_class_name('running');

        if (focused)
            this.add_style_class_name('focused');
        else
            this.remove_style_class_name('focused');
    }
});
