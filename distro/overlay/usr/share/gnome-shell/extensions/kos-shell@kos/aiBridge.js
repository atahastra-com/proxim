// Session D-Bus bridge (org.proxim.ShellAI) giving Proxim AI direct native
// Wayland control over windows, screenshots, mouse, and keyboard — no extra
// daemons or root permissions required.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BUS_NAME = 'org.proxim.ShellAI';
const OBJ_PATH = '/org/proxim/ShellAI';

const IFACE_XML = `
<node>
  <interface name="org.proxim.ShellAI">
    <method name="ListWindows">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="WindowAction">
      <arg type="s" direction="in" name="action"/>
      <arg type="u" direction="in" name="winId"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="Click">
      <arg type="i" direction="in" name="x"/>
      <arg type="i" direction="in" name="y"/>
      <arg type="u" direction="in" name="button"/>
      <arg type="b" direction="in" name="doubleClick"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="MoveMouse">
      <arg type="i" direction="in" name="x"/>
      <arg type="i" direction="in" name="y"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="TypeText">
      <arg type="s" direction="in" name="text"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="PressKey">
      <arg type="s" direction="in" name="combo"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="Screenshot">
      <arg type="s" direction="in" name="path"/>
      <arg type="s" direction="out" name="json"/>
    </method>
  </interface>
</node>
`;

const MOD_MAP = {
    ctrl: Clutter.KEY_Control_L,
    control: Clutter.KEY_Control_L,
    alt: Clutter.KEY_Alt_L,
    shift: Clutter.KEY_Shift_L,
    super: Clutter.KEY_Super_L,
    meta: Clutter.KEY_Super_L,
};

const KEY_ALIASES = {
    enter: 'Return',
    return: 'Return',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    space: 'space',
    backspace: 'BackSpace',
    delete: 'Delete',
    del: 'Delete',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    pageup: 'Page_Up',
    pagedown: 'Page_Down',
};

