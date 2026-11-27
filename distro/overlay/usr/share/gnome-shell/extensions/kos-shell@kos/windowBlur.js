// Dark frosted glass behind app windows.
//
// libadwaita cannot blur what is behind a window, so the shell does it: a
// Shell.BlurEffect (BACKGROUND mode) actor sits inside each app window's
// Meta.WindowActor, under the window surface, covering the window frame
// (not the CSD shadow). The GTK CSS (~/.config/gtk-4.0/gtk.css) makes the
// window background a translucent dark tint, so the blurred desktop shows
// through it. Being a child of the window actor, the blur moves, scales and
// fades with the window animations in windows.js for free.
//
// Shell.BlurEffect only blurs rectangles. A single rectangle would show
// square blurred corners outside the window's 14px rounded corners, so the
// frame is covered by three non-overlapping bands (top, middle, bottom)
// that leave the four corner squares out. Maximized, tiled and fullscreen
// windows have square corners and get one full rectangle.
//
// Only GTK application windows are blurred (they get our translucent CSS);
// Firefox, terminals and other opaque windows would just waste GPU time.
// KOS_WINDOW_BLUR=0 turns it off.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

const BLUR_RADIUS = 36;
const BLUR_BRIGHTNESS = 0.72;
const CORNER = 14;          // must match window.csd border-radius in gtk.css

const BLUR_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

function makeBand() {
    const band = new Clutter.Actor({name: 'kos-window-blur', reactive: false});
    const effect = new Shell.BlurEffect({
        mode: Shell.BlurMode.BACKGROUND,
        brightness: BLUR_BRIGHTNESS,
    });
    if ('radius' in effect)
        effect.radius = BLUR_RADIUS;
    else if ('sigma' in effect)
        effect.sigma = BLUR_RADIUS;
    band.add_effect_with_name('blur', effect);
    return band;
}

function wantsBlur(actor) {
    const win = actor?.meta_window;
    if (!win)
        return false;
    try {
        if (win.is_override_redirect())
            return false;
        if (!BLUR_TYPES.has(win.get_window_type()))
            return false;
        return Boolean(win.get_gtk_application_id?.());
    } catch (_e) {
        return false;
    }
}

export class KosWindowBlur {
    enable() {
        this._tracked = new Map();
        if (GLib.getenv('KOS_WINDOW_BLUR') === '0')
            return;
        this._mapId = global.window_manager.connect('map',
            (_wm, actor) => this._track(actor));
        for (const actor of global.get_window_actors())
            this._track(actor);
    }

    disable() {
        if (this._mapId) {
            global.window_manager.disconnect(this._mapId);
            this._mapId = 0;
        }
        for (const actor of [...(this._tracked?.keys() ?? [])])
            this._untrack(actor);
        this._tracked = null;
    }

    _track(actor) {
        if (!actor || this._tracked.has(actor) || !wantsBlur(actor))
            return;
        const win = actor.meta_window;
        const bands = [makeBand(), makeBand(), makeBand()];
        for (const band of bands)
            actor.insert_child_at_index(band, 0);

        const state = {win, bands, winIds: [], actorIds: []};
        this._tracked.set(actor, state);

        const relayout = () => this._layout(state);
        for (const signal of [
            'size-changed',
            'position-changed',
            'notify::fullscreen',
            'notify::maximized-horizontally',
            'notify::maximized-vertically',
        ]) {
            try {
                state.winIds.push(win.connect(signal, relayout));
            } catch (_e) {
                // signal not present on this mutter
            }
        }
        state.actorIds.push(actor.connect('destroy', () => this._untrack(actor, true)));
        relayout();
    }

    _untrack(actor, destroyed = false) {
        const state = this._tracked?.get(actor);
        if (!state)
            return;
        this._tracked.delete(actor);
        for (const id of state.winIds) {
            try {
                state.win.disconnect(id);
            } catch (_e) {}
        }
        if (!destroyed) {
            for (const id of state.actorIds) {
                try {
                    actor.disconnect(id);
                } catch (_e) {}
            }
            for (const band of state.bands)
                band.destroy();
        }
    }

    _layout(state) {
        const {win, bands} = state;
        let frame, buffer;
        try {
            frame = win.get_frame_rect();
            buffer = win.get_buffer_rect();
        } catch (_e) {
            return;
        }
        const x = frame.x - buffer.x;
        const y = frame.y - buffer.y;
        const w = frame.width;
        const h = frame.height;
        const [top, mid, bottom] = bands;

        if (win.is_fullscreen() || w <= 0 || h <= 0) {
            for (const band of bands)
                band.hide();
            return;
        }

        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const square = Boolean(win.get_maximized());
        const r = square ? 0 : Math.min(Math.round(CORNER * scaleFactor),
            Math.floor(w / 2), Math.floor(h / 2));

        const place = (band, bx, by, bw, bh) => {
            if (bw <= 0 || bh <= 0) {
                band.hide();
                return;
            }
            band.set_position(bx, by);
            band.set_size(bw, bh);
            band.show();
        };
        place(top, x + r, y, w - 2 * r, r);
        place(mid, x, y + r, w, h - 2 * r);
        place(bottom, x + r, y + h - r, w - 2 * r, r);
    }
}
