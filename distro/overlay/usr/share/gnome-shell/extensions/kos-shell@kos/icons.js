// Deepin (bloom) app icons, drawn into a uniform macOS-style squircle.
//
// CSS border-radius does not clip St.Icon textures in GNOME Shell, and
// Deepin/Papirus icons are a mix of rounded squares, circles and
// free-form glyphs. Every launchpad, dock and folder icon is therefore
// rasterized into the same superellipse so later-installed apps get the
// same shape automatically.
//
// Artwork that already fills a rounded square (all four bbox edges are
// mostly opaque) is scaled to cover the tile. Everything else — a
// contacts book, a map pin, a shopping bag, a circle, a later-installed
// app — is centred on one shared dark-slate squircle with ~13% padding.
// Detection uses edge alpha, not bbox fill or a per-app list: dense
// irregular icons fooled a coverage threshold and were clipped bare.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// GNOME Icon= names -> Kora artwork aliases.
const ALIASES = {
    'firefox-esr': 'firefox',
    'org.gnome.Files': 'org.gnome.Nautilus',
    'system-file-manager': 'org.gnome.Nautilus',
    'org.gnome.Console': 'org.gnome.Terminal',
    'utilities-terminal': 'org.gnome.Terminal',
    'org.gnome.Papers': 'org.gnome.Evince',
    'org.gnome.eog': 'org.gnome.Loupe',
    'utilities-system-monitor': 'org.gnome.SystemMonitor',
    'org.gnome.Software': 'softwarecenter',
    'gnome-software': 'softwarecenter',
};

const THEMES = ['kora', 'Papirus-Dark', 'Papirus', 'Adwaita', 'hicolor'];
const CONTEXTS = ['apps', 'places', 'mimetypes', 'devices', 'categories', 'status', 'actions'];
const SIZES = [512, 256, 128, 96, 64, 'scalable', 48, 32, 24, 22, 16];
const EXTS = ['.svg', '.png'];

const _pathCache = new Map();
const _giconCache = new Map();
let _ifaceSettings = null;
let _cacheDirReady = null;

function cacheDir() {
    if (!_cacheDirReady) {
        _cacheDirReady = GLib.build_filenamev([GLib.get_user_cache_dir(), 'kos-icons']);
        GLib.mkdir_with_parents(_cacheDirReady, 0o755);
    }
    return _cacheDirReady;
}

function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

