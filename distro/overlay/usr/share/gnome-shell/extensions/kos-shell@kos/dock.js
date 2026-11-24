// The center of the bottom bar is a macOS-style dock of pinned favorites
// plus any currently running non-pinned apps (after a subtle divider).
// A blue dot under the icon means the app has an open window.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

import {DND, appIcon, getPins, later, makeDraggableIcon, pinAt} from './folders.js';
import {squircleGIcon} from './icons.js';
import {BOUNCE_MS, DOT_FADE_MS, easeOutCubic, stop, tween} from './anim.js';

// Hover magnification is a scale transform, not a size reflow, so the
// bar width never jumps. Only the hovered icon scales up; we load the
// texture at HOVER_PX and scale down to ICON_SIZE at rest so enlarging
// to hover is 1:1 native resolution (never blurry).
const ICON_SIZE = 52;
const HOVER_SCALE = 1.25;
const HOVER_PX = Math.round(ICON_SIZE * HOVER_SCALE);
const REST_SCALE = ICON_SIZE / HOVER_PX;
const PIVOT_Y = 0.75;
const GROW_MS = 220;
const SHRINK_MS = 180;
const LABEL_DELAY_MS = 120;

// Hover zoom and the launch bounce go through anim.js (GLib timer),
// because actor.ease() would snap with enable-animations=false.

let _dock = null;

// Stage-space center of the dock icon for this app, used to minimize
// windows toward the icon. Null if the app is not in the dock yet.
export function dockIconCenter(app) {
    if (!app || !_dock)
        return null;
    const item = _dock._items().find(c => c._app === app);
    const icon = item?._kosIcon || item;
    if (!icon || typeof icon.get_transformed_position !== 'function')
        return null;
    try {
        const [x, y] = icon.get_transformed_position();
        const [w, h] = icon.get_transformed_size();
        return {x: x + w / 2, y: y + h / 2, w, h};
    } catch (_e) {
        return null;
    }
}

export class KosDock {
    constructor() {
        this._signals = [];
        this._actor = null;
        this._label = null;
        this._labelTimeout = 0;
        this._rebuildIdleId = 0;
        this._labelItem = null;
        this._clipRestore = null;
        this._dragZoom = false;
        this._visible = true;
    }

    enable() {
        _dock = this;
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
        this._unclipForZoom();
        this._ensureLabel();
        this._connect(this._actor, 'notify::hover', () => {
            if (!this._actor?.hover)
                this._updateZoom();
        });

        const fav = AppFavorites.getAppFavorites();
        const appsys = Shell.AppSystem.get_default();
        const tracker = Shell.WindowTracker.get_default();
        this._connect(fav, 'changed', () => this._scheduleRebuild());
        this._connect(appsys, 'app-state-changed', () => this._scheduleRebuild());
        this._connect(tracker, 'notify::focus-app', () => this._syncRunning());
    }

    // Hidden on the lock screen (the bar itself stays for status icons).
    setVisible(visible) {
        this._visible = visible;
        if (this._actor)
            this._actor.visible = visible;
        if (!visible) {
            this._resetZoom(true);
            this._hideLabel();
        }
    }

