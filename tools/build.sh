#!/bin/sh
# Menyatukan src/ dan pdf.js (vendor/) menjadi satu halaman rak-baca.html.
# Hasilnya bisa dibuka langsung di Chrome/Edge tanpa internet, atau diterbitkan ke GitHub Pages.
set -e
cd "$(dirname "$0")/.."
V=vendor/pdfjs
JS="src/1-core.js src/2-formats.js src/3-views.js src/4-reader.js src/5-notes.js src/6-shelf.js"
# urutan karakter ini akan menutup/mengacaukan elemen <script> di HTML
if cat $JS $V/pdf.min.mjs $V/pdf.worker.min.mjs | grep -qi -e '</script' -e '<script' -e '<!--'; then
  echo "build: kode memuat '<script', '</script' atau '<!--' - tulis sebagai '<\\/script' / '<\\!--'" >&2
  exit 1
fi
b64() { base64 < "$1" | tr -d '\r\n'; }
# nomor versi diambil dari berkas VERSION
VER=$(tr -d ' \r\n' < VERSION)
# CSP mengizinkan skrip aplikasi lewat hash isinya (bukan nonce tetap yang bisa ditiru siapa pun)
HASH="sha256-$({ printf '\n'; cat $JS; } | openssl dgst -sha256 -binary | base64 | tr -d '\r\n')"
{
  sed -e "s/@@VERSI@@/$VER/" -e "s|@@SKRIP_HASH@@|$HASH|" src/page.html
  printf '<script type="text/plain" id="pdfjs-lib">'
  cat $V/pdf.min.mjs
  printf '</script>\n<script type="text/plain" id="pdfjs-worker">'
  cat $V/pdf.worker.min.mjs
  printf '</script>\n<script type="text/plain" id="pdfjs-wasm-jbig2">'
  b64 $V/jbig2.wasm
  printf '</script>\n<script type="text/plain" id="pdfjs-wasm-openjpeg">'
  b64 $V/openjpeg.wasm
  printf '</script>\n<script>\n'
  cat $JS
  printf '</script>\n</body>\n</html>\n'
} > rak-baca.html
echo "built rak-baca.html v$VER ($(wc -c < rak-baca.html) bytes)"
