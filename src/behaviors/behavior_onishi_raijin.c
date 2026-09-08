/* SPDX-License-Identifier: MIT */

#define DT_DRV_COMPAT zmk_behavior_onishi_raijin

#include <errno.h>
#include <stdint.h>
#include <zephyr/device.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <drivers/behavior.h>
#include <dt-bindings/zmk/keys.h>
#include <zmk/activity.h>
#include <zmk/behavior.h>
#include <zmk/event_manager.h>
#include <zmk/events/activity_state_changed.h>
#include <zmk/events/endpoint_changed.h>
#include <zmk/events/keycode_state_changed.h>
#include <zmk/events/layer_state_changed.h>
#include <zmk/keymap.h>
#if IS_ENABLED(CONFIG_ZMK_BLE)
#include <zmk/events/ble_active_profile_changed.h>
#endif
#if IS_ENABLED(CONFIG_ZMK_SPLIT)
#include <zmk/events/split_peripheral_status_changed.h>
#endif
#include <raijin/raijin.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)

BUILD_ASSERT(DT_NUM_INST_STATUS_OKAY(DT_DRV_COMPAT) == 1,
             "Onishi Raijin supports one shared behavior instance");
BUILD_ASSERT(DT_INST_PROP_LEN(0, vowel_positions) == DT_INST_PROP_LEN(0, vowel_keycodes),
             "vowel-positions and vowel-keycodes must have the same length");
BUILD_ASSERT(DT_INST_PROP(0, main_layer) != DT_INST_PROP(0, auxiliary_layer),
             "The main and auxiliary layers must differ");
BUILD_ASSERT(DT_INST_PROP(0, main_layer) < ZMK_KEYMAP_LAYERS_LEN &&
                 DT_INST_PROP(0, auxiliary_layer) < ZMK_KEYMAP_LAYERS_LEN,
             "Raijin layers must exist in the keymap");
BUILD_ASSERT(DT_INST_PROP(0, tapping_term_ms) > 0 &&
                 DT_INST_PROP(0, tapping_term_ms) <= UINT16_MAX,
             "Raijin tapping-term-ms must fit a positive uint16_t");

#define CHECK_VOWEL_POSITION(node, prop, idx)                                                       \
    BUILD_ASSERT(DT_PROP_BY_IDX(node, prop, idx) < RJ_KEY_COUNT,                                    \
                 "A Raijin vowel position is outside the keyboard");
DT_FOREACH_PROP_ELEM(DT_DRV_INST(0), vowel_positions, CHECK_VOWEL_POSITION)

static const uint32_t vowel_positions[] = DT_INST_PROP(0, vowel_positions);
static const uint32_t vowel_keycodes[] = DT_INST_PROP(0, vowel_keycodes);
static const zmk_keymap_layer_id_t main_layer = DT_INST_PROP(0, main_layer);
static const zmk_keymap_layer_id_t auxiliary_layer = DT_INST_PROP(0, auxiliary_layer);

static struct rj_state state;
static bool initialized;
static bool resetting;
K_MUTEX_DEFINE(raijin_mutex);

/* The keymap remembers the original main-layer behavior for key release. Keep a
 * copy when the first key after a Backspace hold is redirected to auxiliary. */
struct redirected_key {
    bool active;
    bool invoking_press;
    struct zmk_behavior_binding binding;
    struct zmk_behavior_binding_event event;
};
static struct redirected_key redirected[RJ_KEY_COUNT];

