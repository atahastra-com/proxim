# Icons

kos uses the official Deepin **bloom** icon theme from the Debian
`deepin-icon-theme` package (GPL-3.0-or-later; depends on
`papirus-icon-theme`). The package is listed in
`distro/config/packages.txt`, and `./build.sh distro-update` installs
it into an existing image when it is missing.

App icons on the launchpad, dock and in folders are drawn by
`kos-shell` (`icons.js`) into a uniform macOS-style squircle, including
apps installed later. No host tools (`icns2png`, etc.) are required.
