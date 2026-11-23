#!/usr/bin/env bash
# Build the kos-icons icon theme from distro/icons/sources/*.icns
# (icons downloaded from macosicons.com for personal use).
#
# Writes distro/overlay/usr/share/icons/kos-icons/ and distro/icons/ATTRIBUTION.txt.
set -euo pipefail
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

ICONS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KOS="$(cd "${ICONS}/../.." && pwd)"
MAP="${ICONS}/mapping.json"
SRC="${ICONS}/sources"
THEME_NAME="kos-icons"
DEST="${KOS}/distro/overlay/usr/share/icons/${THEME_NAME}"
ATTR="${ICONS}/ATTRIBUTION.txt"

missing=0
command -v python3 >/dev/null || { echo "missing python3: run sudo apt install -y python3" >&2; missing=1; }
command -v icns2png >/dev/null || { echo "missing icns2png: run sudo apt install -y icnsutils" >&2; missing=1; }
if command -v magick >/dev/null; then
  IM=(magick)
elif command -v convert >/dev/null; then
  IM=(convert)
fi
# identify(1) is used to validate extracted PNGs; it ships with imagemagick.
if [[ -z "${IM:-}" ]] || ! command -v identify >/dev/null; then
  echo "missing ImageMagick (magick or convert): run sudo apt install -y imagemagick" >&2
  missing=1
fi
if (( missing )); then
  if [[ -f "${DEST}/index.theme" ]]; then
    echo "warning: using the existing kos-icons theme (install the tools above to rebuild it)" >&2
    exit 0
  fi
  exit 1
fi

if [[ ! -f "$MAP" ]]; then
  echo "missing ${MAP}" >&2
  exit 1
fi
if [[ ! -d "$SRC" ]] || ! compgen -G "${SRC}/*.icns" >/dev/null; then
  echo "No .icns sources in ${SRC}. Download them first (see README.md)." >&2
  exit 1
fi

SIZES=(16 24 32 48 64 128 256 512)
WORKDIR="${ICONS}/.build-tmp"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"

python3 - "$MAP" "$SRC" "$DEST" "$WORKDIR" "$ATTR" "${IM[*]}" "${SIZES[*]}" << 'PY'
import json, os, shutil, subprocess, sys
from pathlib import Path

map_path, src_dir, dest, work, attr_path, im_cmd, sizes_s = sys.argv[1:8]
im = im_cmd.split()
sizes = [int(s) for s in sizes_s.split()]
mapping = json.loads(Path(map_path).read_text())
src_dir, dest, work = Path(src_dir), Path(dest), Path(work)

# Fresh theme tree
if dest.exists():
    shutil.rmtree(dest)
for sz in sizes:
    (dest / f'{sz}x{sz}' / 'apps').mkdir(parents=True)
    if any(i['names'] and i['names'][0] in ('folder', 'inode-directory') or 'folder' in i['names'] for i in mapping['icons']):
        (dest / f'{sz}x{sz}' / 'places').mkdir(parents=True, exist_ok=True)

def extract_largest_png(icns: Path, out_png: Path) -> None:
    td = work / icns.stem
    if td.exists():
        shutil.rmtree(td)
    td.mkdir()
    # `icns2png -s 1024x1024` can segfault and leave an empty file.
    # Extract the whole family and pick the largest valid PNG (usually 1024 or 512).
    r = subprocess.run(['icns2png', '-x', str(icns)], cwd=td, capture_output=True)
    # Prefer 512x512. The 1024 (ic10) element is often JPEG 2000 and
    # icns2png can decode it as garbage (seen with the Firefox icon).
    by_dim = {}
    for p in td.glob('*.png'):
        if p.stat().st_size < 32:
            continue
        info = subprocess.run(['identify', '-format', '%w', str(p)], capture_output=True, text=True)
        if info.returncode != 0:
            continue
        try:
            w = int(info.stdout.strip())
        except ValueError:
            continue
        prev = by_dim.get(w)
        if prev is None or p.stat().st_size > prev.stat().st_size:
            by_dim[w] = p
    pick = by_dim.get(512) or by_dim.get(256) or by_dim.get(128)
    if pick is None and by_dim:
        pick = by_dim[max(k for k in by_dim if k != 1024)] if any(k != 1024 for k in by_dim) else by_dim[max(by_dim)]
    if pick is None:
        raise SystemExit(f'icns2png failed for {icns}: {r.stderr.decode()}')
    shutil.copy2(pick, out_png)

places_names = {'folder', 'inode-directory', 'gtk-directory', 'stock_folder'}

for icon in mapping['icons']:
    icns = Path(src_dir) / Path(icon['source_icns']).name
    if not icns.exists():
        raise SystemExit(f"missing source {icns} for {icon['slug']}")
    raw = work / f"{icon['slug']}-raw.png"
    extract_largest_png(icns, raw)
    primary = icon['names'][0]
    for sz in sizes:
        context = 'places' if primary in places_names else 'apps'
        out = dest / f'{sz}x{sz}' / context / f'{primary}.png'
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(im + [str(raw), '-resize', f'{sz}x{sz}', str(out)], check=True)
        for alias in icon['names'][1:]:
            a_context = 'places' if alias in places_names else 'apps'
            alias_path = dest / f'{sz}x{sz}' / a_context / f'{alias}.png'
            alias_path.parent.mkdir(parents=True, exist_ok=True)
            if alias_path.exists():
                alias_path.unlink()
            os.link(out, alias_path)
    print(f"  {primary}  ({icon['credit']})")

# index.theme
apps_dirs = [f'{sz}x{sz}/apps' for sz in sizes]
places_dirs = [f'{sz}x{sz}/places' for sz in sizes if (dest / f'{sz}x{sz}' / 'places').exists()]
directories = apps_dirs + places_dirs
inherits = ','.join(mapping.get('inherits', ['Adwaita', 'hicolor']))
lines = [
    '[Icon Theme]',
    f"Name={mapping['theme']}",
    'Comment=macOS-style app icons for kos, from macosicons.com (personal use)',
    f'Inherits={inherits}',
    'Directories=' + ','.join(directories),
    '',
]
for d in directories:
    sz = int(d.split('x', 1)[0])
    ctx = 'Places' if d.endswith('/places') else 'Applications'
    lines += [
        f'[{d}]',
        f'Size={sz}',
        f'Context={ctx}',
        'Type=Fixed',
        '',
    ]
(dest / 'index.theme').write_text('\n'.join(lines))

# Attribution
attr = [
    'kos-icons — attribution',
    '=======================',
    '',
    'These icons were downloaded from https://macosicons.com/ for personal use',
    'on this kos system. Each icon remains the property of its creator.',
    'Terms: https://macosicons.com/terms',
    '',
    mapping['license_note'],
    '',
    'Icon                          Creator            Page',
    '----------------------------  -----------------  -----',
]
for icon in mapping['icons']:
    attr.append(f"{icon['names'][0]:<28}  {icon['credit']:<17}  {icon['url']}")
if mapping.get('no_match'):
    attr += ['', 'No match (Adwaita inherited):']
    for n in mapping['no_match']:
        attr.append(f"  {n['app']}: {n['reason']}")
Path(attr_path).write_text('\n'.join(attr) + '\n')
shutil.copy2(attr_path, dest / 'ATTRIBUTION.txt')
print('wrote', dest)
PY

# Icon cache speeds up lookups in GNOME.
if command -v gtk-update-icon-cache >/dev/null; then
  gtk-update-icon-cache -f -t "$DEST" || true
fi
rm -rf "$WORKDIR"
echo "Built ${DEST}"
