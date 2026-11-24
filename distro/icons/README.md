# Icons

kos uses the official Deepin **bloom** icon theme from the Debian
`deepin-icon-theme` package (GPL-3.0-or-later; depends on
`papirus-icon-theme`). The package is listed in
`distro/config/packages.txt`, and `./build.sh distro-update` installs
it into an existing image when it is missing.

App icons on the launchpad, dock and in folders are drawn by
`kos-shell` (`icons.js`) into a uniform macOS-style squircle, including
apps installed later. No host tools (`icns2png`, etc.) are required.

Artwork that already is a full-bleed rounded square (all four edges of
its opaque bounding box are mostly filled) is scaled to cover the
tile. Every other icon is centred on one shared dark-slate squircle
with about 13% inner padding. The test is edge alpha, not how densely
the bounding box is filled — Contacts, Maps and Software are packed
enough to fool a coverage threshold, but their tabs, pin and handle
leave an edge sparse, so they get the common tile. Later-installed
apps go through the same path automatically.
