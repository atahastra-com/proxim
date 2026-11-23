# kos-icons

macOS-style app icons for kos, downloaded from [macosicons.com](https://macosicons.com/)
and applied as the `kos-icons` icon theme (`Inherits=Adwaita,hicolor`).

## Licence

Icons stay the property of their creators. macosicons.com allows you to
download them and apply them to apps on your own devices for personal use,
free of charge. See [the terms](https://macosicons.com/terms).

- Do not repackage or resell this set, in whole or in part, as a product.
- If you want to ship an icon commercially (for example as the official
  icon of a published OS or app), get permission from its creator.
- Keep the creator credit in `ATTRIBUTION.txt`.
- The official API requires an API key and forbids building an offline
  mirror of the catalogue. These files are a small personal selection
  downloaded from public icon pages, not a mirror of the library.

`.icns` sources and the generated theme are gitignored. Copy them onto
the machine that runs `./build.sh distro` / `distro-update` (see
`distro/icons/sources/` and `distro/overlay/usr/share/icons/kos-icons/`).

## Build

```
./distro/icons/build-theme.sh
```

This extracts PNGs from each `.icns`, scales 16–512px, writes
`distro/overlay/usr/share/icons/kos-icons/`, and refreshes
`ATTRIBUTION.txt`. Host tools: `icns2png` (`sudo apt install -y icnsutils`),
ImageMagick (`sudo apt install -y imagemagick`), and python3.
`./build.sh distro-update` and `distro` run it before mounting the
image. If those tools are missing but the generated theme is already
there, the existing theme is kept.

The desktop default is `icon-theme='kos-icons'` in
`distro/config/kos.gschema.override` and `dconf-kos-shell.ini`.
