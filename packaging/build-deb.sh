#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="3.7.0"
PKG_NAME="tiengviet"
BUILD_DIR="$ROOT_DIR/dist/deb/${PKG_NAME}_${VERSION}_all"
OUT_DIR="$ROOT_DIR/dist"
OUT_DEB="$OUT_DIR/${PKG_NAME}_${VERSION}_all.deb"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
mkdir -p "$OUT_DIR"

cp -a "$ROOT_DIR/packaging/deb/." "$BUILD_DIR/"

install -d "$BUILD_DIR/usr/share/tiengviet/www"
cp -a "$ROOT_DIR/www/." "$BUILD_DIR/usr/share/tiengviet/www/"
find "$BUILD_DIR/usr/share/tiengviet/www" -type d -exec chmod 0755 {} +
find "$BUILD_DIR/usr/share/tiengviet/www" -type f -exec chmod 0644 {} +

install -d "$BUILD_DIR/usr/share/icons/hicolor/192x192/apps"
install -m 0644 "$ROOT_DIR/www/icons/icon-192.png" "$BUILD_DIR/usr/share/icons/hicolor/192x192/apps/tiengviet.png"
install -d "$BUILD_DIR/usr/share/icons/hicolor/512x512/apps"
install -m 0644 "$ROOT_DIR/www/icons/icon-512.png" "$BUILD_DIR/usr/share/icons/hicolor/512x512/apps/tiengviet.png"

find "$BUILD_DIR" -type d -exec chmod 0755 {} +
find "$BUILD_DIR" -type f -exec chmod 0644 {} +
find "$BUILD_DIR/usr/bin" -type f -exec chmod 0755 {} +
find "$BUILD_DIR/DEBIAN" -type f -exec chmod 0644 {} +

dpkg-deb --build --root-owner-group "$BUILD_DIR" "$OUT_DEB"
echo "$OUT_DEB"