export class KosAiBridge {
    constructor() {
        this._ownerId = 0;
        this._dbus = null;
        this._pointer = null;
        this._keyboard = null;
    }

    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this);
        this._dbus.export(Gio.DBus.session, OBJ_PATH);
        this._ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            null,
            null,
            null
        );
    }

    disable() {
        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }
        if (this._dbus) {
            this._dbus.unexport();
            this._dbus = null;
        }
        this._pointer = null;
        this._keyboard = null;
    }

    _getPointer() {
        if (!this._pointer) {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        }
        return this._pointer;
    }

    _getKeyboard() {
        if (!this._keyboard) {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        }
        return this._keyboard;
    }

    ListWindows() {
        const list = [];
        const focus = global.display.focus_window;
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            if (!win || win.is_override_redirect())
                continue;
            const rect = win.get_frame_rect();
            list.push({
                id: win.get_id(),
                title: win.get_title() || '',
                app: win.get_gtk_application_id?.() || win.get_wm_class?.() || '',
                focused: win === focus,
                minimized: Boolean(win.minimized),
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            });
        }
        return JSON.stringify(list);
    }

    WindowAction(action, winId) {
        const now = global.get_current_time();
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            if (!win || win.get_id() !== winId)
                continue;
            try {
                if (action === 'focus') {
                    if (win.minimized)
                        win.unminimize();
                    win.activate(now);
                    return true;
                }
                if (action === 'close') {
                    win.delete(now);
                    return true;
                }
                if (action === 'minimize') {
                    win.minimize();
                    return true;
                }
                if (action === 'maximize') {
                    win.maximize(Meta.MaximizeFlags.BOTH);
                    return true;
                }
            } catch (e) {
                logError(e, `kos-shell: WindowAction ${action}`);
            }
            return false;
        }
        return false;
    }

    MoveMouse(x, y) {
        try {
            const ptr = this._getPointer();
            ptr.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
            return true;
        } catch (e) {
            logError(e, 'kos-shell: MoveMouse');
            return false;
        }
    }

    Click(x, y, button, doubleClick) {
        try {
            const ptr = this._getPointer();
            const btn = button || 1;
            const t = GLib.get_monotonic_time();
            ptr.notify_absolute_motion(t, x, y);
            const clicks = doubleClick ? 2 : 1;
            for (let i = 0; i < clicks; i++) {
                const ct = GLib.get_monotonic_time();
                ptr.notify_button(ct, btn, Clutter.ButtonState.PRESSED);
                ptr.notify_button(ct + 15000, btn, Clutter.ButtonState.RELEASED);
            }
            return true;
        } catch (e) {
            logError(e, 'kos-shell: Click');
            return false;
        }
    }

    TypeTextAsync(params, invocation) {
        const [text] = params;
        const chars = [...String(text || '')];
        let idx = 0;
        let kb;
        try {
            kb = this._getKeyboard();
        } catch (e) {
            logError(e, 'kos-shell: TypeText');
            invocation.return_value(new GLib.Variant('(b)', [false]));
            return;
        }
        const step = () => {
            if (idx >= chars.length) {
                invocation.return_value(new GLib.Variant('(b)', [true]));
                return GLib.SOURCE_REMOVE;
            }
            const ch = chars[idx++];
            try {
                const cp = ch.codePointAt(0);
                const keyval = ch === '\n'
                    ? Clutter.KEY_Return
                    : ch === '\t'
                        ? Clutter.KEY_Tab
                        : Clutter.unicode_to_keysym(cp);
                if (keyval) {
                    const t = GLib.get_monotonic_time();
                    kb.notify_keyval(t, keyval, Clutter.KeyState.PRESSED);
                    kb.notify_keyval(t + 5000, keyval, Clutter.KeyState.RELEASED);
                }
            } catch (e) {
                logError(e, 'kos-shell: TypeText char');
            }
            return GLib.SOURCE_CONTINUE;
        };
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, step);
    }

    PressKey(combo) {
        try {
            const kb = this._getKeyboard();
            const parts = String(combo).split('+').map(s => s.trim()).filter(Boolean);
            if (parts.length === 0)
                return false;
            const mods = [];
            for (let i = 0; i < parts.length - 1; i++) {
                const m = MOD_MAP[parts[i].toLowerCase()];
                if (m)
                    mods.push(m);
            }
            const rawKey = parts[parts.length - 1];
            const mapped = KEY_ALIASES[rawKey.toLowerCase()] || rawKey;
            let keyval = Clutter.keyval_from_name(mapped);
            if (!keyval && rawKey.length === 1)
                keyval = Clutter.unicode_to_keysym(rawKey.codePointAt(0));
            if (!keyval)
                return false;

            const t = GLib.get_monotonic_time();
            for (const m of mods)
                kb.notify_keyval(t, m, Clutter.KeyState.PRESSED);
            kb.notify_keyval(t + 5000, keyval, Clutter.KeyState.PRESSED);
            kb.notify_keyval(t + 15000, keyval, Clutter.KeyState.RELEASED);
            for (const m of mods.reverse())
                kb.notify_keyval(t + 20000, m, Clutter.KeyState.RELEASED);
            return true;
        } catch (e) {
            logError(e, 'kos-shell: PressKey');
            return false;
        }
    }

    ScreenshotAsync(params, invocation) {
        const [path] = params;
        const outPath = path || '/tmp/proxim-ai-screen.png';
        try {
            const file = Gio.File.new_for_path(outPath);
            const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            const ss = new Shell.Screenshot();
            ss.screenshot(false, stream, (src, res) => {
                try {
                    ss.screenshot_finish(res);
                    stream.close(null);
                    const mon = Main.layoutManager.primaryMonitor;
                    const info = {
                        ok: true,
                        path: outPath,
                        width: mon?.width || 1920,
                        height: mon?.height || 1080,
                    };
                    invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(info)]));
                } catch (err) {
                    try {
                        stream.close(null);
                    } catch (_e) {}
                    invocation.return_value(new GLib.Variant('(s)', [JSON.stringify({ok: false, error: `${err}`})]));
                }
            });
        } catch (err) {
            invocation.return_value(new GLib.Variant('(s)', [JSON.stringify({ok: false, error: `${err}`})]));
        }
    }
}