// ~11% padding on each side of artwork that sits on the shared tile.
const INSET = 0.78;
const SQUIRCLE_N = 5;
const MIN_EDGE_FILL = 0.55;
const EDGE_SAMPLE_INSET = 0.03;

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
        if (!_ifaceSettings) {
            _ifaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            _ifaceSettings.connect('changed::icon-theme', () => {
                _pathCache.clear();
                _giconCache.clear();
            });
        }
        const cur = _ifaceSettings.get_string('icon-theme');
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
    if (iconName && iconName.startsWith('/') && GLib.file_test(iconName, GLib.FileTest.IS_REGULAR))
        return iconName;
    const names = iconNames(gicon, iconName);
    const key = names.join(',');
    if (_pathCache.has(key))
        return _pathCache.get(key);

    const roots = iconRoots();
    const themes = themeList();
    let found = null;
    outer: for (const name of names) {
        if (name.startsWith('/') && GLib.file_test(name, GLib.FileTest.IS_REGULAR)) {
            found = name;
            break outer;
        }
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
        for (const ext of ['.svg', '.png', '.xpm']) {
            const pix = `/usr/share/pixmaps/${name}${ext}`;
            if (GLib.file_test(pix, GLib.FileTest.IS_REGULAR)) {
                found = pix;
                break outer;
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

function contentBBoxFromData(data, minAlpha = 16) {
    const {w, h, stride, ch, pixels} = data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) {
        const row = y * stride;
        for (let x = 0; x < w; x++) {
            if (pixels[row + x * ch + 3] > minAlpha) {
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

function contentBBox(pb, minAlpha = 16) {
    return contentBBoxFromData(pixbufBytes(pb), minAlpha);
}

// True when the artwork already is a rounded square: the opaque bbox is
// nearly square, and each of its four edges is mostly filled. Circles
// only touch the mid-edge; a contacts book / map / shopping bag leaves
// at least one edge sparse (tabs, pin, handle). Measuring bbox fill
// alone is not enough — those irregular icons are densely packed inside
// their box and used to take the cover path, so they rendered bare.
function isFullBleedSquircle(pb) {
    const data = pixbufBytes(pb);
    const [x0, y0, x1, y1] = contentBBoxFromData(data);
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw < 4 || bh < 4)
        return false;
    if (Math.min(bw, bh) / Math.max(bw, bh) < 0.80)
        return false;
    const {stride, ch, pixels} = data;
    const ix = Math.max(1, Math.round(EDGE_SAMPLE_INSET * bw));
    const iy = Math.max(1, Math.round(EDGE_SAMPLE_INSET * bh));
    const edgeFill = (count, alphaAt) => {
        let opaque = 0;
        for (let i = 0; i < count; i++) {
            if (alphaAt(i) >= 128)
                opaque++;
        }
        return opaque / count;
    };
    const top = edgeFill(bw, i => pixels[(y0 + iy) * stride + (x0 + i) * ch + 3]);
    const bot = edgeFill(bw, i => pixels[(y1 - 1 - iy) * stride + (x0 + i) * ch + 3]);
    const lef = edgeFill(bh, i => pixels[(y0 + i) * stride + (x0 + ix) * ch + 3]);
    const rig = edgeFill(bh, i => pixels[(y0 + i) * stride + (x1 - 1 - ix) * ch + 3]);
    return Math.min(top, bot, lef, rig) >= MIN_EDGE_FILL;
}

function applySquircleMask(pb, addGlass = false) {
    const {w, h, stride, ch, pixels} = pixbufBytes(pb);
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const a = Math.min(cx, cy);
    const aa = 1 + 1.5 / a;
    const invAa = 1 / (aa - 1);
    const uIn = Math.max(0, 1 - 1.4 / a);
    const rimIn = uIn * uIn * uIn * uIn * uIn;
    const invRim = 1 / Math.max(0.001, 1 - rimIn);
    const px5 = new Float32Array(w);
    const py5 = new Float32Array(h);
    for (let x = 0; x < w; x++) {
        const u = Math.abs(x - cx) / a;
        const u2 = u * u;
        px5[x] = u2 * u2 * u;
    }
    for (let y = 0; y < h; y++) {
        const u = Math.abs(y - cy) / a;
        const u2 = u * u;
        py5[y] = u2 * u2 * u;
    }
    const denom = Math.max(1, h - 1);
    for (let y = 0; y < h; y++) {
        const yt = y / denom;
        const vy = py5[y];
        const row = y * stride;
        if (addGlass) {
            // Frosted dark glass tile: slightly lifted above the dark dock bar
            // so the squircle reads crisply on both the dock and wallpaper.
            const gr0 = 42 - 18 * yt;
            const gg0 = 46 - 19 * yt;
            const gb0 = 58 - 23 * yt;
            const ga0 = (184 + 20 * yt) / 255;
            const rimAlpha = 0.24 * (1 - 0.55 * yt);
            for (let x = 0; x < w; x++) {
                const v = vy + px5[x];
                const m = v <= 1 ? 1 : (v >= aa ? 0 : 1 - (v - 1) * invAa);
                const i = row + x * ch;
                if (m === 0) {
                    pixels[i + 3] = 0;
                    continue;
                }
                let gr = gr0, gg = gg0, gb = gb0, ga = ga0;
                if (v >= rimIn) {
                    const rim = rimAlpha * (v <= 1 ? (v - rimIn) * invRim : 1);
                    gr += (255 - gr) * rim;
                    gg += (255 - gg) * rim;
                    gb += (255 - gb) * rim;
                    ga = Math.min(1, ga + (1 - ga) * rim * 0.6);
                }
                const ia = pixels[i + 3] / 255;
                const inv = ga * (1 - ia);
                const outA = ia + inv;
                if (outA > 0) {
                    pixels[i] = Math.round((pixels[i] * ia + gr * inv) / outA);
                    pixels[i + 1] = Math.round((pixels[i + 1] * ia + gg * inv) / outA);
                    pixels[i + 2] = Math.round((pixels[i + 2] * ia + gb * inv) / outA);
                }
                pixels[i + 3] = Math.round(outA * 255 * m);
            }
        } else {
            for (let x = 0; x < w; x++) {
                const v = vy + px5[x];
                if (v > 1) {
                    const m = v >= aa ? 0 : 1 - (v - 1) * invAa;
                    const i = row + x * ch + 3;
                    pixels[i] = Math.round(pixels[i] * m);
                }
            }
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
        scale, scale, GdkPixbuf.InterpType.HYPER, 255);
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
        scale, scale, GdkPixbuf.InterpType.HYPER, 255);
}

function tilePixbuf(src, size) {
    const dest = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, size, size);
    // fill() writes in place (0xRRGGBBAA). Do not use new_from_bytes
    // here: GdkPixbuf.composite cannot reliably paint onto that kind of
    // pixbuf in GJS.
    dest.fill(0x00000000);
    const fullBleed = isFullBleedSquircle(src);
    if (fullBleed)
        coverInto(src, dest);
    else
        scaleInto(src, dest, INSET);
    return applySquircleMask(dest, !fullBleed);
}

function rasterSize(size) {
    let scale = 1;
    try {
        scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
    } catch (_e) {}
    return Math.max(64, Math.min(256, Math.round(size * Math.max(2, scale))));
}

function fileMtime(path) {
    try {
        const info = Gio.File.new_for_path(path).query_info(
            'time::modified,standard::size', Gio.FileQueryInfoFlags.NONE, null);
        return `${info.get_modification_date_time()?.to_unix() ?? 0}:${info.get_size()}`;
    } catch (_e) {
        return '0:0';
    }
}

function validCachedPng(diskPath) {
    try {
        if (!GLib.file_test(diskPath, GLib.FileTest.IS_REGULAR))
            return false;
        const info = Gio.File.new_for_path(diskPath).query_info(
            'standard::size', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_size() > 64;
    } catch (_e) {
        return false;
    }
}

export function squircleGIcon(gicon, iconName, size) {
    let path = null;
    try {
        path = findIconFile(gicon, iconName);
    } catch (e) {
        logError(e, 'kos-shell: findIconFile');
    }
    const rSize = rasterSize(size);
    const key = `${path || iconName || '?'}@${rSize}`;
    if (_giconCache.has(key))
        return _giconCache.get(key);
    let out = null;
    try {
        if (path) {
            const cacheKey = fnv1a(`v12|${path}|${fileMtime(path)}|${rSize}`);
            const diskPath = GLib.build_filenamev([cacheDir(), `v12-${cacheKey}.png`]);
            if (!validCachedPng(diskPath)) {
                const src = loadPixbuf(path, Math.max(256, rSize * 2));
                if (src && src.get_width() > 0 && src.get_height() > 0) {
                    const tmpPath = `${diskPath}.tmp`;
                    tilePixbuf(src, rSize).savev(tmpPath, 'png', [], []);
                    if (validCachedPng(tmpPath))
                        Gio.File.new_for_path(tmpPath).move(
                            Gio.File.new_for_path(diskPath),
                            Gio.FileCopyFlags.OVERWRITE, null, null);
                }
            }
            if (validCachedPng(diskPath))
                out = Gio.FileIcon.new(Gio.File.new_for_path(diskPath));
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
