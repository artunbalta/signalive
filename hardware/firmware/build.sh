#!/bin/sh
# Builds the SSP reference encoder and its golden generator with every
# warning an error, runs the generator, and rewrites the cross language
# fixtures in lib/sense/__fixtures__ that lib/sense/protocol.test.ts checks
# the TypeScript side against. Nothing is left behind but the fixtures.
#
#   hardware/firmware/build.sh             from anywhere
#   CC=gcc hardware/firmware/build.sh      with another compiler
#   SANITIZE=1 hardware/firmware/build.sh  also under the address and
#                                          undefined behaviour sanitizers
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
FIXTURES="$ROOT/lib/sense/__fixtures__"
CC=${CC:-cc}
FLAGS="-std=c99 -Wall -Wextra -Werror -pedantic"
# The firmware file is held to more than that: no implicit narrowing or sign
# change, which is where a packetizer goes wrong on a 32 bit MCU.
STRICT="-Wconversion -Wsign-conversion -Wshadow -Wcast-qual -Wstrict-prototypes -Wmissing-prototypes"

OUT=$(mktemp -d "${TMPDIR:-/tmp}/ssp.XXXXXX")
trap 'rm -rf "$OUT"' EXIT

echo "build: $($CC --version | head -n 1)"
# shellcheck disable=SC2086
$CC $FLAGS $STRICT -O2 -c "$HERE/ssp.c" -o "$OUT/ssp.o"
# shellcheck disable=SC2086
$CC $FLAGS -O2 -c "$HERE/golden.c" -o "$OUT/golden.o"
$CC -o "$OUT/golden" "$OUT/ssp.o" "$OUT/golden.o"
echo "build: ssp.c and golden.c compiled with no warnings"

mkdir -p "$FIXTURES"
"$OUT/golden" "$FIXTURES/ssp-golden.bin" "$FIXTURES/ssp-golden.json"

if [ "${SANITIZE:-0}" = "1" ]; then
  # shellcheck disable=SC2086
  $CC $FLAGS -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer \
    -o "$OUT/golden-san" "$HERE/ssp.c" "$HERE/golden.c"
  "$OUT/golden-san" "$OUT/check.bin" "$OUT/check.json" > /dev/null
  cmp "$OUT/check.bin" "$FIXTURES/ssp-golden.bin"
  cmp "$OUT/check.json" "$FIXTURES/ssp-golden.json"
  echo "build: sanitizer run clean, identical fixtures"
fi

echo "build: wrote lib/sense/__fixtures__/ssp-golden.bin and ssp-golden.json"
