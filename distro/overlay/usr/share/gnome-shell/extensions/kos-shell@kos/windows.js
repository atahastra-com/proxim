// Window open, close, minimize, unminimize and maximize animations.
//
// Mutter skips these when enable-animations is false, so we hook
// Main.wm and tween opacity/scale/translation ourselves. Only NORMAL
// and dialog windows are animated; menus and override-redirect stay snap.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    CLOSE_MS, MAXIMIZE_MS, MINIMIZE_MS, OPEN_MS,
    easeOutCubic, easeOutQuint, reduceMotion, tween,
} from './anim.js';
import {dockIconCenter} from './dock.js';

const ANIMATED_TYPES = new Set([
    Meta.WindowType.NORMAL,
]);

function windowType(actor) {
    try {
        return actor?.meta_window?.get_window_type();
    } catch (_e) {
        return null;
    }
}

function shouldAnimate(actor) {
    if (reduceMotion() || Main.layoutManager._startingUp)
        return false;
    if (!actor?.meta_window)
        return false;
    const win = actor.meta_window;
    if (win.is_override_redirect?.())
        return false;
    const type = windowType(actor);
    return ANIMATED_TYPES.has(type);
}

function resetActor(actor) {
    if (!actor)
        return;
    try {
        actor.opacity = 255;
        actor.set_scale(1, 1);
        actor.translation_x = 0;
        actor.translation_y = 0;
        actor.set_pivot_point(0, 0);
    } catch (_e) {
        // destroyed
    }
}

function actorCenter(actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return {x: x + w / 2, y: y + h / 2, w, h};
}

export class KosWindows {
    enable() {
        const wm = Main.wm;
        this._wm = wm;
        this._saved = {};
        for (const name of [
            '_mapWindow',
            '_destroyWindow',
            '_minimizeWindow',
            '_unminimizeWindow',
            '_sizeChangeWindow',
        ]) {
            if (typeof wm[name] !== 'function')
                continue;
            this._saved[name] = wm[name];
            wm[name] = this[name].bind(this);
        }
    }

    disable() {
        const wm = this._wm;
        if (wm && this._saved) {
            for (const [name, fn] of Object.entries(this._saved)) {
                if (wm[name] === this[name] || typeof wm[name] === 'function')
                    wm[name] = fn;
            }
        }
        this._saved = null;
        this._wm = null;
    }

    _fallback(name, args) {
        const fn = this._saved?.[name];
        if (fn)
            fn.apply(this._wm, args);
    }

    _mapWindow(shellwm, actor) {
        if (!shouldAnimate(actor)) {
            this._fallback('_mapWindow', [shellwm, actor]);
            return;
        }
        try {
            actor.set_pivot_point(0.5, 0.5);
            actor.set_scale(0.92, 0.92);
            actor.opacity = 0;
            tween(actor, {
                scale: 1,
                opacity: 255,
                duration: OPEN_MS,
                easing: easeOutQuint,
                onComplete: () => {
                    resetActor(actor);
                    shellwm.completed_map(actor);
                },
            });
        } catch (e) {
            logError(e, 'kos-shell: map animation');
            this._fallback('_mapWindow', [shellwm, actor]);
        }
    }

    _destroyWindow(shellwm, actor) {
        if (!shouldAnimate(actor) || actor._kosDestroying) {
            this._fallback('_destroyWindow', [shellwm, actor]);
            return;
        }
        try {
            actor._kosDestroying = true;
            actor.set_pivot_point(0.5, 0.5);
            tween(actor, {
                scale: 0.92,
                opacity: 0,
                duration: CLOSE_MS,
                easing: easeOutQuint,
                onComplete: () => {
                    try {
                        shellwm.completed_destroy(actor);
                    } catch (_e) {
                        this._fallback('_destroyWindow', [shellwm, actor]);
                    }
                },
            });
        } catch (e) {
            logError(e, 'kos-shell: destroy animation');
            this._fallback('_destroyWindow', [shellwm, actor]);
        }
    }

