// Deepin (bloom) app icons, drawn into a uniform macOS-style squircle.
//
// CSS border-radius does not clip St.Icon textures in GNOME Shell, and
// Deepin/Papirus icons are a mix of rounded squares, circles and
// free-form glyphs. Every launchpad, dock and folder icon is therefore
// rasterized into the same superellipse so later-installed apps get the
// same shape automatically.
//
// Rounded-square artwork is scaled to fill the tile (cover). Circles
// and sparse glyphs sit inset on a squircle filled with the icon's
// dominant colour.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// GNOME Icon= names → Deepin bloom artwork (same package, clearer match
// than the Papirus fallback bloom inherits).
const ALIASES = {
    'firefox-esr': 'firefox',
    'firefox': 'firefox',
    'org.gnome.Nautilus': 'dde-file-manager',
    'org.gnome.Files': 'dde-file-manager',
    'system-file-manager': 'dde-file-manager',
    'org.gnome.Terminal': 'deepin-terminal',
    'org.gnome.Console': 'deepin-terminal',
    'utilities-terminal': 'deepin-terminal',
    'org.gnome.Settings': 'preferences-system',
    'org.gnome.TextEditor': 'deepin-editor',
    'accessories-text-editor': 'deepin-editor',
    'org.gnome.Calculator': 'deepin-calculator',
    'accessories-calculator': 'deepin-calculator',
    'org.gnome.Calendar': 'dde-calendar',
    'gnome-calendar': 'dde-calendar',
    'org.gnome.Snapshot': 'deepin-camera',
    'camera-photo': 'deepin-camera',
    'org.gnome.Loupe': 'deepin-image-viewer',
    'org.gnome.eog': 'deepin-image-viewer',
    'org.gnome.SystemMonitor': 'deepin-system-monitor',
    'utilities-system-monitor': 'deepin-system-monitor',
    'org.gnome.font-viewer': 'deepin-font-manager',
    'org.gnome.baobab': 'deepin-diskmanager',
    'baobab': 'deepin-diskmanager',
    'org.gnome.Evince': 'evince',
    'org.gnome.Papers': 'evince',
    'org.gnome.Totem': 'deepin-movie',
    'totem': 'deepin-movie',
    'yelp': 'deepin-manual',
    'org.gnome.Yelp': 'deepin-manual',
    'help-browser': 'deepin-manual',
};

const THEMES = ['bloom', 'bloom-dark', 'Papirus', 'Papirus-Dark', 'Adwaita', 'hicolor'];
const CONTEXTS = ['apps', 'places', 'mimetypes', 'devices', 'categories', 'status', 'actions'];
const SIZES = [512, 256, 128, 96, 64, 'scalable', 48, 32, 24, 22, 16];
const EXTS = ['.svg', '.png'];

const _pathCache = new Map();
const _giconCache = new Map();

const COVER_COVERAGE = 0.84;
const INSET = 0.84;
const SQUIRCLE_N = 5;

export function squircleRadius(size) {
    return Math.round(size * 0.223);
}

function iconNames(gicon, iconName) {
    const names = [];
    const seen = new Set();
    const push = n => {
        if (!n || seen.has(n))
            return;
        seen.add(n);
        names.push(n);
    };
    const consider = n => {
        if (ALIASES[n])
            push(ALIASES[n]);
        push(n);
    };
    if (iconName)
        consider(iconName);
    if (gicon) {
        let raw = null;
        try {
            if (typeof gicon.get_names === 'function')
                raw = gicon.get_names();
            else if (gicon.names)
                raw = gicon.names;
        } catch (_e) {}
        if (raw) {
            const list = typeof raw === 'string' ? [raw] : [...raw];
            for (const n of list)
                consider(n);
        }
    }
    return names;
}

function iconRoots() {
    const roots = [];
    const add = base => {
        const p = `${base}/icons`;
        if (GLib.file_test(p, GLib.FileTest.IS_DIR))
            roots.push(p);
    };
    add(GLib.get_home_dir() + '/.icons');
    add(GLib.get_user_data_dir());
    for (const d of GLib.get_system_data_dirs())
        add(d);
    if (!roots.includes('/usr/share/icons'))
        roots.push('/usr/share/icons');
    return roots;
}

function themeList() {
    const themes = [...THEMES];
    try {
        const cur = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
            .get_string('icon-theme');
        if (cur && cur !== 'kos-icons')
            themes.unshift(cur);
    } catch (_e) {}
    return themes;
}

