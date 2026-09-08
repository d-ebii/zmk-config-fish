/* SPDX-License-Identifier: MIT */
#include "adapter_stubs.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

/* Include the production adapter so tests exercise its actual static handlers. */
#include "../../src/behaviors/behavior_onishi_raijin.c"

int64_t test_now;
unsigned test_warnings;
unsigned test_max_mutex_depth;
static bool test_layers[10];
static struct zmk_behavior_binding auxiliary_bindings[RJ_KEY_COUNT];
static uint32_t emitted[128];
static size_t emitted_count;
static unsigned keycode_releases;
static unsigned layer_key_releases;
static unsigned layer_events;

int k_mutex_lock(struct k_mutex *mutex, int timeout) {
    (void)timeout;
    assert(++mutex->depth < 16);
    if (mutex->depth > test_max_mutex_depth) {
        test_max_mutex_depth = mutex->depth;
    }
    return 0;
}
int k_mutex_unlock(struct k_mutex *mutex) {
    assert(mutex->depth > 0);
    mutex->depth--;
    return 0;
}
int k_work_cancel_delayable(struct k_work_delayable *work) {
    work->scheduled = 0;
    return 0;
}
int k_work_reschedule(struct k_work_delayable *work, int64_t delay) {
    assert(delay > 0);
    work->scheduled = test_now + delay;
    return 0;
}
int64_t k_uptime_get(void) { return test_now; }
bool zmk_keymap_layer_active(zmk_keymap_layer_id_t layer) { return test_layers[layer]; }

static void change_layer(uint8_t layer, bool active) {
    if (test_layers[layer] == active) {
        return;
    }
    test_layers[layer] = active;
    assert(++layer_events < 100);
    zmk_event_t event = {.type = TEST_LAYER,
                        .data.layer = {.layer = layer, .state = active, .timestamp = test_now}};
    state_listener(&event);
}
int zmk_keymap_layer_activate(zmk_keymap_layer_id_t layer, bool locking) {
    (void)locking;
    change_layer(layer, true);
    return 0;
}
int zmk_keymap_layer_deactivate(zmk_keymap_layer_id_t layer, bool locking) {
    (void)locking;
    change_layer(layer, false);
    return 0;
}
int zmk_keymap_layer_to(zmk_keymap_layer_id_t layer, bool locking) {
    (void)locking;
    for (uint8_t id = 1; id < ARRAY_SIZE(test_layers); id++) {
        if (id != layer) {
            change_layer(id, false);
        }
    }
    change_layer(layer, true);
    return 0;
}
const struct zmk_behavior_binding *zmk_keymap_get_layer_binding_at_idx(
    zmk_keymap_layer_id_t layer, uint16_t position) {
    assert(layer == 9 && position < RJ_KEY_COUNT);
    return &auxiliary_bindings[position];
}
int zmk_behavior_invoke_binding(const struct zmk_behavior_binding *binding,
                                struct zmk_behavior_binding_event event, bool pressed) {
    struct zmk_behavior_binding copy = *binding;
    if (strcmp(binding->behavior_dev, "rj") == 0) {
        return pressed ? binding_pressed(&copy, event) : binding_released(&copy, event);
    }
    if (strcmp(binding->behavior_dev, "to") == 0) {
        if (pressed) {
            zmk_keymap_layer_to(binding->param1, false);
        } else {
            layer_key_releases++;
        }
        return ZMK_BEHAVIOR_OPAQUE;
    }
    if (strcmp(binding->behavior_dev, "trans") == 0) {
        return ZMK_BEHAVIOR_TRANSPARENT;
    }
    return -ENODEV;
}
int raise_zmk_keycode_state_changed_from_encoded(uint32_t code, bool pressed, int64_t timestamp) {
    (void)timestamp;
    if (pressed) {
        assert(emitted_count < ARRAY_SIZE(emitted));
        emitted[emitted_count++] = code;
    } else {
        keycode_releases++;
    }
    return 0;
}

