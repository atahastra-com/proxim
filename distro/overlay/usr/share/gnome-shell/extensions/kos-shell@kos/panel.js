// The GNOME top bar is a fixed header (position:fixed; top:0; width:100%).
// We restyle it as a fixed footer: same element, new place, new child order.
//
// Main.panel is the bar. It has three flex-like boxes:
//   _leftBox, _centerBox, _rightBox  — think display:flex; justify-content:space-between
// Stock GNOME 48: Activities on the left, clock in the center, Quick Settings on the right.
// kos: clock on the left, dock in the center, and GNOME's stock system
// status cluster (network/volume/power) left alone on the right.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import {easeOutCubic, hookBoxPointer, stop, tween, unhookBoxPointer} from './anim.js';

export const PANEL_HEIGHT = 72;
// The calendar (clock, left) and quick settings (right) popups float as
// mirror images: the same gap above the bar and the same inset from their
// screen edge, no arrow.
export const POPUP_GAP = 12;
export const POPUP_INSET = 12;

const SETTINGS_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'kos', 'settings.json']);
const _autoHideListeners = new Set();

export function getAutoHideDock() {
    try {
        if (!GLib.file_test(SETTINGS_PATH, GLib.FileTest.IS_REGULAR))
            return false;
        const [, bytes] = Gio.File.new_for_path(SETTINGS_PATH).load_contents(null);
        const obj = JSON.parse(new TextDecoder().decode(bytes));
        return Boolean(obj?.autoHideDock);
    } catch (_e) {
        return false;
    }
}

export function setAutoHideDock(enabled) {
    const val = Boolean(enabled);
    try {
        const dir = GLib.path_get_dirname(SETTINGS_PATH);
        GLib.mkdir_with_parents(dir, 0o755);
        let obj = {};
        if (GLib.file_test(SETTINGS_PATH, GLib.FileTest.IS_REGULAR)) {
            const [, bytes] = Gio.File.new_for_path(SETTINGS_PATH).load_contents(null);
            obj = JSON.parse(new TextDecoder().decode(bytes)) || {};
        }
        obj.autoHideDock = val;
        GLib.file_set_contents(SETTINGS_PATH, JSON.stringify(obj, null, 2) + '\n');
    } catch (e) {
        logError(e, 'kos-shell: saving settings.json');
    }
    for (const cb of _autoHideListeners)
        cb(val);
}

export class KosPanel {
    constructor({extensionPath} = {}) {
        this._extensionPath = extensionPath ?? null;
        this._signals = [];
        this._statusIconSignals = [];
        this._movedDateMenu = false;
        this._blurEffect = null;
    }

    enable() {
        Main.panel.add_style_class_name('kos-panel');

        this._menuBlurs = [];
        this._enableBlur();
        this._placePopups();
        this._hideActivities();
        this._disableHotCorners();
        this._moveDateMenuToLeft();
        this._movePanelToBottom();
        this._applyStatusIcons();
        this._initAutoHide();

        // Re-run layout when monitors change or the bar is reallocated
        // (like a resize listener on window.resize).
        this._connect(Main.layoutManager, 'monitors-changed', () => this._movePanelToBottom());
        // workareas-changed lives on global.display, not on LayoutManager.
        this._connect(global.display, 'workareas-changed', () => this._movePanelToBottom());
        this._connect(Main.layoutManager, 'startup-complete', () => {
            this._hideActivities();
            this._disableHotCorners();
            this._movePanelToBottom();
        });
        this._connect(Main.layoutManager.panelBox, 'notify::allocation', () => this._movePanelToBottom());
        this._connect(Main.panel, 'notify::height', () => this._movePanelToBottom());
        // Locking and unlocking rebuilds the stock panel for the new session
        // mode (clock back to the center, Activities back on the left).
        // GNOME's own handler runs first; put the kos layout back after it.
        this._connect(Main.sessionMode, 'updated', () => {
            this._hideActivities();
            this._disableHotCorners();
            this._moveDateMenuToLeft();
            this._movePanelToBottom();
            this._applyStatusIcons();
        });
    }

    disable() {
        this._destroyAutoHide();
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];

