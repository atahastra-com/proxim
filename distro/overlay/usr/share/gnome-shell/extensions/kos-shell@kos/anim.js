// kos animation helper.
//
// GNOME's actor.ease() snaps because the image sets enable-animations=false
// (a VM-CPU choice, not a reduced-motion request). This ticks opacity,
// scale and translation on a 16ms GLib timer with ease-out cubic/quint,
// the same path the dock hover zoom already uses. Cheap paint transforms
// only — never animate a blur radius.
//
// Every tween is guaranteed to reach its end values and call onComplete:
// the tick applies the exact end state on the last frame, a safety timeout
// settles if the tick source is dropped, and any throw snaps to the end
// instead of leaving an actor invisible-but-still-there.

import GLib from 'gi://GLib';

import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';

export const OPEN_MS = 280;
export const CLOSE_MS = 220;
export const POPUP_OPEN_MS = 240;
export const POPUP_CLOSE_MS = 180;
export const SWIPE_MS = 280;
export const MINIMIZE_MS = 260;
export const MAXIMIZE_MS = 260;
export const STAGGER_MS = 22;
export const STAGGER_DUR_MS = 180;
export const LOCK_MS = 300;
export const DOT_FADE_MS = 200;
export const BOUNCE_MS = 160;

export function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

export function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
}

export function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// kos keeps org.gnome.desktop.interface enable-animations false for the
// VM, so that key is not treated as prefers-reduced-motion. Honor an
// explicit override if one is ever set.
export function reduceMotion() {
    return GLib.getenv('KOS_REDUCE_MOTION') === '1';
}

function sourceRemove(id) {
    if (!id)
        return;
    try {
        GLib.source_remove(id);
    } catch (_e) {
        // already removed, or called from the source itself
    }
}

export function stop(actor) {
    if (!actor)
        return;
    sourceRemove(actor._kosAnim);
    sourceRemove(actor._kosAnimSafety);
    actor._kosAnim = 0;
    actor._kosAnimSafety = 0;
    actor._kosAnimProps = null;
    actor._kosAnimComplete = null;
}

// Drop timers when the actor is destroyed so a later tick cannot touch
// a disposed object (GJS logs "already disposed" on logout otherwise).
function hookDestroy(actor) {
    if (!actor || actor._kosAnimDestroyId)
        return;
    try {
        actor._kosAnimDestroyId = actor.connect('destroy', () => {
            actor._kosAnimDestroyId = 0;
            sourceRemove(actor._kosAnim);
            sourceRemove(actor._kosAnimSafety);
            actor._kosAnim = 0;
            actor._kosAnimSafety = 0;
            actor._kosAnimProps = null;
            actor._kosAnimComplete = null;
        });
    } catch (_e) {
    }
}

function alive(actor) {
    if (!actor)
        return false;
    try {
        if (typeof actor.get_stage === 'function' && !actor.get_stage())
            return false;
    } catch (_e) {
        return false;
    }
    return true;
}

function read(actor, key) {
    switch (key) {
    case 'opacity':
        return actor.opacity;
    case 'scale':
        return actor.scale_x || 1;
    case 'scaleX':
        return actor.scale_x || 1;
    case 'scaleY':
        return actor.scale_y || 1;
    case 'translationX':
        return actor.translation_x || 0;
    case 'translationY':
        return actor.translation_y || 0;
    default:
        return 0;
    }
}

function write(actor, key, value) {
    switch (key) {
    case 'opacity':
        actor.opacity = Math.round(value);
        break;
    case 'scale':
        actor.set_scale(value, value);
        break;
    case 'scaleX':
        actor.scale_x = value;
        break;
    case 'scaleY':
        actor.scale_y = value;
        break;
    case 'translationX':
        actor.translation_x = value;
        break;
    case 'translationY':
        actor.translation_y = value;
        break;
    }
}

const PROPS = ['opacity', 'scale', 'scaleX', 'scaleY', 'translationX', 'translationY'];

function apply(actor, props) {
    if (!actor || !props)
        return;
    for (const key of PROPS) {
        if (key in props)
            write(actor, key, props[key]);
    }
}

function settle(actor) {
    if (!actor)
        return;
    const props = actor._kosAnimProps;
    const cb = actor._kosAnimComplete;
    sourceRemove(actor._kosAnim);
    sourceRemove(actor._kosAnimSafety);
    actor._kosAnim = 0;
    actor._kosAnimSafety = 0;
    actor._kosAnimProps = null;
    actor._kosAnimComplete = null;
    try {
        apply(actor, props);
    } catch (e) {
        logError(e, 'kos-shell: anim apply');
    }
    try {
        cb?.();
    } catch (e) {
        logError(e, 'kos-shell: anim onComplete');
    }
}