static void start_case(void) {
    memset(test_layers, 0, sizeof(test_layers));
    memset(redirected, 0, sizeof(redirected));
    memset(auxiliary_bindings, 0, sizeof(auxiliary_bindings));
    test_layers[0] = true;
    test_now = 100;
    test_warnings = 0;
    test_max_mutex_depth = 0;
    layer_events = 0;
    layer_key_releases = 0;
    emitted_count = 0;
    keycode_releases = 0;
    initialized = false;
    resetting = false;
    raijin_mutex.depth = 0;
    raijin_timer.scheduled = 0;
    auxiliary_bindings[15] = (struct zmk_behavior_binding){"rj", RJ_DIRECT, A};
    auxiliary_bindings[7] = (struct zmk_behavior_binding){"to", 6, 0};
    auxiliary_bindings[4] = (struct zmk_behavior_binding){"to", 0, 0};
    assert(driver_api.locality == BEHAVIOR_LOCALITY_CENTRAL);
    assert(behavior_init(NULL) == 0);
    zmk_keymap_layer_activate(8, false);
    assert(state.enabled);
}
static void press(uint8_t layer, uint8_t position, uint32_t command, uint32_t value, int64_t now) {
    test_now = now;
    struct zmk_behavior_binding binding = {"rj", command, value};
    struct zmk_behavior_binding_event event = {layer, position, now, 0};
    assert(binding_pressed(&binding, event) == ZMK_BEHAVIOR_OPAQUE);
    assert(raijin_mutex.depth == 0);
}
static void release(uint8_t layer, uint8_t position, int64_t now) {
    test_now = now;
    struct zmk_behavior_binding binding = {"rj", 0, 0};
    struct zmk_behavior_binding_event event = {layer, position, now, 0};
    assert(binding_released(&binding, event) == ZMK_BEHAVIOR_OPAQUE);
    assert(raijin_mutex.depth == 0);
}
static void assert_output(uint32_t code) {
    assert(emitted_count == 1 && emitted[0] == code);
    assert(keycode_releases == emitted_count);
    assert(test_warnings == 0);
}

