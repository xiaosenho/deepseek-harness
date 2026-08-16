# Sharp Windows Platform Libraries Notice

DeepSeek Harness Electron distributions for Windows include `@img/sharp-win32-x64 0.35.3`, whose published manifest declares `Apache-2.0 AND LGPL-3.0-or-later`. Its `versions.json` identifies libvips 8.18.3 and the versions of the other bundled libraries.

The platform package contains the Apache-2.0 Sharp native add-on and dynamically loaded Windows DLLs. The upstream package identifies these bundled libraries as available under LGPL version 3 or later: fribidi, glib, libexif, libheif, librsvg, libvips, pango, and proxy-libintl. The installer leaves the DLLs as ordinary files rather than combining them into a statically linked application, so a recipient can inspect and replace compatible library files.

The complete LGPL version 3 terms are in `LGPL-3.0.txt`. LGPL version 3 incorporates the GNU GPL version 3 terms, supplied in `GPL-3.0.txt`. These files and this notice are installed under the application's `resources/legal/` directory.

Corresponding upstream source and build provenance for this distribution:

- Sharp 0.35.3: <https://github.com/lovell/sharp/tree/v0.35.3>
- Sharp prebuilt-libvips packaging 1.3.2: <https://github.com/lovell/sharp-libvips/tree/v1.3.2>
- libvips 8.18.3: <https://github.com/libvips/libvips/releases/tag/v8.18.3>
- Windows dependency build 8.18.3: <https://github.com/libvips/build-win64-mxe/releases/tag/v8.18.3>

DeepSeek Harness does not modify these upstream prebuilt binaries. A release operator must keep the corresponding source available with each published installer and update this notice when the Sharp package, declared terms, libvips version, or Windows build provenance changes.