function findIconFile(gicon, iconName) {
    if (gicon instanceof Gio.FileIcon) {
        const p = gicon.get_file()?.get_path();
        if (p && GLib.file_test(p, GLib.FileTest.IS_REGULAR))
            return p;
    }
    const names = iconNames(gicon, iconName);
    const key = names.join(',');
    if (_pathCache.has(key))
        return _pathCache.get(key);

    const roots = iconRoots();
    const themes = themeList();
    let found = null;
    outer: for (const name of names) {
        for (const root of roots) {
            for (const theme of themes) {
                const dirs = [];
                for (const ctx of CONTEXTS) {
                    for (const sz of SIZES) {
                        dirs.push(`${ctx}/${sz}`);
                        if (typeof sz === 'number')
                            dirs.push(`${sz}x${sz}/${ctx}`);
                        else
                            dirs.push(`${sz}/${ctx}`);
                    }
                }
                for (const dir of dirs) {
                    for (const ext of EXTS) {
                        const p = `${root}/${theme}/${dir}/${name}${ext}`;
                        if (GLib.file_test(p, GLib.FileTest.IS_REGULAR)) {
                            found = p;
                            break outer;
                        }
                    }
                }
            }
        }
    }
    _pathCache.set(key, found);
    return found;
}

function loadPixbuf(path, size) {
    const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, size, size, true);
    return pb.get_has_alpha() ? pb : pb.add_alpha(false, 0, 0, 0);
}

function pixbufBytes(pb) {
    const w = pb.get_width();
    const h = pb.get_height();
    const stride = pb.get_rowstride();
    const ch = pb.get_n_channels();
    // get_pixels() returns a copy in GJS; mutations do not write back.
    const pixels = new Uint8Array(pb.get_pixels());
    return {w, h, stride, ch, pixels};
}

function pixbufFromPixels(w, h, stride, pixels) {
    const bytes = GLib.Bytes.new(pixels);
    const out = GdkPixbuf.Pixbuf.new_from_bytes(
        bytes, GdkPixbuf.Colorspace.RGB, true, 8, w, h, stride);
    out._bytes = bytes;
    return out;
}

function contentBBox(pb, minAlpha = 16) {
    const {w, h, stride, ch, pixels} = pixbufBytes(pb);
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (pixels[y * stride + x * ch + 3] > minAlpha) {
                if (x < x0) x0 = x;
                if (y < y0) y0 = y;
                if (x > x1) x1 = x;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < x0)
        return [0, 0, w, h];
    return [x0, y0, x1 + 1, y1 + 1];
}

function bboxCoverage(pb) {
    const [x0, y0, x1, y1] = contentBBox(pb);
    const {stride, ch, pixels} = pixbufBytes(pb);
    let n = 0, opaque = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            n++;
            if (pixels[y * stride + x * ch + 3] > 40)
                opaque++;
        }
    }
    return n ? opaque / n : 0;
}

function dominantColor(pb) {
    const {w, h, stride, ch, pixels} = pixbufBytes(pb);
    let rs = 0, gs = 0, bs = 0, n = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * stride + x * ch;
            const a = pixels[i + 3];
            if (a < 32)
                continue;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            const sat = Math.max(r, g, b) - Math.min(r, g, b);
            const wt = (a / 255) * (0.35 + 0.65 * (sat / 255));
            rs += r * wt;
            gs += g * wt;
            bs += b * wt;
            n += wt;
        }
    }
    if (n <= 0)
        return [40, 42, 52];
    let r = rs / n, g = gs / n, b = bs / n;
    const mn = Math.min(r, g, b);
    r += (r - mn) * 0.15;
    g += (g - mn) * 0.15;
    b += (b - mn) * 0.15;
    return [
        Math.max(0, Math.min(255, Math.round(r))),
        Math.max(0, Math.min(255, Math.round(g))),
        Math.max(0, Math.min(255, Math.round(b))),
    ];
}

function applySquircleMask(pb) {
    const {w, h, stride, ch, pixels} = pixbufBytes(pb);
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const a = Math.min(cx, cy);
    const aa = 1 + 2.5 / a;
    const n = SQUIRCLE_N;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = Math.pow(Math.abs(x - cx) / a, n) + Math.pow(Math.abs(y - cy) / a, n);
            let m = 1;
            if (v > 1)
                m = v >= aa ? 0 : 1 - (v - 1) / (aa - 1);
            const i = y * stride + x * ch + 3;
            pixels[i] = Math.round(pixels[i] * m);
        }
    }
    return pixbufFromPixels(w, h, stride, pixels);
}