static void first_auxiliary_key_before_timer(void) {
    start_case();
    press(8, 30, RJ_BACKSPACE, 0, 100);
    assert(raijin_timer.scheduled == 280);
    press(8, 15, T, O, 120);
    assert_output(A);
    assert(test_layers[9] && redirected[15].active);
    assert(state.keys[15].role == RJ_OUTPUT);
    release(8, 15, 125);
    assert(!redirected[15].active && state.keys[15].role == RJ_UP);
    release(8, 30, 130);
    assert(!test_layers[9] && !rj_aux_active(&state));
    assert(test_max_mutex_depth >= 2);
}
static void first_auxiliary_key_after_timer(void) {
    start_case();
    press(8, 30, RJ_BACKSPACE, 0, 100);
    test_now = 280;
    timer_handler(&raijin_timer.work);
    assert(test_layers[9] && raijin_timer.scheduled == 0);
    press(9, 15, RJ_DIRECT, A, 281);
    assert_output(A);
    assert(!redirected[15].active);
    release(9, 15, 282);
    release(8, 30, 283);
    assert(!test_layers[9]);
}
static void first_auxiliary_key_with_late_timer(void) {
    start_case();
    press(8, 30, RJ_BACKSPACE, 0, 100);
    press(8, 15, T, O, 300);
    assert_output(A);
    assert(test_layers[9] && redirected[15].active && raijin_timer.scheduled == 0);
    release(8, 15, 301);
    release(8, 30, 302);
}
static void auxiliary_to_system_and_matching_release(void) {
    start_case();
    press(8, 30, RJ_BACKSPACE, 0, 100);
    press(8, 7, K, O, 120);
    assert(test_layers[6] && !test_layers[8] && !test_layers[9]);
    assert(!state.enabled && !rj_aux_active(&state) && raijin_timer.scheduled == 0);
    assert(redirected[7].active);
    release(8, 7, 121);
    assert(layer_key_releases == 1 && !redirected[7].active);
    release(8, 30, 122);
    assert(emitted_count == 0 && keycode_releases == 0 && test_warnings == 0);
    assert(test_max_mutex_depth >= 2);
}
static void lost_release_then_new_main_press(void) {
    start_case();
    press(8, 30, RJ_BACKSPACE, 0, 100);
    press(8, 7, K, O, 120);
    assert(redirected[7].active);
    zmk_event_t disconnect = {.type = TEST_BLE};
    state_listener(&disconnect);
    assert(redirected[7].active); /* A delayed old key-up still has an owner. */
    zmk_keymap_layer_to(8, false);
    press(8, 7, K, O, 200); /* The lost key-up must not own this new press. */
    assert(!redirected[7].active && state.keys[7].role == RJ_CONSONANT);
    release(8, 7, 210);
    assert(state.keys[7].role == RJ_UP && layer_key_releases == 0);
    assert_output(K);
}
static void disconnect_then_new_forwarded_press(void) {
    start_case();
    press(8, 30, RJ_BACKSPACE, 0, 100);
    press(8, 15, T, O, 120);
    zmk_event_t disconnect = {.type = TEST_SPLIT, .data.split = {.connected = false}};
    state_listener(&disconnect);
    assert(redirected[15].active && !test_layers[9]);
    emitted_count = 0;
    keycode_releases = 0;
    press(8, 30, RJ_BACKSPACE, 0, 200);
    press(8, 15, T, O, 220);
    assert(redirected[15].active); /* Recursive &rj invocation retains new ownership. */
    release(8, 15, 221);
    assert(!redirected[15].active && state.keys[15].role == RJ_UP);
    assert_output(A);
    release(8, 30, 230);
}
static void disconnect_then_old_release_before_new_press(void) {
    start_case();
    press(8, 30, RJ_BACKSPACE, 0, 100);
    press(8, 7, K, O, 120);
    zmk_event_t disconnect = {.type = TEST_ENDPOINT};
    state_listener(&disconnect);
    release(8, 7, 130);
    assert(layer_key_releases == 1 && !redirected[7].active);
    zmk_keymap_layer_to(8, false);
    press(8, 7, K, O, 200);
    release(8, 7, 210);
    assert(state.keys[7].role == RJ_UP && layer_key_releases == 1);
    assert_output(K);
}
static void sleep_cancels_pending_timer(void) {
    start_case();
    press(8, 30, RJ_BACKSPACE, 0, 100);
    zmk_event_t sleep = {.type = TEST_ACTIVITY, .data.activity = {.state = ZMK_ACTIVITY_SLEEP}};
    state_listener(&sleep);
    assert(state.enabled && rj_deadline(&state) == 0 && raijin_timer.scheduled == 0);
    test_now = 300;
    timer_handler(&raijin_timer.work); /* Work already queued before cancellation is harmless. */
    release(8, 30, 301);
    assert(!test_layers[9] && emitted_count == 0);
}
static void external_exit_while_auxiliary_is_held(void) {
    start_case();
    press(8, 30, RJ_BACKSPACE, 0, 100);
    test_now = 280;
    timer_handler(&raijin_timer.work);
    zmk_keymap_layer_to(0, false);
    assert(!test_layers[8] && !test_layers[9] && !state.enabled);
    release(8, 30, 281);
    assert(!test_layers[9] && raijin_timer.scheduled == 0 && emitted_count == 0);
    assert(!resetting && raijin_mutex.depth == 0);
}

int main(void) {
    void (*cases[])(void) = {first_auxiliary_key_before_timer, first_auxiliary_key_after_timer,
        first_auxiliary_key_with_late_timer, auxiliary_to_system_and_matching_release,
        lost_release_then_new_main_press, disconnect_then_new_forwarded_press,
        disconnect_then_old_release_before_new_press, sleep_cancels_pending_timer,
        external_exit_while_auxiliary_is_held};
    for (size_t i = 0; i < ARRAY_SIZE(cases); i++) {
        cases[i]();
        printf("PASS adapter %zu/%zu\n", i + 1, ARRAY_SIZE(cases));
    }
    puts("All 9 adapter tests passed (host ZMK stubs; firmware compile is separate).");
    return 0;
}
