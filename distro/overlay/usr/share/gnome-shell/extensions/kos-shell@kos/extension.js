// kos-shell — the kos desktop look, as a GNOME Shell extension.
//
// GNOME Shell extensions are a bit like a browser extension that can restyle
// and rearrange the chrome of the desktop. This file is the entry point
// (think index.js). GNOME 45+ uses ESM (import/export), same as a modern
// web app. enable() runs when the session starts; disable() must undo
// everything so the user can turn the extension off cleanly.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {KosPanel} from './panel.js';
import {KosDock} from './dock.js';
import {KosDesktopGrid, KosAllAppsOverlay} from './desktopGrid.js';

export default class KosShellExtension extends Extension {
    enable() {
        this._settingsHandles = [];
        this._overviewIds = [];

        this._applySessionSettings();
        this._blockOverview();

        this._allApps = new KosAllAppsOverlay();
        this._panel = new KosPanel();
        this._dock = new KosDock({
            onAllApps: () => this._allApps.toggle(),
        });
        this._grid = new KosDesktopGrid({
            extensionPath: this.path,
        });

        this._panel.enable();
        this._dock.enable();
        this._grid.enable();

        // GNOME 44+ shows the Activities overview at login. Hide it once
        // the shell has finished starting so we land on the home screen.
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete', () => {
                this._hideOverview();
            });
        } else {
            this._hideOverview();
        }
    }

    disable() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
        for (const id of this._overviewIds)
            Main.overview.disconnect(id);
        this._overviewIds = [];

        this._allApps?.hide();
        this._allApps = null;
        this._grid?.disable();
        this._grid = null;
        this._dock?.disable();
        this._dock = null;
        this._panel?.disable();
        this._panel = null;

        // Session settings stay as they are (they live in dconf). We don't
        // un-set them on disable so a reload doesn't flicker workspaces back.
        this._settingsHandles = [];
    }

    _hideOverview() {
        try {
            if (Main.overview.visible)
                Main.overview.hide();
        } catch (_e) {
            // Overview may not be ready during very early startup.
        }
    }

    // Swallow the overview: no Activities view, no Super-key workspace picker.
    // Like intercepting a route so it never renders.
    _blockOverview() {
        const onShowing = Main.overview.connect('showing', () => {
            // Let our own "all apps" overlay be the only full-screen sheet.
            if (this._allApps && this._allApps._actor)
                return;
            GLibIdleHide(() => this._hideOverview());
        });
        this._overviewIds.push(onShowing);
    }

    // Belt-and-suspenders: also write the keys we set as dconf defaults,
    // in case the user db already overrode them from an earlier session.
    _applySessionSettings() {
        const mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        mutter.set_boolean('dynamic-workspaces', false);
        if (mutter.list_keys().includes('overlay-key'))
            mutter.set_string('overlay-key', '');
        // Fractional-scaling experiments can crash mutter on virtio-gpu (swrast).
        if (mutter.list_keys().includes('experimental-features'))
            mutter.set_strv('experimental-features', []);

        const wm = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        wm.set_int('num-workspaces', 1);

        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        if (iface.list_keys().includes('enable-hot-corners'))
            iface.set_boolean('enable-hot-corners', false);
        iface.set_boolean('clock-show-date', true);
        if (iface.list_keys().includes('clock-show-weekday'))
            iface.set_boolean('clock-show-weekday', true);
    }
}

function GLibIdleHide(fn) {
    // Defer hide() to the next event-loop tick so we don't hide mid-signal
    // (same idea as setTimeout(fn, 0) in the browser).
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        fn();
        return GLib.SOURCE_REMOVE;
    });
}
