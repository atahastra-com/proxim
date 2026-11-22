// The GNOME top bar is a fixed header (position:fixed; top:0; width:100%).
// We restyle it as a fixed footer: same element, new place, new child order.
//
// Main.panel is the bar. It has three flex-like boxes:
//   _leftBox, _centerBox, _rightBox  — think display:flex; justify-content:space-between
// Stock GNOME 48: Activities on the left, clock in the center, Quick Settings on the right.
// kos: clock on the left, dock in the center, and GNOME's stock system
// status cluster (network/volume/power) left alone on the right.

import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const PANEL_HEIGHT = 72;

export class KosPanel {
    constructor() {
        this._signals = [];
        this._movedDateMenu = false;
        this._blurEffect = null;
    }

    enable() {
        Main.panel.add_style_class_name('kos-panel');

        this._enableBlur();
        this._hideActivities();
        this._disableHotCorners();
        this._moveDateMenuToLeft();
        this._movePanelToBottom();

        // Re-run layout when monitors change or the bar is reallocated
        // (like a resize listener on window.resize).
        this._connect(Main.layoutManager, 'monitors-changed', () => this._movePanelToBottom());
        this._connect(Main.layoutManager, 'workareas-changed', () => this._movePanelToBottom());
        this._connect(Main.layoutManager, 'startup-complete', () => {
            this._hideActivities();
            this._disableHotCorners();
            this._movePanelToBottom();
        });
        this._connect(Main.layoutManager.panelBox, 'notify::allocation', () => this._movePanelToBottom());
        this._connect(Main.panel, 'notify::height', () => this._movePanelToBottom());
    }

    disable() {
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];

        this._disableBlur();
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

    // Real frosted-glass background blur behind the bottom dock bar.
    _enableBlur() {
        if (this._blurEffect)
            return;
        try {
            const effect = new Shell.BlurEffect({
                mode: Shell.BlurMode.BACKGROUND,
                brightness: 0.85,
            });
            if ('radius' in effect)
                effect.radius = 28;
            else if ('sigma' in effect)
                effect.sigma = 28;
            Main.panel.add_effect(effect);
            this._blurEffect = effect;
        } catch (_e) {
            this._blurEffect = null;
        }
    }

    _disableBlur() {
        if (!this._blurEffect)
            return;
        try {
            Main.panel.remove_effect(this._blurEffect);
        } catch (_e) {
            // ignore
        }
        this._blurEffect = null;
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

    // Reposition panelBox — full-width bottom bar, letting CSS own the exact
    // height so panelBox never exceeds Main.panel and leaves a gap below it.
    _movePanelToBottom() {
        const box = Main.layoutManager.panelBox;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!box || !monitor)
            return;
        if (box.width !== monitor.width)
            box.set_size(monitor.width, -1);
        const height = Math.ceil(Main.panel.height || box.height || PANEL_HEIGHT);
        const x = monitor.x;
        const y = monitor.y + monitor.height - height;
        if (box.x !== x || box.y !== y)
            box.set_position(x, y);
        this._disableHotCorners();
    }

    _restorePanel() {
        const box = Main.layoutManager.panelBox;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!box || !monitor)
            return;
        box.set_position(monitor.x, monitor.y);
        box.set_size(monitor.width, -1);
    }
}
