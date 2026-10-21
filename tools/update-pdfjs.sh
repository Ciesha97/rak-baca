#!/bin/sh
# Memperbarui pdf.js di vendor/pdfjs lalu membangun ulang: sh tools/update-pdfjs.sh 6.4.299
# Butuh npm (mengunduh paket pdfjs-dist dari registry npm).
set -e
V="${1:?tulis versi pdfjs-dist, mis. 6.4.299}"
cd "$(dirname "$0")/.."
T=$(mktemp -d)
(cd "$T" && npm pack "pdfjs-dist@$V" >/dev/null && tar xzf pdfjs-dist-*.tgz)
P="$T/package"
cp "$P/legacy/build/pdf.min.mjs" "$P/legacy/build/pdf.worker.min.mjs" "$P/wasm/jbig2.wasm" "$P/wasm/openjpeg.wasm" "$P/LICENSE" vendor/pdfjs/
for f in LICENSE_PDFJS_JBIG2 LICENSE_JBIG2 LICENSE_PDFJS_OPENJPEG LICENSE_OPENJPEG; do echo "===== $f ====="; cat "$P/wasm/$f"; echo; done > vendor/pdfjs/LICENSE-WASM
printf 'pdfjs-dist %s (legacy build), https://github.com/mozilla/pdf.js\nLisensi: Apache-2.0 (lihat LICENSE).\njbig2.wasm dan openjpeg.wasm: lihat LICENSE-WASM.\n' "$V" > vendor/pdfjs/VERSI.txt
rm -rf "$T"
sh tools/build.sh
