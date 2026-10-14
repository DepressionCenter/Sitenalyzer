#!/usr/bin/env bash
# This file is part of Sitenalyzer
# build.sh
# Author(s): Gabriel Mongefranco.
# Created: 2026-10-14
# Last Modified: 2026-10-14
# Summary: Builds the files that site owners copy to SharePoint. Reads src/ and writes dist/.
#          Needs only bash and standard tools (sed, awk, and sha256sum or shasum), so it runs on
#          Linux, macOS, and Git Bash on Windows. build.ps1 does the same work in PowerShell, and
#          both scripts must write identical files; CI checks this on every pull request.
# Notes: See README file for documentation and full license information.
#        Usage: bash build.sh
#
# Copyright © 2026 The Regents of the University of Michigan
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License along
# with this program. If not, see <https://www.gnu.org/licenses/>.

set -euo pipefail

### Load Configuration ###
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$REPO_ROOT/src"
LIB_DIR="$SRC_DIR/lib"
DIST_DIR="$REPO_ROOT/dist"
SCRIPTS_OUT="$DIST_DIR/SiteAssets/scripts"
STYLES_OUT="$DIST_DIR/SiteAssets/styles"
PAGES_OUT="$DIST_DIR/SitePages"
CHECKSUM_FILE="$LIB_DIR/sha256sums.txt"
# The build replaces this exact line in src/sitenalyzer.js with the markup from src/sitenalyzer.html.
APP_HTML_MARKER='var SNA_APP_HTML = [];'
TAB="$(printf '\t')"
FILES_WRITTEN=0

fail() {
  echo "Build failed: $1" >&2
  exit 1
}

# Prints a file's path relative to the repository and counts it.
report_written() {
  echo "  ${1#"$REPO_ROOT"/}"
  FILES_WRITTEN=$((FILES_WRITTEN + 1))
}

# Copies a text file with carriage returns removed, so every build writes LF line endings.
copy_text_file() {
  tr -d '\r' < "$1" > "$2"
  report_written "$2"
}

if command -v sha256sum > /dev/null 2>&1; then
  file_sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum > /dev/null 2>&1; then
  file_sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail "this script needs sha256sum or shasum to check the library files. Install one of them and run the build again."
fi

### Validate Inputs ###
for source_file in sitenalyzer.js sitenalyzer.html sitenalyzer.css sitenalyzer.html.txt lib/sha256sums.txt; do
  [ -f "$SRC_DIR/$source_file" ] || fail "src/$source_file is missing. Restore it from git and run the build again."
done

marker_count="$(tr -d '\r' < "$SRC_DIR/sitenalyzer.js" | grep -cxF "$APP_HTML_MARKER" || true)"
[ "$marker_count" = "1" ] || fail "src/sitenalyzer.js must contain the line '$APP_HTML_MARKER' exactly once, but it appears $marker_count times."

# Only files listed in sha256sums.txt are copied, so an unexpected or changed library never reaches dist/.
library_files=()
while read -r expected_hash library_name; do
  [ -n "${expected_hash:-}" ] || continue
  [ -f "$LIB_DIR/$library_name" ] || fail "src/lib/$library_name is listed in src/lib/sha256sums.txt but the file is missing."
  actual_hash="$(file_sha256 "$LIB_DIR/$library_name")"
  if [ "$actual_hash" != "$expected_hash" ]; then
    fail "src/lib/$library_name does not match its checksum in src/lib/sha256sums.txt. If you replaced this library on purpose, update its line in that file."
  fi
  library_files+=("$library_name")
done < <(tr -d '\r' < "$CHECKSUM_FILE")
[ "${#library_files[@]}" -gt 0 ] || fail "src/lib/sha256sums.txt does not list any library files."

### Prepare Output Folder ###
# dist/ holds only build results, so deleting it first removes files that are no longer built.
rm -rf "$DIST_DIR"
mkdir -p "$SCRIPTS_OUT" "$STYLES_OUT" "$PAGES_OUT"
echo "Building Sitenalyzer into dist/..."

### Copy Libraries ###
# Libraries are copied byte for byte. License texts go in both folders, because the
# Tabulator style sheet has no license notice of its own.
for library_name in "${library_files[@]}"; do
  case "$library_name" in
    *.css)
      cp "$LIB_DIR/$library_name" "$STYLES_OUT/$library_name"
      report_written "$STYLES_OUT/$library_name"
      ;;
    *.txt)
      cp "$LIB_DIR/$library_name" "$SCRIPTS_OUT/$library_name"
      report_written "$SCRIPTS_OUT/$library_name"
      cp "$LIB_DIR/$library_name" "$STYLES_OUT/$library_name"
      report_written "$STYLES_OUT/$library_name"
      ;;
    *)
      cp "$LIB_DIR/$library_name" "$SCRIPTS_OUT/$library_name"
      report_written "$SCRIPTS_OUT/$library_name"
      ;;
  esac
done

### Build sitenalyzer.js ###
markup_lines="$(mktemp)"
trap 'rm -f "$markup_lines"' EXIT

# Drop the license comment at the top of the markup, then turn each line into a quoted JavaScript
# string. Escaping rules, shared with build.ps1: \ becomes \\, " becomes \", and a tab becomes \t.
tr -d '\r' < "$SRC_DIR/sitenalyzer.html" \
  | awk 'NR == 1 && /^<!--/ { in_header = 1 } in_header { if (index($0, "-->")) { in_header = 0 }; next } { print }' \
  | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$TAB/\\\\t/g" -e 's/^/    "/' -e 's/$/",/' \
  > "$markup_lines"

tr -d '\r' < "$SRC_DIR/sitenalyzer.js" \
  | awk -v marker="$APP_HTML_MARKER" -v markup_file="$markup_lines" '
      $0 == marker {
        print "var SNA_APP_HTML = ["
        while ((getline markup_line < markup_file) > 0) { print markup_line }
        print "];"
        next
      }
      { print }' \
  > "$SCRIPTS_OUT/sitenalyzer.js"
report_written "$SCRIPTS_OUT/sitenalyzer.js"

### Copy App Styles and Page Code ###
copy_text_file "$SRC_DIR/sitenalyzer.css" "$STYLES_OUT/sitenalyzer.css"
copy_text_file "$SRC_DIR/sitenalyzer.html.txt" "$PAGES_OUT/sitenalyzer.html.txt"

if [ "$FILES_WRITTEN" -eq 1 ]; then
  echo "Build finished. Wrote 1 file to dist/."
else
  echo "Build finished. Wrote $FILES_WRITTEN files to dist/."
fi
