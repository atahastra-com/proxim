// Deepin (DDE 23) control-center layout for GNOME's quick settings popup.
//
// GNOME keeps its quick settings in one grid (menu._grid) with 2 columns.
// We switch it to 4 columns and reorder the same items, top to bottom:
//   network + bluetooth   wide tiles (2 columns): icon circle, title, subtitle, chevron
//   night light           wide tile ("eye comfort")
//   every other toggle    small square tiles (1 column): icon over a label
//   our own tiles         Do Not Disturb, Screenshot, Record, System Monitor
//   sliders               full-width cards, with a settings button on the right
//   system row            settings gear on the left, lock + power on the right
// disable() puts every item, span and style back, so hot reload stays clean.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {
    QuickToggle, QuickMenuToggle, QuickSlider,
} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const COLUMNS = 4;
// screenshot.js does not export UIMode; 1 is UIMode.SCREENCAST in GNOME 48.
const SCREENCAST_MODE = 1;

export class KosQuickPanel {
    enable() {
        this._qs = Main.panel.statusArea.quickSettings;
        if (!this._qs?.menu?._grid)
            return;
        this._grid = this._qs.menu._grid;
        this._layout = this._grid.layout_manager;
        this._origColumns = this._layout.nColumns;
        this._origSpans = new Map();     // item -> column-span before us
        this._origOrder = [];            // grid children before us
        this._undo = [];                 // functions that revert one change
        this._styled = new Set();
        this._own = [];
        this._relayoutId = 0;

        this._qs.menu._boxPointer.add_style_class_name('kos-cc-boxpointer');
        this._qs.menu.box.add_style_class_name('kos-cc');

        this._addOwnTiles();
        // GNOME adds its items asynchronously, and other extensions can add
        // more later, so redo the layout whenever the grid gains a child.
        this._childAddedId = this._grid.connect('child-added', () => this._queueRelayout());
        this._relayout();
    }

    disable() {
        if (!this._grid)
            return;
        if (this._relayoutId)
            GLib.source_remove(this._relayoutId);
        this._relayoutId = 0;
        this._grid.disconnect(this._childAddedId);

        for (const tile of this._own)
            tile.destroy();
        this._own = [];
        this._dndSettings = null;

        for (const fn of this._undo.reverse())
            fn();
        this._undo = [];

        this._layout.nColumns = this._origColumns;
        for (const [item, span] of this._origSpans) {
            if (item.get_parent() === this._grid)
                this._layout.child_set_property(this._grid, item, 'column-span', span);
        }
        this._origOrder.forEach((item, i) => {
            if (item.get_parent() === this._grid)
                this._grid.set_child_at_index(item, i);
        });

        this._qs.menu._boxPointer.remove_style_class_name('kos-cc-boxpointer');
        this._qs.menu.box.remove_style_class_name('kos-cc');
        this._grid = null;
        this._qs = null;
    }