        this._restoreStatusIcons();
        this._disableBlur();
        this._restorePopups();
        this._restoreDateMenu();
        this._restorePanel();
        Main.panel.remove_style_class_name('kos-panel');

        if (Main.panel.statusArea.activities)
            Main.panel.statusArea.activities.container.show();
    }

    _connect(obj, signal, cb) {
        const id = obj.connect(signal, cb);
        this._signals.push([obj, id]);
        return id;
    }

    // Real frosted-glass background blur behind the bottom dock bar & popovers.
    _enableBlur() {
        const addBlur = (actor, radius, brightness) => {
            if (!actor)
                return null;
            try {
                const effect = new Shell.BlurEffect({
                    mode: Shell.BlurMode.BACKGROUND,
                    brightness,
                });
                if ('radius' in effect)
                    effect.radius = radius;
                else if ('sigma' in effect)
                    effect.sigma = radius;
                actor.add_effect(effect);
                return [actor, effect];
            } catch (_e) {
                return null;
            }
        };

        // Liquid Glass bar & popovers: strong blur with high luminosity so
        // wallpaper light and color refract through the glass cleanly.
        if (!this._blurEffect) {
            const pair = addBlur(Main.panel, 48, 0.84);
            if (pair)
                this._blurEffect = pair[1];
        }
        for (const area of ['dateMenu', 'quickSettings']) {
            const menu = Main.panel.statusArea[area]?.menu;
            const box = menu?.box;
            const pointer = menu?._boxPointer;
            const pair = addBlur(box, 44, 0.78);
            if (pair) {
                const [, effect] = pair;
                if (pointer) {
                    effect.enabled = Boolean(pointer.visible);
                    this._connect(pointer, 'notify::visible', () => {
                        effect.enabled = Boolean(pointer.visible);
                    });
                }
                this._menuBlurs.push(pair);
            }
        }
    }

    _disableBlur() {
        if (this._blurEffect) {
            try {
                Main.panel.remove_effect(this._blurEffect);
            } catch (_e) {
                // ignore
            }
            this._blurEffect = null;
        }
        for (const [actor, effect] of this._menuBlurs || []) {
            try {
                actor.remove_effect(effect);
            } catch (_e) {
                // ignore
            }
        }
        this._menuBlurs = [];
    }

    // BoxPointer would center the popup on its button and keep -arrow-rise
    // from the screen edge; we pin it to the bar corner instead. The
    // instance override runs GNOME's own _reposition first (arrow side,
    // flip), then moves the box. -arrow-rise is 0 (.kos-popup-boxpointer),
    // so the box is exactly the visible panel.
    _placePopups() {
        this._placed = [];
        for (const [area, side] of [['dateMenu', St.Side.LEFT], ['quickSettings', St.Side.RIGHT]]) {
            const pointer = Main.panel.statusArea[area]?.menu?._boxPointer;
            if (!pointer)
                continue;
            pointer.add_style_class_name('kos-popup-boxpointer');
            hookBoxPointer(pointer);
            const reposition = pointer._reposition;
            pointer._reposition = function (box) {
                reposition.call(this, box);
                placePopup(this, box, side);
            };
            this._placed.push(pointer);
        }
    }

    _restorePopups() {
        for (const pointer of this._placed || []) {
            unhookBoxPointer(pointer);
            delete pointer._reposition;
            pointer.remove_style_class_name('kos-popup-boxpointer');
        }
        this._placed = [];
    }

    // Hide the "Activities" button (the overview toggle in the top-left).
    _hideActivities() {
        const activities = Main.panel.statusArea.activities;
        if (activities?.container)
            activities.container.hide();
    }

    // The hot corner is the top-left "hover to open overview" affordance.
    _disableHotCorners() {
        const corners = Main.layoutManager.hotCorners || [];
        for (const corner of corners) {
            if (corner && typeof corner.setBarrierSize === 'function')
                corner.setBarrierSize(0);
            if (corner)
                corner.reactive = false;
        }
    }

    // Pull the clock out of the center box and put it on the left,
    // like moving a DOM node from .center to .left with appendChild.
    _moveDateMenuToLeft() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        if (!dateMenu?.container)
            return;
        const container = dateMenu.container;
        const parent = container.get_parent();
        if (parent === Main.panel._leftBox)
            return;
        if (parent)
            parent.remove_child(container);
        // Left box is date/time only. The stock Quick Settings cluster
        // stays on the right as GNOME ships it.
        Main.panel._leftBox.insert_child_at_index(container, 0);
        this._movedDateMenu = true;
    }

    _restoreDateMenu() {
        if (!this._movedDateMenu)
            return;
        const dateMenu = Main.panel.statusArea.dateMenu;
        if (!dateMenu?.container)
            return;
        const container = dateMenu.container;
        const parent = container.get_parent();
        if (parent)
            parent.remove_child(container);
        // Stock GNOME 48 keeps the clock in the center box.
        Main.panel._centerBox.add_child(container);
        this._movedDateMenu = false;
    }

    // Reposition panelBox — full-width 72px bottom bar, flush to the bottom edge.
    _movePanelToBottom() {
        const box = Main.layoutManager.panelBox;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!box || !monitor)
            return;
        const height = PANEL_HEIGHT;
        const x = monitor.x;
        const y = monitor.y + monitor.height - height;
        if (box.x !== x || box.y !== y)
            box.set_position(x, y);
        if (box.width !== monitor.width || box.height !== height)
            box.set_size(monitor.width, height);
        this._disableHotCorners();
        this._placeEdgeTrigger();
    }

    _initAutoHide() {
        this._autoHide = getAutoHideDock();
        this._dockHidden = false;
        this._hideTimer = 0;
        this._edgeTrigger = new St.Widget({
            reactive: true,
            visible: false,
            opacity: 0,
        });
        Main.uiGroup.add_child(this._edgeTrigger);
        this._placeEdgeTrigger();

        this._connect(this._edgeTrigger, 'enter-event', () => this._revealDock());
        this._connect(Main.panel, 'notify::hover', () => this._scheduleAutoHide());
        this._connect(global.display, 'window-created', () => this._scheduleAutoHide());
        this._connect(global.window_manager, 'minimize', () => this._scheduleAutoHide());
        this._connect(global.window_manager, 'unminimize', () => this._scheduleAutoHide());
        this._connect(global.window_manager, 'destroy', () => this._scheduleAutoHide());
        this._connect(global.display, 'notify::focus-window', () => this._scheduleAutoHide());
        for (const area of ['dateMenu', 'quickSettings']) {
            const menu = Main.panel.statusArea[area]?.menu;
            if (menu)
                this._connect(menu, 'open-state-changed', () => this._scheduleAutoHide());
        }

        this._autoHideListener = val => {
            this._autoHide = val;
            if (!val)
                this._revealDock();
            else
                this._scheduleAutoHide();
        };
        _autoHideListeners.add(this._autoHideListener);
        this._scheduleAutoHide();
    }

    _destroyAutoHide() {
        if (this._autoHideListener) {
            _autoHideListeners.delete(this._autoHideListener);
            this._autoHideListener = null;
        }
        if (this._hideTimer) {
            GLib.source_remove(this._hideTimer);
            this._hideTimer = 0;
        }
        if (this._edgeTrigger) {
            this._edgeTrigger.destroy();
            this._edgeTrigger = null;
        }
        const box = Main.layoutManager.panelBox;
        if (box) {
            stop(box);
            box.translation_y = 0;
            box.visible = true;
        }
    }

    _placeEdgeTrigger() {
        if (!this._edgeTrigger)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this._edgeTrigger.set_position(monitor.x, monitor.y + monitor.height - 4);
        this._edgeTrigger.set_size(monitor.width, 4);
    }

    _hasVisibleWindow() {
        return global.get_window_actors().some(a => {
            const w = a.meta_window;
            return w && !w.minimized && w.get_window_type() === Meta.WindowType.NORMAL;
        });
    }

    _menuOpen() {
        for (const area of ['dateMenu', 'quickSettings']) {
            if (Main.panel.statusArea[area]?.menu?.isOpen)
                return true;
        }
        return false;
    }

    _scheduleAutoHide() {
        if (this._hideTimer) {
            GLib.source_remove(this._hideTimer);
            this._hideTimer = 0;
        }
        if (!this._autoHide || Main.sessionMode.isLocked) {
            this._revealDock();
            return;
        }
        if (Main.panel.hover || this._menuOpen() || !this._hasVisibleWindow()) {
            this._revealDock();
            return;
        }
        this._hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
            this._hideTimer = 0;
            if (this._autoHide && !Main.panel.hover && !this._menuOpen() && this._hasVisibleWindow())
                this._concealDock();
            return GLib.SOURCE_REMOVE;
        });
    }

    _revealDock() {
        if (this._edgeTrigger)
            this._edgeTrigger.visible = false;
        const box = Main.layoutManager.panelBox;
        if (!box)
            return;
        if (!this._dockHidden && box.visible && box.translation_y === 0)
            return;
        this._dockHidden = false;
        box.visible = true;
        tween(box, {
            translationY: 0,
            duration: 180,
            easing: easeOutCubic,
        });
    }

    _concealDock() {
        const box = Main.layoutManager.panelBox;
        if (!box || this._dockHidden)
            return;
        this._dockHidden = true;
        if (this._edgeTrigger)
            this._edgeTrigger.visible = true;
        tween(box, {
            translationY: PANEL_HEIGHT,
            duration: 200,
            easing: easeOutCubic,
            onComplete: () => {
                if (this._dockHidden)
                    box.visible = false;
            },
        });
    }

    _restorePanel() {
        const box = Main.layoutManager.panelBox;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!box || !monitor)
            return;
        box.set_position(monitor.x, monitor.y);
        box.set_size(monitor.width, -1);
    }

    _applyStatusIcons() {
        if (!this._extensionPath)
            return;
        const root = Main.panel.statusArea.quickSettings?._indicators;
        if (!root)
            return;

        const updateIcon = icon => {
            const name = icon.icon_name;
            if (!name)
                return;
            const path = `${this._extensionPath}/icons/status/${name}.svg`;
            if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
                if (icon._kosCustomPath) {
                    delete icon._kosCustomPath;
                    icon.gicon = null;
                    icon.icon_name = name;
                }
                return;
            }
            if (icon._kosCustomPath === path)
                return;
            icon._kosOrigIconName = name;
            icon._kosCustomPath = path;
            icon.gicon = new Gio.FileIcon({file: Gio.File.new_for_path(path)});
        };

        const visit = actor => {
            if (actor instanceof St.Icon && actor.has_style_class_name('system-status-icon')) {
                updateIcon(actor);
                if (!actor._kosWatched) {
                    actor._kosWatched = true;
                    const id = actor.connect('notify::icon-name', () => updateIcon(actor));
                    const destroyId = actor.connect('destroy', () => {
                        this._statusIconSignals = this._statusIconSignals.filter(([o]) => o !== actor);
                    });
                    this._statusIconSignals.push([actor, id], [actor, destroyId]);
                }
            }
            for (const child of actor.get_children())
                visit(child);
        };
        visit(root);
    }

    _restoreStatusIcons() {
        for (const [actor, id] of this._statusIconSignals) {
            try {
                actor.disconnect(id);
            } catch (_e) {
            }
            if (actor._kosWatched)
                delete actor._kosWatched;
            if (actor._kosCustomPath) {
                const name = actor._kosOrigIconName || actor.icon_name;
                delete actor._kosCustomPath;
                delete actor._kosOrigIconName;
                actor.gicon = null;
                if (name)
                    actor.icon_name = name;
            }
        }
        this._statusIconSignals = [];
    }
}

function placePopup(pointer, box, side) {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor)
        return;
    // The allocation we are given is the size the popup gets drawn at
    // (it can be smaller than the preferred size, e.g. the calendar).
    const [width, height] = box.get_size();
    const barTop = monitor.y + monitor.height - PANEL_HEIGHT;
    const x = side === St.Side.LEFT
        ? monitor.x + POPUP_INSET
        : monitor.x + monitor.width - POPUP_INSET - width;
    const y = barTop - POPUP_GAP - height;
    let parent = pointer.get_parent();
    let [ok, px, py] = [false, x, y];
    while (!ok && parent) {
        [ok, px, py] = parent.transform_stage_point(x, y);
        parent = parent.get_parent();
    }
    box.set_origin(Math.floor(px), Math.floor(py));
}
