// iPhone-style lock screen and home wallpaper.
//
// Lock screen: GNOME's unlock dialog normally blurs the wallpaper hard
// (radius 90, brightness 0.65). kos shows it SHARP behind a big thin clock
// with the date above it, and blurs it only once the password prompt is up
// (like the iPhone passcode page). The clock sits near the top, not at a
// third of the screen.
//
// Home: the wallpaper behind the launchpad grid gets a light blur, like the
// iPhone home screen. Only the Meta.BackgroundActor children of
// Main.layoutManager._backgroundGroup are blurred, never the grid itself.
//
// Both are monkeypatches/effects that disable() fully undoes. The extension
// runs in the 'unlock-dialog' session mode too (metadata.json), otherwise
// GNOME would disable it, and this stylesheet, while the screen is locked.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {LOCK_MS, easeOutQuint, tween} from './anim.js';
import {UnlockDialog} from 'resource:///org/gnome/shell/ui/unlockDialog.js';

const LOCK_BRIGHTNESS = 0.85;      // clock page: sharp, slightly dimmed
const PROMPT_RADIUS = 44;          // password page: dark frosted blur
const PROMPT_BRIGHTNESS = 0.60;
const CLOCK_TOP = 0.10;            // clock top at 10% of the screen height

const HOME_RADIUS = 4;
const HOME_BRIGHTNESS = 0.96;
const HOME_EFFECT = 'kos-home-blur';

function lockEffect(dialog) {
    // Two states only: sharp clock page, frosted prompt. Do not interpolate
    // the blur radius (that would re-render the blur every frame).
    const p = (dialog._kosProgress ?? 0) >= 0.5 ? 1 : 0;
    const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
    const radius = Math.round(PROMPT_RADIUS * p * scaleFactor);
    const brightness = LOCK_BRIGHTNESS + (PROMPT_BRIGHTNESS - LOCK_BRIGHTNESS) * p;
    for (const widget of dialog._backgroundGroup ?? []) {
        const effect = widget.get_effect('blur');
        if (effect) {
            effect.set({radius, brightness});
            // radius 0 still costs an offscreen pass; skip it entirely.
            effect.enabled = radius > 0;
        }
    }
}

function liftClock(dialog) {
    const clock = dialog._clock;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!clock || !monitor)
        return;
    // UnlockDialogLayout puts the clock at a third of the height; move it up.
    const lift = Math.max(0, Math.round(monitor.height / 3 - monitor.height * CLOCK_TOP));
    clock.translation_y -= lift;
}

export class KosLockScreen {
    enable() {
        const proto = UnlockDialog.prototype;
        this._orig = {
            _init: proto._init,
            _updateBackgroundEffects: proto._updateBackgroundEffects,
            _setTransitionProgress: proto._setTransitionProgress,
        };
        const orig = this._orig;

        proto._init = function (...args) {
            orig._init.apply(this, args);
            this.add_style_class_name('kos-lock');
            // iPhone order: date above the time.
            const c = this._clock;
            if (c?._date && c?._time)
                c.set_child_below_sibling(c._date, c._time);
            // OS logo (os-release LOGO, e.g. proxim-logo) above the date.
            if (c) {
                const logo = new St.Icon({
                    gicon: new Gio.ThemedIcon({name: GLib.get_os_info('LOGO') || 'proxim-logo'}),
                    icon_size: 52,
                    style_class: 'kos-lock-logo',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                c.insert_child_at_index(logo, 0);
            }
            // Re-run the (patched) transition once so the blur, brightness
            // and clock lift are applied exactly once from a clean state.
            this._setTransitionProgress(this._adjustment?.value ?? 0);
            const clock = this._clock;
            if (clock) {
                const restY = clock.translation_y || 0;
                clock.opacity = 0;
                clock.translation_y = restY - 16;
                tween(clock, {
                    opacity: 255,
                    translationY: restY,
                    duration: LOCK_MS,
                    easing: easeOutQuint,
                });
            }
        };
        proto._updateBackgroundEffects = function () {
            lockEffect(this);
        };
        proto._setTransitionProgress = function (progress) {
            orig._setTransitionProgress.call(this, progress);
            this._kosProgress = progress;
            lockEffect(this);
            liftClock(this);
        };
    }

    disable() {
        if (!this._orig)
            return;
        Object.assign(UnlockDialog.prototype, this._orig);
        this._orig = null;
    }
}

export class KosHomeBlur {
    enable() {
        this._group = Main.layoutManager._backgroundGroup;
        for (const child of this._group?.get_children() ?? [])
            child.remove_effect_by_name(HOME_EFFECT);
    }

    disable() {
        this._group = null;
    }
}