// Tween the listed properties from their current values. Retargeting the
// same actor stops the previous tween first (without applying its end).
// duration is milliseconds. The end values and onComplete always run.
export function tween(actor, {
    duration = OPEN_MS,
    easing = easeOutCubic,
    onComplete = null,
    ...props
} = {}) {
    if (!actor) {
        try {
            onComplete?.();
        } catch (e) {
            logError(e, 'kos-shell: anim onComplete');
        }
        return;
    }
    stop(actor);
    hookDestroy(actor);
    actor._kosAnimProps = props;
    actor._kosAnimComplete = onComplete;

    try {
        if (!alive(actor) || reduceMotion() || duration <= 0) {
            settle(actor);
            return;
        }
        const keys = PROPS.filter(k => k in props);
        if (keys.length === 0) {
            settle(actor);
            return;
        }
        const from = {};
        let same = true;
        for (const key of keys) {
            from[key] = read(actor, key);
            if (Math.abs((from[key] ?? 0) - props[key]) > 0.001)
                same = false;
        }
        if (same) {
            settle(actor);
            return;
        }
        const start = GLib.get_monotonic_time();
        actor._kosAnim = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            try {
                if (!alive(actor)) {
                    settle(actor);
                    return GLib.SOURCE_REMOVE;
                }
                const t = Math.min(1, (GLib.get_monotonic_time() - start) / (duration * 1000));
                const e = easing(t);
                for (const key of keys)
                    write(actor, key, from[key] + (props[key] - from[key]) * e);
                if (t >= 1) {
                    settle(actor);
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            } catch (e) {
                logError(e, 'kos-shell: anim tick');
                settle(actor);
                return GLib.SOURCE_REMOVE;
            }
        });
        actor._kosAnimSafety = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration + 80, () => {
            actor._kosAnimSafety = 0;
            if (actor._kosAnimProps)
                settle(actor);
            return GLib.SOURCE_REMOVE;
        });
    } catch (e) {
        logError(e, 'kos-shell: anim tween');
        settle(actor);
    }
}

export function after(ms, fn) {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, ms), () => {
        try {
            fn();
        } catch (e) {
            logError(e, 'kos-shell: anim after');
        }
        return GLib.SOURCE_REMOVE;
    });
}

// Fade + 8px slide up for a BoxPointer (calendar, quick settings, menus).
// open/close still use GNOME's NONE path for placement, then we tween.
export function hookBoxPointer(pointer) {
    if (!pointer || pointer._kosAnimHooked)
        return pointer;
    pointer._kosAnimHooked = true;
    const origOpen = pointer.open.bind(pointer);
    const origClose = pointer.close.bind(pointer);
    pointer._kosOrigOpen = origOpen;
    pointer._kosOrigClose = origClose;

    pointer.open = function (_animate) {
        this.opacity = 0;
        this.translation_y = 8;
        origOpen(PopupAnimation.NONE);
        if (!alive(this)) {
            this.opacity = 255;
            this.translation_y = 0;
            return;
        }
        tween(this, {
            opacity: 255,
            translationY: 0,
            duration: POPUP_OPEN_MS,
            easing: easeOutCubic,
        });
    };

    pointer.close = function (_animate) {
        let finished = false;
        const finish = () => {
            if (finished)
                return;
            finished = true;
            sourceRemove(this._kosPointerClose);
            this._kosPointerClose = 0;
            try {
                if (alive(this))
                    this.translation_y = 0;
                origClose(PopupAnimation.NONE);
            } catch (_e) {
                // already destroyed
            }
        };
        if (!alive(this) || !this.visible) {
            finish();
            return;
        }
        tween(this, {
            opacity: 0,
            translationY: 8,
            duration: POPUP_CLOSE_MS,
            easing: easeOutCubic,
            onComplete: finish,
        });
        this._kosPointerClose = after(POPUP_CLOSE_MS + 120, finish);
    };
    return pointer;
}

export function unhookBoxPointer(pointer) {
    if (!pointer?._kosAnimHooked)
        return;
    stop(pointer);
    sourceRemove(pointer._kosPointerClose);
    pointer._kosPointerClose = 0;
    if (pointer._kosOrigOpen)
        pointer.open = pointer._kosOrigOpen;
    if (pointer._kosOrigClose)
        pointer.close = pointer._kosOrigClose;
    pointer._kosAnimHooked = false;
    pointer._kosOrigOpen = null;
    pointer._kosOrigClose = null;
}