    _queueRelayout() {
        if (this._relayoutId)
            return;
        this._relayoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._relayoutId = 0;
            this._relayout();
            return GLib.SOURCE_REMOVE;
        });
    }

    _relayout() {
        const qs = this._qs;
        const placeholder = this._layout._overlay;
        const itemsOf = ind => ind?.quickSettingsItems ?? [];
        const children = this._grid.get_children().filter(c => c !== placeholder);

        for (const child of children) {
            if (this._origSpans.has(child) || this._own.includes(child))
                continue;
            this._origSpans.set(child,
                this._layout.get_child_meta(this._grid, child).columnSpan);
            this._origOrder.push(child);
        }

        const wide = [...itemsOf(qs._network), ...itemsOf(qs._bluetooth)];
        const eye = itemsOf(qs._nightLight);
        const system = itemsOf(qs._system);
        const background = itemsOf(qs._backgroundApps);
        const brightness = itemsOf(qs._brightness);
        const known = new Set([...wide, ...eye, ...system, ...background, ...this._own]);

        const small = [];
        const sliders = [];
        for (const child of children) {
            if (known.has(child))
                continue;
            if (child instanceof QuickSlider)
                sliders.push(child);
            else
                small.push(child);
        }
        // Brightness card above volume, like Deepin.
        sliders.sort((a, b) => Number(brightness.includes(b)) - Number(brightness.includes(a)));

        const rows = [
            [wide.filter(c => c.get_parent() === this._grid), 2, c => this._styleWide(c)],
            [eye.filter(c => c.get_parent() === this._grid), 2, c => this._styleWide(c)],
            [small, 1, c => this._styleSmall(c)],
            [this._own, 1, () => {}],
            [sliders, COLUMNS, c => this._styleCard(c)],
            [background, COLUMNS, () => {}],
            [system, COLUMNS, c => this._styleSystem(c)],
        ];

        this._layout.nColumns = COLUMNS;
        this._grid.set_child_at_index(placeholder, 0);
        let index = 1;
        for (const [items, span, style] of rows) {
            for (const item of items) {
                if (item.get_parent() !== this._grid)
                    continue;
                this._grid.set_child_at_index(item, index++);
                this._layout.child_set_property(this._grid, item, 'column-span', span);
                if (!this._styled.has(item)) {
                    this._styled.add(item);
                    style(item);
                }
            }
        }
        this._layout.layout_changed();
    }

    _addClass(actor, name) {
        actor.add_style_class_name(name);
        this._undo.push(() => actor.remove_style_class_name(name));
    }

    // Icon circle, bold title, gray subtitle, chevron: mostly CSS. Deepin
    // always shows a status line, so fill in one when GNOME leaves it empty.
    _styleWide(item) {
        this._addClass(item, 'kos-cc-wide');
        const bluetooth = (this._qs._bluetooth?.quickSettingsItems ?? []).includes(item);
        const network = (this._qs._network?.quickSettingsItems ?? []).includes(item);
        let ours = null;
        const status = () => {
            if (!item.checked)
                return 'Off';
            if (bluetooth)
                return 'Not connected';
            return network ? 'Connected' : 'On';
        };
        const sync = () => {
            if (item.subtitle && item.subtitle !== ours)
                return;
            ours = status();
            if (item.subtitle !== ours)
                item.subtitle = ours;
        };
        const ids = [
            item.connect('notify::subtitle', sync),
            item.connect('notify::checked', sync),
        ];
        sync();
        this._undo.push(() => {
            ids.forEach(id => item.disconnect(id));
            if (ours !== null && item.subtitle === ours)
                item.subtitle = null;
        });
    }

    // Square tile: icon on top, one small label under it, no subtitle or chevron.
    _styleSmall(item) {
        this._addClass(item, 'kos-cc-small');
        let toggle = item;
        if (item instanceof QuickMenuToggle) {
            toggle = item._box.get_first_child();
            const hidden = item._box.get_children().filter(c => c !== toggle && c.visible);
            hidden.forEach(c => c.hide());
            // menu-enabled re-shows the chevron; keep it hidden while we run.
            const id = item._menuButton.connect('notify::visible', b => b.visible && b.hide());
            this._undo.push(() => {
                item._menuButton.disconnect(id);
                hidden.forEach(c => c.show());
                item._menuButton.visible = item.menuEnabled;
            });
        }
        if (!(toggle instanceof QuickToggle))
            return;

        const titleBox = toggle._title.get_parent();
        toggle._box.orientation = Clutter.Orientation.VERTICAL;
        toggle._icon.x_align = Clutter.ActorAlign.CENTER;
        titleBox.x_align = Clutter.ActorAlign.CENTER;
        toggle._title.x_align = Clutter.ActorAlign.CENTER;
        toggle._subtitle.hide();
        const id = toggle._subtitle.connect('notify::visible', l => l.visible && l.hide());
        this._undo.push(() => {
            toggle._subtitle.disconnect(id);
            toggle._subtitle.visible = toggle.subtitle !== null;
            toggle._title.x_align = Clutter.ActorAlign.START;
            titleBox.x_align = Clutter.ActorAlign.START;
            toggle._icon.x_align = Clutter.ActorAlign.FILL;
            toggle._box.orientation = Clutter.Orientation.HORIZONTAL;
        });
    }

    // Slider in its own card, with a button on the right that opens the
    // matching settings page (Deepin shows a device button there).
    _styleCard(slider) {
        this._addClass(slider, 'kos-cc-card');
        const brightness = (this._qs._brightness?.quickSettingsItems ?? []).includes(slider);
        const button = new St.Button({
            style_class: 'icon-button flat kos-cc-card-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: brightness ? 'video-display-symbolic' : 'audio-speakers-symbolic',
            }),
            accessible_name: brightness ? 'Display settings' : 'Sound settings',
        });
        button.connect('clicked', () => this._openSettings(brightness ? 'display' : 'sound'));
        slider.get_child().add_child(button);
        this._undo.push(() => button.destroy());
    }

    // Bottom row: gear left, lock and power right. The screenshot button
    // moves up into its own tile.
    _styleSystem(item) {
        this._addClass(item, 'kos-cc-system');
        const shot = item.get_child()?.get_children()
            .find(c => c.icon_name === 'screenshooter-symbolic');
        if (shot?.visible) {
            shot.hide();
            this._undo.push(() => shot.show());
        }
    }

    _addOwnTiles() {
        const add = (title, iconName, onClick) => {
            const tile = new QuickToggle({title, iconName, toggleMode: false});
            tile.add_style_class_name('kos-cc-small');
            tile.connect('clicked', onClick);
            this._own.push(tile);
            this._grid.add_child(tile);
            this._styleSmallOwn(tile);
            return tile;
        };

        this._dndSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        const dnd = add('DND Mode', 'notifications-disabled-symbolic', () =>
            this._dndSettings.set_boolean('show-banners', !this._dndSettings.get_boolean('show-banners')));
        const syncDnd = () => (dnd.checked = !this._dndSettings.get_boolean('show-banners'));
        this._dndSettings.connectObject('changed::show-banners', syncDnd, dnd);
        syncDnd();

        add('Screenshot', 'screenshooter-symbolic', () => this._afterClose(
            () => Main.screenshotUI.open().catch(logError)));
        add('Record', 'media-record-symbolic', () => this._afterClose(
            () => Main.screenshotUI.open(SCREENCAST_MODE).catch(logError)));

        const monitor = Shell.AppSystem.get_default().lookup_app('org.gnome.SystemMonitor.desktop');
        if (monitor) {
            add('System Monitor', 'utilities-system-monitor-symbolic', () => this._afterClose(
                () => monitor.activate()));
        }
    }

    _styleSmallOwn(tile) {
        tile._box.orientation = Clutter.Orientation.VERTICAL;
        tile._icon.x_align = Clutter.ActorAlign.CENTER;
        tile._title.get_parent().x_align = Clutter.ActorAlign.CENTER;
        tile._title.x_align = Clutter.ActorAlign.CENTER;
    }

    // Same order GNOME's own screenshot button uses: close, then act.
    _afterClose(fn) {
        global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._qs.menu.close(PopupAnimation.NONE);
    }

    _openSettings(panel) {
        this._afterClose(() => {
            try {
                Gio.Subprocess.new(['gnome-control-center', panel], Gio.SubprocessFlags.NONE);
            } catch (e) {
                logError(e);
            }
        });
    }
}