    _minimizeWindow(shellwm, actor) {
        if (!shouldAnimate(actor)) {
            this._fallback('_minimizeWindow', [shellwm, actor]);
            return;
        }
        try {
            const app = Shell.WindowTracker.get_default().get_window_app(actor.meta_window);
            const dest = dockIconCenter(app);
            const src = actorCenter(actor);
            actor.set_pivot_point(0.5, 0.5);
            const tx = dest ? dest.x - src.x : 0;
            const ty = dest ? dest.y - src.y : Math.round(src.h / 2);
            tween(actor, {
                scale: 0.15,
                opacity: 0,
                translationX: tx,
                translationY: ty,
                duration: MINIMIZE_MS,
                easing: easeOutCubic,
                onComplete: () => {
                    resetActor(actor);
                    shellwm.completed_minimize(actor);
                },
            });
        } catch (e) {
            logError(e, 'kos-shell: minimize animation');
            this._fallback('_minimizeWindow', [shellwm, actor]);
        }
    }

    _unminimizeWindow(shellwm, actor) {
        if (!shouldAnimate(actor)) {
            this._fallback('_unminimizeWindow', [shellwm, actor]);
            return;
        }
        try {
            const app = Shell.WindowTracker.get_default().get_window_app(actor.meta_window);
            const dest = dockIconCenter(app);
            const src = actorCenter(actor);
            actor.set_pivot_point(0.5, 0.5);
            actor.set_scale(0.15, 0.15);
            actor.opacity = 0;
            actor.translation_x = dest ? dest.x - src.x : 0;
            actor.translation_y = dest ? dest.y - src.y : Math.round(src.h / 2);
            tween(actor, {
                scale: 1,
                opacity: 255,
                translationX: 0,
                translationY: 0,
                duration: MINIMIZE_MS,
                easing: easeOutCubic,
                onComplete: () => {
                    resetActor(actor);
                    shellwm.completed_unminimize(actor);
                },
            });
        } catch (e) {
            logError(e, 'kos-shell: unminimize animation');
            this._fallback('_unminimizeWindow', [shellwm, actor]);
        }
    }

    _sizeChangeWindow(shellwm, actor, whichChange, oldFrameRect, oldBufferRect) {
        if (!shouldAnimate(actor) || !oldFrameRect) {
            this._fallback('_sizeChangeWindow', [shellwm, actor, whichChange, oldFrameRect, oldBufferRect]);
            return;
        }
        const kinds = Meta.SizeChange;
        const ours = whichChange === kinds.MAXIMIZE || whichChange === kinds.UNMAXIMIZE ||
            whichChange === kinds.FULLSCREEN || whichChange === kinds.UNFULLSCREEN;
        if (!ours) {
            this._fallback('_sizeChangeWindow', [shellwm, actor, whichChange, oldFrameRect, oldBufferRect]);
            return;
        }
        try {
            // Let mutter apply the new geometry first, then tween from the
            // old visual size (a scale/translation, no layout reflow).
            shellwm.completed_size_change(actor);
            const neu = actor.meta_window.get_frame_rect();
            if (!neu || neu.width < 1 || neu.height < 1) {
                resetActor(actor);
                return;
            }
            const sx = oldFrameRect.width / neu.width;
            const sy = oldFrameRect.height / neu.height;
            const tx = oldFrameRect.x - neu.x;
            const ty = oldFrameRect.y - neu.y;
            if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01 &&
                Math.abs(tx) < 2 && Math.abs(ty) < 2) {
                resetActor(actor);
                return;
            }
            actor.set_pivot_point(0, 0);
            actor.set_scale(sx, sy);
            actor.translation_x = tx;
            actor.translation_y = ty;
            tween(actor, {
                scaleX: 1,
                scaleY: 1,
                translationX: 0,
                translationY: 0,
                duration: MAXIMIZE_MS,
                easing: easeOutCubic,
                onComplete: () => resetActor(actor),
            });
        } catch (e) {
            logError(e, 'kos-shell: size-change animation');
            this._fallback('_sizeChangeWindow', [shellwm, actor, whichChange, oldFrameRect, oldBufferRect]);
        }
    }
}
