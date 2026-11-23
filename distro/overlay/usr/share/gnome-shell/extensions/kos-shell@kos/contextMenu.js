// Right-click menus for the home grid (dark frosted, like the bar menus).
//
// A GNOME PopupMenu anchored to a 1x1 actor at the click point. Opened from
// button-press handlers on our own actors (grid icons, folder icons, the
// empty-desktop backdrop); never from stage-level handlers. The menu is
// built fresh for each click and destroyed when it closes.
//
// entries: [{label, action}] | {label, submenu: [{label, action}]} | {separator: true}

import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {later} from './folders.js';

let current = null;

export function closeContextMenu() {
    current?.close();
}

export function openContextMenu(stageX, stageY, entries) {
    closeContextMenu();

    const anchor = new St.Widget({width: 1, height: 1, reactive: false});
    Main.uiGroup.add_child(anchor);
    anchor.set_position(Math.round(stageX), Math.round(stageY));

    const menu = new PopupMenu.PopupMenu(anchor, 0.0, St.Side.TOP);
    menu.actor.add_style_class_name('kos-context-menu');
    Main.uiGroup.add_child(menu.actor);
    const manager = new PopupMenu.PopupMenuManager(anchor);
    manager.addMenu(menu);

    const effect = new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND, brightness: 0.80});
    effect.radius = 48;
    menu.box.add_effect(effect);

    for (const e of entries) {
        if (e.separator) {
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        } else if (e.submenu) {
            const sub = new PopupMenu.PopupSubMenuMenuItem(e.label);
            for (const s of e.submenu)
                sub.menu.addAction(s.label, () => s.action());
            menu.addMenuItem(sub);
        } else {
            menu.addAction(e.label, () => e.action());
        }
    }

    const handle = {close: () => menu.close()};
    current = handle;
    menu.connect('open-state-changed', (_m, open) => {
        if (open)
            return;
        if (current === handle)
            current = null;
        // Tear down after the activated item's callback has run.
        later(() => {
            manager.removeMenu(menu);
            menu.destroy();
            anchor.destroy();
        });
    });
    menu.open(true);
    return handle;
}
