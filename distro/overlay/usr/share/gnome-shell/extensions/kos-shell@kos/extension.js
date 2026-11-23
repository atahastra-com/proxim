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
import {KosQuickPanel} from './quickPanel.js';
import {KosDock} from './dock.js';
import {KosDesktopGrid, KosAllAppsOverlay} from './desktopGrid.js';
import {KosHomeBlur, KosLockScreen} from './lockScreen.js';

export default class KosShellExtension extends Extension {
    enable() {
        this._settingsHandles = [];
        this._overviewIds = [];

        // Runs first, so a bug in panel/dock/grid can never leave the stock
        // overview stuck on screen.
        // GNOME 44+ plays a login animation that opens the Activities
        // overview. Do NOT hide the overview in the middle of that animation:
        // its "done" callback never fires, so the shell never leaves startup
        // mode and its full-screen startup cover (a reactive actor on top of
        // everything) keeps eating every mouse click while keys still work.
        // Instead, tell the shell there is no overview while starting up, so
        // it runs the plain fade-in, then restore the flag.
        if (Main.layoutManager._startingUp) {
            this._savedHasOverview = Main.sessionMode.hasOverview;
            Main.sessionMode.hasOverview = false;
            this._startupId = Main.layoutManager.connect('startup-complete', () => {
                this._restoreHasOverview();
                Main.layoutManager.disconnect(this._startupId);
                this._startupId = 0;
                // If the shell started its overview animation before we were
                // enabled, it has finished now and is safe to close.
                GLibIdleHide(() => this._hideOverview());
            });
        } else {
            this._hideOverview();
        }

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
        this._quickPanel = new KosQuickPanel();
        this._quickPanel.enable();
        this._dock.enable();
        this._grid.enable();
        this._homeBlur = new KosHomeBlur();
        this._homeBlur.enable();
        this._lockScreen = new KosLockScreen();
        this._lockScreen.enable();

        // metadata.json keeps us enabled on the lock screen (so the lock
        // screen gets the kos look). Hide what must not show or be usable
        // there: the dock and the all-apps sheet.
        this._sessionId = Main.sessionMode.connect('updated', () => this._onSessionMode());
        this._onSessionMode();

    }

    disable() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
        this._restoreHasOverview();
        for (const id of this._overviewIds)
            Main.overview.disconnect(id);
        this._overviewIds = [];

        if (this._sessionId) {
            Main.sessionMode.disconnect(this._sessionId);
            this._sessionId = 0;
        }
        this._lockScreen?.disable();
        this._lockScreen = null;
        this._homeBlur?.disable();
        this._homeBlur = null;
        this._allApps?.hide();
        this._allApps = null;
        this._grid?.disable();
        this._grid = null;
        this._dock?.disable();
        this._dock = null;
        this._quickPanel?.disable();
        this._quickPanel = null;
        this._panel?.disable();
        this._panel = null;

        // Session settings stay as they are (they live in dconf). We don't
        // un-set them on disable so a reload doesn't flicker workspaces back.
        this._settingsHandles = [];
    }

    _onSessionMode() {
        const locked = Main.sessionMode.isLocked;
        if (locked)
            this._allApps?.hide();
        this._dock?.setVisible(!locked);
    }

    _restoreHasOverview() {
        if (this._savedHasOverview !== undefined) {
            Main.sessionMode.hasOverview = this._savedHasOverview;
            this._savedHasOverview = undefined;
        }
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
            // Never cut the login animation short (see enable()).
            if (Main.layoutManager._startingUp)
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
        // Deepin-style window buttons on the right.
        wm.set_string('button-layout', ':minimize,maximize,close');

        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        iface.set_string('icon-theme', 'kos-icons');
        // kos is dark everywhere. Switch an existing user to dark once (an
        // earlier kos build set prefer-light); after that the Dark Style
        // tile in quick settings stays in charge.
        const marker = GLib.build_filenamev([GLib.get_user_config_dir(), 'kos', 'dark-default-v1']);
        if (!GLib.file_test(marker, GLib.FileTest.EXISTS)) {
            iface.set_string('color-scheme', 'prefer-dark');
            GLib.mkdir_with_parents(GLib.path_get_dirname(marker), 0o755);
            GLib.file_set_contents(marker, '');
        }
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