    disable() {
        if (_dock === this)
            _dock = null;
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        if (Main.panel._delegate === this) {
            if (this._panelHadDelegate)
                Main.panel._delegate = this._panelDelegate;
            else
                delete Main.panel._delegate;
        }
        if (this._rebuildIdleId) {
            GLib.source_remove(this._rebuildIdleId);
            this._rebuildIdleId = 0;
        }
        this._labelItem = null;
        if (this._labelTimeout) {
            GLib.source_remove(this._labelTimeout);
            this._labelTimeout = 0;
        }
        if (this._label) {
            this._label.destroy();
            this._label = null;
        }
        this._restoreClip();
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

    _scheduleRebuild() {
        if (this._rebuildIdleId || !this._actor)
            return;
        this._rebuildIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildIdleId = 0;
            if (this._actor)
                this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        if (!this._actor)
            return;
        this._hideLabel();
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
        const draggable = makeDraggableIcon(item, {kind: 'dock-app', appId: app.get_id()},
            () => appIcon(app.get_id(), 42), item._kosIcon);
        Object.assign(item._delegate, {
            handleDragOver: src => this.handleDragOver(src),
            acceptDrop: src => this.acceptDrop(src),
        });
        // These die with the item on rebuild; don't store them on the dock.
        item.connect('notify::hover', () => this._updateZoom());
        draggable.connect('drag-begin', () => {
            this._dragZoom = true;
            this._resetZoom(true);
            this._hideLabel();
        });
        const endDrag = () => {
            this._dragZoom = false;
            this._updateZoom();
        };
        draggable.connect('drag-end', endDrag);
        draggable.connect('drag-cancelled', endDrag);
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
        this._bounce(app);
    }

    _bounce(app) {
        const item = this._items().find(c => c._app === app);
        item?.bounce?.();
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

    _items() {
        return this._actor
            ? this._actor.get_children().filter(c => typeof c.setZoom === 'function')
            : [];
    }

    _updateZoom() {
        if (!this._actor || this._dragZoom || this._visible === false) {
            this._resetZoom(true);
            this._hideLabel();
            return;
        }
        const items = this._items();
        const hovered = items.findIndex(c => c.hover);
        for (let i = 0; i < items.length; i++) {
            const scale = i === hovered ? 1 : REST_SCALE;
            items[i].setZoom(scale);
            items[i].z_position = i === hovered ? 2 : 0;
        }
        if (hovered >= 0)
            this._showLabel(items[hovered]);
        else
            this._hideLabel();
    }

    _resetZoom(snap = false) {
        for (const item of this._items()) {
            item.setZoom(REST_SCALE, snap);
            item.z_position = 0;
        }
    }

    // Scale is a paint transform, so overflowing icons must not be clipped
    // by the dock, the 72px bar, or panelBox.
    _unclipForZoom() {
        if (this._clipRestore)
            return;
        this._clipRestore = [];
        let actor = this._actor;
        while (actor) {
            this._clipRestore.push([actor, actor.clip_to_allocation]);
            actor.clip_to_allocation = false;
            actor = actor.get_parent();
        }
    }

    _restoreClip() {
        for (const [actor, value] of this._clipRestore || []) {
            try {
                actor.clip_to_allocation = value;
            } catch (_e) {
                // actor already destroyed
            }
        }
        this._clipRestore = null;
    }

    _ensureLabel() {
        if (this._label)
            return;
        this._label = new St.Label({
            style_class: 'kos-dock-tooltip',
            opacity: 0,
            visible: false,
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        Main.layoutManager.uiGroup.add_child(this._label);
    }

    _showLabel(item) {
        const name = item._app ? item._app.get_name() : '';
        if (!name || !this._label)
            return;
        if (this._labelItem === item && this._label.visible && this._label.opacity > 0)
            return;
        this._labelItem = item;
        if (this._labelTimeout) {
            GLib.source_remove(this._labelTimeout);
            this._labelTimeout = 0;
        }
        this._label.text = name;
        this._labelTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LABEL_DELAY_MS, () => {
            this._labelTimeout = 0;
            if (this._labelItem !== item || !this._label)
                return GLib.SOURCE_REMOVE;
            this._label.opacity = 255;
            this._label.show();
            this._placeLabel(item);
            return GLib.SOURCE_REMOVE;
        });
    }

    _placeLabel(item) {
        const slot = item._kosSlot || item._kosIcon;
        const label = this._label;
        if (!slot || !label)
            return;
        label.set_size(-1, -1);
        const [, natW] = label.get_preferred_width(-1);
        const [, natH] = label.get_preferred_height(-1);
        const [ix, iy] = slot.get_transformed_position();
        const visualTop = iy - (HOVER_PX - ICON_SIZE) * PIVOT_Y;
        const cx = ix + ICON_SIZE / 2;
        const x = Math.round(cx - natW / 2);
        const y = Math.round(visualTop - 10 - natH);
        label.set_position(x, y);
    }

    _hideLabel() {
        this._labelItem = null;
        if (this._labelTimeout) {
            GLib.source_remove(this._labelTimeout);
            this._labelTimeout = 0;
        }
        if (!this._label)
            return;
        this._label.opacity = 0;
        this._label.hide();
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

        const gicon = app ? (app.get_icon() || app.app_info?.get_icon()) : null;
        const fallbackName = gicon ? null : (iconName || 'application-x-executable');
        const baked = squircleGIcon(gicon, fallbackName, HOVER_PX) ||
            squircleGIcon(null, 'application-x-executable', HOVER_PX);
        const icon = this._kosIcon = new St.Icon({
            gicon: baked || gicon,
            icon_name: baked || gicon ? null : fallbackName,
            fallback_icon_name: 'application-x-executable',
            icon_size: HOVER_PX,
            style_class: 'kos-dock-item-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        icon.set_pivot_point(0.5, PIVOT_Y);
        icon.set_scale(REST_SCALE, REST_SCALE);
        this._zoomTarget = REST_SCALE;

        // Fixed 52x52 slot so the dock never reflows while the 65px icon scales.
        const slot = this._kosSlot = new St.Widget({
            width: ICON_SIZE,
            height: ICON_SIZE,
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        slot.add_child(icon);

        this.clip_to_allocation = false;
        box.clip_to_allocation = false;
        icon.clip_to_allocation = false;
        box.add_child(slot);

        this._dot = new St.Widget({
            style_class: 'kos-dock-dot',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._dot);

        this.set_child(box);
        // Name label is drawn above the magnified icon by KosDock; a
        // built-in tooltip would sit on the unscaled slot and overlap.

        this.connect('clicked', () => this._onClick?.());
        this.connect('destroy', () => this._stopZoomAnim());
        this.syncRunning(null);
    }

    syncRunning(focusApp) {
        const running = !!(this._app && this._app.get_n_windows() > 0);
        const focused = !!(running && focusApp && this._app === focusApp);
        const wasRunning = this._dot.has_style_class_name('running');
        if (running)
            this._dot.add_style_class_name('running');
        else
            this._dot.remove_style_class_name('running');

        if (focused)
            this.add_style_class_name('focused');
        else
            this.remove_style_class_name('focused');

        if (running !== wasRunning) {
            if (running) {
                this._dot.opacity = 0;
                tween(this._dot, {opacity: 255, duration: DOT_FADE_MS, easing: easeOutCubic});
            } else if (wasRunning) {
                tween(this._dot, {opacity: 0, duration: DOT_FADE_MS - 40, easing: easeOutCubic});
            }
        }
    }

    // Animate from the current scale so moving across icons just retargets.
    setZoom(scale, snap = false) {
        if (!this._kosIcon)
            return;
        if (!snap && this._zoomTarget === scale)
            return;
        this._zoomTarget = scale;
        const icon = this._kosIcon;
        if (snap) {
            stop(icon);
            icon.set_scale(scale, scale);
            return;
        }
        const from = icon.scale_x || REST_SCALE;
        if (Math.abs(scale - from) < 0.001) {
            stop(icon);
            icon.set_scale(scale, scale);
            return;
        }
        const duration = scale > from + 0.001 ? GROW_MS : SHRINK_MS;
        tween(icon, {scale, duration, easing: easeOutCubic});
    }

    // A short upward pulse when the app is launched or focused from the dock.
    bounce() {
        if (!this._kosIcon)
            return;
        const base = this._zoomTarget ?? REST_SCALE;
        const peak = Math.min(1, Math.max(base * 1.14, base + 0.08));
        this._zoomTarget = peak;
        tween(this._kosIcon, {
            scale: peak,
            duration: BOUNCE_MS,
            easing: easeOutCubic,
            onComplete: () => this.setZoom(base),
        });
    }

    _stopZoomAnim() {
        stop(this._kosIcon);
    }
});
