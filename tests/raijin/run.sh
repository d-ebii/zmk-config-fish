#!/bin/sh
# SPDX-License-Identifier: MIT
set -eu

test_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "$test_dir/../.." && pwd)
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/fish-raijin-tests.XXXXXXXX")

# Only remove the private directory created immediately above by mktemp.
cleanup() {
    case "$build_dir" in
        "${TMPDIR:-/tmp}"/fish-raijin-tests.*) rm -rf -- "$build_dir" ;;
        *) printf '%s\n' "Refusing cleanup of unexpected path: $build_dir" >&2 ;;
    esac
}
trap cleanup EXIT HUP INT TERM

printf '%s\n' 'Building Raijin state-machine tests with strict C11 warnings...'
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic \
    -I "$repo_root/src/raijin" \
    "$repo_root/src/raijin/raijin.c" "$test_dir/raijin_test.c" \
    -o "$build_dir/raijin_test"
printf '%s\n' 'Running Raijin state-machine tests...'
"$build_dir/raijin_test"
