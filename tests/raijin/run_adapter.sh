#!/bin/sh
# SPDX-License-Identifier: MIT
set -eu

test_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH='' cd -- "$test_dir/../.." && pwd)
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/fish-raijin-adapter.XXXXXXXX")
cleanup() {
    case "$build_dir" in
        "${TMPDIR:-/tmp}"/fish-raijin-adapter.*) rm -rf -- "$build_dir" ;;
        *) printf '%s\n' "Refusing cleanup of unexpected path: $build_dir" >&2 ;;
    esac
}
trap cleanup EXIT HUP INT TERM

# adapter_stubs.h supplies declarations. Empty include files allow the actual
# adapter source to retain its production includes without conditional test code.
for header in zephyr/device.h zephyr/kernel.h zephyr/logging/log.h drivers/behavior.h \
    dt-bindings/zmk/keys.h zmk/activity.h zmk/behavior.h zmk/event_manager.h \
    zmk/events/activity_state_changed.h zmk/events/endpoint_changed.h \
    zmk/events/keycode_state_changed.h zmk/events/layer_state_changed.h zmk/keymap.h \
    zmk/events/ble_active_profile_changed.h zmk/events/split_peripheral_status_changed.h
do
    mkdir -p "$build_dir/include/$(dirname "$header")"
    printf '%s\n' '/* Host adapter test: declarations are in adapter_stubs.h. */' \
        > "$build_dir/include/$header"
done

printf '%s\n' 'Building the real Raijin adapter against host ZMK stubs...'
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic \
    -I "$build_dir/include" -I "$repo_root/src" \
    "$repo_root/src/raijin/raijin.c" "$test_dir/adapter_test.c" \
    -o "$build_dir/adapter_test"
printf '%s\n' 'Running Raijin adapter routing and reset regression tests...'
"$build_dir/adapter_test"
