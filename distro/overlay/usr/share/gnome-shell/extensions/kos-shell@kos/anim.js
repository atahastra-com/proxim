// kos animation helper.
//
// GNOME's actor.ease() snaps because the image sets enable-animations=false
// (a VM-CPU choice, not a reduced-motion request). This ticks opacity,
// scale and translation on a 16ms GLib timer with ease-out cubic/quint,
// the same path the dock hover zoom already uses. Cheap paint transforms
// only — never animate a blur radius.

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
    // enable-animations is forced off for VM CPU, so it is not used here.
    return GLib.getenv('KOS_REDUCE_MOTION') === '1';
}

export function stop(actor) {
    if (!actor)
        return;
    const id = actor._kosAnim;
    if (id) {
        GLib.source_remove(id);
        actor._kosAnim = 0;
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
    for (const key of PROPS) {
        if (key in props)
            write(actor, key, props[key]);
    }
}

// Tween the listed properties from their current values. Retargeting the
// same actor stops the previous tween first. duration is milliseconds.
export function tween(actor, {
    duration = OPEN_MS,
    easing = easeOutCubic,
    onComplete = null,
    ...props
} = {}) {
    if (!actor) {
        onComplete?.();
        return;
    }
    stop(actor);
    if (!alive(actor) || reduceMotion() || duration <= 0) {
        apply(actor, props);
        onComplete?.();
        return;
    }
    const keys = PROPS.filter(k => k in props);
    if (keys.length === 0) {
        onComplete?.();
        return;
    }
    const from = {};
    for (const key of keys)
        from[key] = read(actor, key);
    const start = GLib.get_monotonic_time();
    actor._kosAnim = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
        if (!alive(actor)) {
            actor._kosAnim = 0;
            onComplete?.();
            return GLib.SOURCE_REMOVE;
        }
        const t = Math.min(1, (GLib.get_monotonic_time() - start) / (duration * 1000));
        const e = easing(t);
        for (const key of keys)
            write(actor, key, from[key] + (props[key] - from[key]) * e);
        if (t >= 1) {
            actor._kosAnim = 0;
            onComplete?.();
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
}

export function after(ms, fn) {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, ms), () => {
        fn();
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
        if (!alive(this))
            return;
        stop(this);
        this.opacity = 0;
        this.translation_y = 8;
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
            this.translation_y = 0;
            try {
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
        // If the tween never fires, still close so the menu cannot stick.
        after(POPUP_CLOSE_MS + 120, finish);
    };
    return pointer;
}

export function unhookBoxPointer(pointer) {
    if (!pointer?._kosAnimHooked)
        return;
    stop(pointer);
    if (pointer._kosOrigOpen)
        pointer.open = pointer._kosOrigOpen;
    if (pointer._kosOrigClose)
        pointer.close = pointer._kosOrigClose;
    pointer._kosAnimHooked = false;
    pointer._kosOrigOpen = null;
    pointer._kosOrigClose = null;
}
