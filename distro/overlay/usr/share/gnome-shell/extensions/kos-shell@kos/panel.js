// The GNOME top bar is a fixed header (position:fixed; top:0; width:100%).
// We restyle it as a fixed footer: same element, new place, new child order.
//
// Main.panel is the bar. It has three flex-like boxes:
//   _leftBox, _centerBox, _rightBox  — think display:flex; justify-content:space-between
// Stock GNOME 48: Activities on the left, clock in the center, Quick Settings on the right.
// kos: clock + wifi on the left, dock in the center, volume/power (Quick Settings) on the right.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export class KosPanel {
    constructor() {
        this._signals = [];
        this._network = null;
        this._movedDateMenu = false;
    }

    enable() {
        Main.panel.add_style_class_name('kos-panel');

        this._hideActivities();
        this._disableHotCorners();
        this._moveDateMenuToLeft();
        this._addNetworkButton();
        this._movePanelToBottom();

        // Re-run layout when monitors change or the bar is reallocated
        // (like a resize listener on window.resize).
        this._connect(Main.layoutManager, 'monitors-changed', () => this._movePanelToBottom());
        this._connect(Main.layoutManager, 'startup-complete', () => {
            this._hideActivities();
            this._disableHotCorners();
            this._movePanelToBottom();
        });
        this._connect(Main.layoutManager.panelBox, 'notify::allocation', () => this._movePanelToBottom());
    }

    disable() {
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];

        if (this._network) {
            this._network.destroy();
            this._network = null;
        }

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
        // Insert at the start of the left box so time/date come first, then wifi.
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

    _addNetworkButton() {
        if (this._network)
            return;
        this._network = new KosNetworkButton();
        // Official way to add a panel item (it also tracks it in statusArea).
        Main.panel.addToStatusArea('kos-network', this._network, 1, 'left');
    }

    // Reposition panelBox — the shell's chrome wrapper around the bar.
    // This is the equivalent of changing a fixed header to a fixed footer.
    _movePanelToBottom() {
        const box = Main.layoutManager.panelBox;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!box || !monitor)
            return;
        const height = Math.max(box.height, 56);
        const x = monitor.x;
        const y = monitor.y + monitor.height - height;
        if (box.x !== x || box.y !== y)
            box.set_position(x, y);
        if (box.width !== monitor.width)
            box.set_size(monitor.width, height);
        this._disableHotCorners();
    }

    _restorePanel() {
        const box = Main.layoutManager.panelBox;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!box || !monitor)
            return;
        box.set_position(monitor.x, monitor.y);
        box.set_size(monitor.width, box.height);
    }
}

// A compact wifi/network status icon. Clicking it opens the same Quick Settings
// menu that the right-side indicators use (so the user can pick a network).
const KosNetworkButton = GObject.registerClass(
class KosNetworkButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'kos network', true);
        this.add_style_class_name('kos-network-button');

        this._icon = new St.Icon({
            icon_name: 'network-wireless-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._monitor = Gio.NetworkMonitor.get_default();
        this._monId = this._monitor.connect('network-changed', () => this._sync());
        this._sync();
    }

    // Left-click opens Quick Settings (volume, wifi, power live in that one menu).
    vfunc_event(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS && event.get_button() === 1) {
            const qs = Main.panel.statusArea.quickSettings;
            if (qs?.menu)
                qs.menu.toggle();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_event(event);
    }

    _sync() {
        if (!this._monitor)
            return;
        if (this._monitor.get_network_available()) {
            const conn = this._monitor.get_connectivity();
            // FULL is a good link; anything else is "we have a network but it's limited".
            if (conn === Gio.NetworkConnectivity.FULL)
                this._icon.icon_name = 'network-wireless-signal-excellent-symbolic';
            else
                this._icon.icon_name = 'network-wireless-signal-ok-symbolic';
        } else {
            this._icon.icon_name = 'network-wireless-offline-symbolic';
        }
    }

    destroy() {
        if (this._monitor && this._monId) {
            this._monitor.disconnect(this._monId);
            this._monId = 0;
        }
        super.destroy();
    }
});