static void timer_handler(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(raijin_timer, timer_handler);

static void schedule_timer_locked(void) {
    int64_t deadline = rj_deadline(&state);
    if (deadline == 0) {
        k_work_cancel_delayable(&raijin_timer);
        return;
    }
    int64_t delay = deadline - k_uptime_get();
    k_work_reschedule(&raijin_timer, K_MSEC(delay > 0 ? delay : 1));
}

static void emit_key(uint32_t code, int64_t timestamp, void *context) {
    ARG_UNUSED(context);
    int press_err = raise_zmk_keycode_state_changed_from_encoded(code, true, timestamp);
    /* Always release, including when the press event reported an error. */
    int release_err = raise_zmk_keycode_state_changed_from_encoded(code, false, timestamp);
    if (press_err < 0 || release_err < 0) {
        LOG_WRN("Raijin key 0x%x failed (%d/%d)", code, press_err, release_err);
    }
}

static void set_auxiliary(bool active, void *context) {
    ARG_UNUSED(context);
    int err = active ? zmk_keymap_layer_activate(auxiliary_layer, false)
                     : zmk_keymap_layer_deactivate(auxiliary_layer, false);
    if (err < 0) {
        LOG_WRN("Raijin auxiliary layer failed (%d)", err);
    }
}

static void reset_locked(bool clear_only) {
    if (!initialized || resetting) {
        return;
    }
    resetting = true;
    if (clear_only) {
        rj_reset(&state);
    }
    rj_enable(&state, zmk_keymap_layer_active(main_layer));
    resetting = false;
    schedule_timer_locked();
    /* Do not discard redirected[]: a pending key-up still belongs to the
     * behavior invoked at key-down, even after leaving Raijin. */
}

static void timer_handler(struct k_work *work) {
    ARG_UNUSED(work);
    k_mutex_lock(&raijin_mutex, K_FOREVER);
    rj_tick(&state, k_uptime_get());
    schedule_timer_locked();
    k_mutex_unlock(&raijin_mutex);
}

static int binding_pressed(struct zmk_behavior_binding *binding,
                           struct zmk_behavior_binding_event event) {
    if (event.position >= RJ_KEY_COUNT) {
        return ZMK_BEHAVIOR_OPAQUE;
    }

    k_mutex_lock(&raijin_mutex, K_FOREVER);
    struct redirected_key *redirect = &redirected[event.position];
    /* A disconnect may have lost the preceding physical key-up. A fresh
     * key-down replaces that old ownership, but the synchronous call into an
     * auxiliary &rj binding must retain the record created by this press. */
    if (!redirect->invoking_press) {
        redirect->active = false;
    }
    bool auxiliary = false;
    if (event.layer == main_layer) {
        auxiliary = rj_prepare_press(&state, event.position, event.timestamp);
    }

    if (auxiliary && event.position != RJ_BACKSPACE_POSITION &&
        event.position != RJ_SPACE_POSITION) {
        const struct zmk_behavior_binding *target =
            zmk_keymap_get_layer_binding_at_idx(auxiliary_layer, event.position);
        if (target && target->behavior_dev) {
            struct redirected_key *key = &redirected[event.position];
            key->binding = *target;
            key->event = event;
            key->event.layer = auxiliary_layer;
            key->active = true;
            key->invoking_press = true;
            int err = zmk_behavior_invoke_binding(&key->binding, key->event, true);
            key->invoking_press = false;
            if (err == ZMK_BEHAVIOR_TRANSPARENT) {
                key->active = false;
                rj_press(&state, event.position, binding->param1, binding->param2,
                         event.timestamp);
            } else if (err < 0) {
                key->active = false;
                LOG_WRN("Raijin redirected key %u failed (%d)", event.position, err);
            }
        } else {
            LOG_WRN("Raijin auxiliary binding %u is unavailable", event.position);
        }
    } else {
        rj_press(&state, event.position, binding->param1, binding->param2, event.timestamp);
    }
    schedule_timer_locked();
    k_mutex_unlock(&raijin_mutex);
    return ZMK_BEHAVIOR_OPAQUE;
}

static int binding_released(struct zmk_behavior_binding *binding,
                            struct zmk_behavior_binding_event event) {
    ARG_UNUSED(binding);
    if (event.position >= RJ_KEY_COUNT) {
        return ZMK_BEHAVIOR_OPAQUE;
    }

    k_mutex_lock(&raijin_mutex, K_FOREVER);
    struct redirected_key *key = &redirected[event.position];
    if (key->active) {
        struct zmk_behavior_binding target = key->binding;
        struct zmk_behavior_binding_event release_event = key->event;
        release_event.timestamp = event.timestamp;
        key->active = false;
        int err = zmk_behavior_invoke_binding(&target, release_event, false);
        if (err < 0) {
            LOG_WRN("Raijin redirected release %u failed (%d)", event.position, err);
        }
    } else {
        rj_release(&state, event.position, event.timestamp);
    }
    schedule_timer_locked();
    k_mutex_unlock(&raijin_mutex);
    return ZMK_BEHAVIOR_OPAQUE;
}

static int state_listener(const zmk_event_t *event) {
    bool should_reset = false;
    bool main_changed = false;
    const struct zmk_layer_state_changed *layer = as_zmk_layer_state_changed(event);
    if (layer) {
        main_changed = layer->layer == main_layer;
    }
    const struct zmk_activity_state_changed *activity = as_zmk_activity_state_changed(event);
    if (activity) {
        should_reset = activity->state == ZMK_ACTIVITY_SLEEP;
    }
    if (as_zmk_endpoint_changed(event)) {
        should_reset = true;
    }
#if IS_ENABLED(CONFIG_ZMK_BLE)
    if (as_zmk_ble_active_profile_changed(event)) {
        should_reset = true;
    }
#endif
#if IS_ENABLED(CONFIG_ZMK_SPLIT)
    const struct zmk_split_peripheral_status_changed *split =
        as_zmk_split_peripheral_status_changed(event);
    if (split && !split->connected) {
        should_reset = true;
    }
#endif
    if (main_changed || should_reset) {
        k_mutex_lock(&raijin_mutex, K_FOREVER);
        reset_locked(should_reset);
        k_mutex_unlock(&raijin_mutex);
    }
    return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(onishi_raijin, state_listener);
ZMK_SUBSCRIPTION(onishi_raijin, zmk_layer_state_changed);
ZMK_SUBSCRIPTION(onishi_raijin, zmk_activity_state_changed);
ZMK_SUBSCRIPTION(onishi_raijin, zmk_endpoint_changed);
#if IS_ENABLED(CONFIG_ZMK_BLE)
ZMK_SUBSCRIPTION(onishi_raijin, zmk_ble_active_profile_changed);
#endif
#if IS_ENABLED(CONFIG_ZMK_SPLIT)
ZMK_SUBSCRIPTION(onishi_raijin, zmk_split_peripheral_status_changed);
#endif

static int behavior_init(const struct device *dev) {
    ARG_UNUSED(dev);
    struct rj_config config = {
        .space_code = SPACE,
        .backspace_code = BSPC,
        .u_code = U,
        .tapping_term_ms = DT_INST_PROP(0, tapping_term_ms),
    };
    for (size_t i = 0; i < ARRAY_SIZE(vowel_positions); i++) {
        config.vowels[vowel_positions[i]] = vowel_keycodes[i];
    }
    rj_init(&state, &config, (struct rj_callbacks){.emit = emit_key, .aux = set_auxiliary}, NULL);
    initialized = true;
    rj_enable(&state, zmk_keymap_layer_active(main_layer));
    return 0;
}

#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
static const struct behavior_parameter_value_metadata control_commands[] = {
    {.display_name = "Dynamic Space", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, .value = RJ_SPACE},
    {.display_name = "Backspace / auxiliary", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE,
     .value = RJ_BACKSPACE},
};
static const struct behavior_parameter_value_metadata output_commands[] = {
    {.display_name = "Direct key", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, .value = RJ_DIRECT},
    {.display_name = "Double key", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, .value = RJ_DOUBLE},
};
static const struct behavior_parameter_value_metadata no_value[] = {
    {.display_name = "Unused", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_VALUE, .value = 0},
};
static const struct behavior_parameter_value_metadata key_value[] = {
    {.display_name = "Key", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE},
};
static const struct behavior_parameter_value_metadata vowel_value[] = {
    {.display_name = "Thumb vowel", .type = BEHAVIOR_PARAMETER_VALUE_TYPE_HID_USAGE},
};
static const struct behavior_parameter_metadata_set metadata_sets[] = {
    {.param1_values = control_commands, .param1_values_len = ARRAY_SIZE(control_commands),
     .param2_values = no_value, .param2_values_len = ARRAY_SIZE(no_value)},
    {.param1_values = output_commands, .param1_values_len = ARRAY_SIZE(output_commands),
     .param2_values = key_value, .param2_values_len = ARRAY_SIZE(key_value)},
    {.param1_values = key_value, .param1_values_len = ARRAY_SIZE(key_value),
     .param2_values = vowel_value, .param2_values_len = ARRAY_SIZE(vowel_value)},
};
static const struct behavior_parameter_metadata metadata = {
    .sets_len = ARRAY_SIZE(metadata_sets),
    .sets = metadata_sets,
};
#endif

static const struct behavior_driver_api driver_api = {
    .locality = BEHAVIOR_LOCALITY_CENTRAL,
    .binding_pressed = binding_pressed,
    .binding_released = binding_released,
#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_METADATA)
    .parameter_metadata = &metadata,
#endif
};

BEHAVIOR_DT_INST_DEFINE(0, behavior_init, NULL, NULL, NULL, POST_KERNEL,
                        CONFIG_KERNEL_INIT_PRIORITY_DEFAULT, &driver_api);

#endif /* DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT) */