function scaleInto(src, dest, fill) {
    const size = dest.get_width();
    const [x0, y0, x1, y1] = contentBBox(src);
    const cw = Math.max(1, x1 - x0);
    const ch = Math.max(1, y1 - y0);
    const box = Math.round(size * fill);
    const scale = Math.min(box / cw, box / ch);
    const nw = Math.max(1, Math.round(cw * scale));
    const nh = Math.max(1, Math.round(ch * scale));
    const dx = Math.round((size - nw) / 2);
    const dy = Math.round((size - nh) / 2);
    src.composite(
        dest, dx, dy, nw, nh,
        dx - x0 * scale, dy - y0 * scale,
        scale, scale, GdkPixbuf.InterpType.BILINEAR, 255);
}

function coverInto(src, dest) {
    const size = dest.get_width();
    const [x0, y0, x1, y1] = contentBBox(src);
    const cw = Math.max(1, x1 - x0);
    const ch = Math.max(1, y1 - y0);
    const scale = Math.max(size / cw, size / ch);
    const nw = Math.round(cw * scale);
    const nh = Math.round(ch * scale);
    const dx = Math.round((size - nw) / 2);
    const dy = Math.round((size - nh) / 2);
    src.composite(
        dest, 0, 0, size, size,
        dx - x0 * scale, dy - y0 * scale,
        scale, scale, GdkPixbuf.InterpType.BILINEAR, 255);
}

function tilePixbuf(src, size) {
    const dest = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, size, size);
    dest.fill(0x00000000);
    if (bboxCoverage(src) >= COVER_COVERAGE) {
        coverInto(src, dest);
    } else {
        const [r, g, b] = dominantColor(src);
        // fill() writes in place (0xRRGGBBAA). Do not use new_from_bytes
        // here: GdkPixbuf.composite cannot reliably paint onto that kind of
        // pixbuf in GJS.
        // JS bitwise is signed 32-bit; >>> 0 keeps 0xRRGGBBAA as guint32.
        dest.fill(((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0);
        scaleInto(src, dest, INSET);
    }
    return applySquircleMask(dest);
}

function pixbufToGIcon(pb) {
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'kos-icons']);
    GLib.mkdir_with_parents(dir, 0o755);
    // Unique name from a cheap checksum of pixels so icons don't overwrite.
    const {pixels} = pixbufBytes(pb);
    let h = 2166136261;
    for (let i = 0; i < pixels.length; i += 17) {
        h ^= pixels[i];
        h = Math.imul(h, 16777619);
    }
    const path = GLib.build_filenamev([dir, `${(h >>> 0).toString(16)}.png`]);
    pb.savev(path, 'png', [], []);
    return Gio.FileIcon.new(Gio.File.new_for_path(path));
}

function rasterSize(size) {
    let scale = 1;
    try {
        scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
    } catch (_e) {}
    return Math.max(64, Math.min(256, Math.round(size * Math.max(2, scale))));
}

export function squircleGIcon(gicon, iconName, size) {
    let path = null;
    try {
        path = findIconFile(gicon, iconName);
    } catch (e) {
        logError(e, 'kos-shell: findIconFile');
    }
    const key = `${path || iconName || '?'}@${size}`;
    if (_giconCache.has(key))
        return _giconCache.get(key);
    let out = null;
    try {
        if (path) {
            const src = loadPixbuf(path, rasterSize(size));
            out = pixbufToGIcon(tilePixbuf(src, rasterSize(size)));
        }
    } catch (e) {
        logError(e, `kos-shell: squircle icon ${path || iconName}`);
    }
    _giconCache.set(key, out);
    return out;
}

export function squircleIcon({
    gicon = null,
    icon_name = null,
    fallback_icon_name = 'application-x-executable',
    icon_size: size = 64,
    style_class = '',
    x_align = Clutter.ActorAlign.CENTER,
    y_align = Clutter.ActorAlign.CENTER,
} = {}) {
    const baked = squircleGIcon(gicon, icon_name, size) ||
        squircleGIcon(null, fallback_icon_name, size);
    if (baked) {
        return new St.Icon({
            gicon: baked,
            icon_size: size,
            style_class,
            x_align,
            y_align,
        });
    }
    return new St.Icon({
        gicon,
        icon_name: gicon ? null : icon_name,
        fallback_icon_name,
        icon_size: size,
        style_class,
        x_align,
        y_align,
    });
}
