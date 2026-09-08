/* SPDX-License-Identifier: MIT */
#ifndef FISH_RAIJIN_ADAPTER_STUBS_H
#define FISH_RAIJIN_ADAPTER_STUBS_H

/* Host-only declarations for exercising the real adapter's control flow.
 * Firmware builds use Zephyr/ZMK headers, not these test substitutes. */
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define CONFIG_ZMK_SPLIT 1
#define CONFIG_ZMK_BLE 1
#define CONFIG_ZMK_BEHAVIOR_METADATA 0
#define CONFIG_KERNEL_INIT_PRIORITY_DEFAULT 0
#define IS_ENABLED(option) (option)
#define ARG_UNUSED(value) (void)(value)
#define ARRAY_SIZE(value) (sizeof(value) / sizeof((value)[0]))
#define BUILD_ASSERT(test, message) _Static_assert(test, message)
#define DT_HAS_COMPAT_STATUS_OKAY(compat) 1
#define DT_NUM_INST_STATUS_OKAY(compat) 1
#define DT_INST_PROP_LEN(instance, property) 5
#define DT_INST_PROP(instance, property) TEST_DT_##property
#define TEST_DT_main_layer 8
#define TEST_DT_auxiliary_layer 9
#define TEST_DT_tapping_term_ms 180
#define TEST_DT_vowel_positions {6, 15, 16, 17, 18}
#define TEST_DT_vowel_keycodes {U, O, A, I, E}
#define DT_FOREACH_PROP_ELEM(node, property, callback) callback(node, property, 0)
#define DT_PROP_BY_IDX(node, property, index) 6
#define ZMK_KEYMAP_LAYERS_LEN 10
#define ZMK_BEHAVIOR_OPAQUE 0
#define ZMK_BEHAVIOR_TRANSPARENT 1
#define ZMK_EV_EVENT_BUBBLE 0
#define LOG_MODULE_DECLARE(name, level) _Static_assert(1, "logging")
#define LOG_WRN(...) ((void)++test_warnings)
#define BEHAVIOR_LOCALITY_CENTRAL 0
#define POST_KERNEL 0
#define BEHAVIOR_DT_INST_DEFINE(instance, init, pm, data, config, level, priority, api) \
    _Static_assert(sizeof(api) > 0, "adapter registration")
#define ZMK_LISTENER(name, callback) _Static_assert(sizeof(&(callback)) > 0, "listener")
#define ZMK_SUBSCRIPTION(name, event) _Static_assert(1, "subscription")

#define A 0x70004u
#define E 0x70008u
#define I 0x7000cu
#define K 0x7000eu
#define N 0x70011u
#define O 0x70012u
#define T 0x70017u
#define U 0x70018u
#define SPACE 0x7002cu
#define BSPC 0x7002au

struct device { int unused; };
struct zmk_behavior_binding {
    const char *behavior_dev;
    uint32_t param1;
    uint32_t param2;
};
struct zmk_behavior_binding_event {
    int layer;
    uint32_t position;
    int64_t timestamp;
    uint8_t source;
};
struct behavior_driver_api {
    int locality;
    int (*binding_pressed)(struct zmk_behavior_binding *, struct zmk_behavior_binding_event);
    int (*binding_released)(struct zmk_behavior_binding *, struct zmk_behavior_binding_event);
};
typedef uint8_t zmk_keymap_layer_id_t;

enum zmk_activity_state { ZMK_ACTIVITY_ACTIVE, ZMK_ACTIVITY_IDLE, ZMK_ACTIVITY_SLEEP };
struct zmk_layer_state_changed { uint8_t layer; bool state; bool locked; int64_t timestamp; };
struct zmk_activity_state_changed { enum zmk_activity_state state; };
struct zmk_endpoint_changed { int unused; };
struct zmk_ble_active_profile_changed { uint8_t index; };
struct zmk_split_peripheral_status_changed { bool connected; };
enum test_event_type { TEST_LAYER, TEST_ACTIVITY, TEST_ENDPOINT, TEST_BLE, TEST_SPLIT };
typedef struct {
    enum test_event_type type;
    union {
        struct zmk_layer_state_changed layer;
        struct zmk_activity_state_changed activity;
        struct zmk_endpoint_changed endpoint;
        struct zmk_ble_active_profile_changed ble;
        struct zmk_split_peripheral_status_changed split;
    } data;
} zmk_event_t;

#define TEST_EVENT_CAST(name, member, kind)                                                         \
    static inline const struct name *as_##name(const zmk_event_t *event) {                          \
        return event->type == kind ? &event->data.member : NULL;                                    \
    }
TEST_EVENT_CAST(zmk_layer_state_changed, layer, TEST_LAYER)
TEST_EVENT_CAST(zmk_activity_state_changed, activity, TEST_ACTIVITY)
TEST_EVENT_CAST(zmk_endpoint_changed, endpoint, TEST_ENDPOINT)
TEST_EVENT_CAST(zmk_ble_active_profile_changed, ble, TEST_BLE)
TEST_EVENT_CAST(zmk_split_peripheral_status_changed, split, TEST_SPLIT)

struct k_mutex { unsigned depth; };
#define K_MUTEX_DEFINE(name) struct k_mutex name = {0}
#define K_FOREVER (-1)
struct k_work { void (*handler)(struct k_work *); };
struct k_work_delayable { struct k_work work; int64_t scheduled; };
#define K_WORK_DELAYABLE_DEFINE(name, callback)                                                     \
    struct k_work_delayable name = {.work = {.handler = callback}, .scheduled = 0}
#define K_MSEC(value) (value)
extern int64_t test_now;
extern unsigned test_warnings;
extern unsigned test_max_mutex_depth;

int k_mutex_lock(struct k_mutex *mutex, int timeout);
int k_mutex_unlock(struct k_mutex *mutex);
int k_work_cancel_delayable(struct k_work_delayable *work);
int k_work_reschedule(struct k_work_delayable *work, int64_t delay);
int64_t k_uptime_get(void);
bool zmk_keymap_layer_active(zmk_keymap_layer_id_t layer);
int zmk_keymap_layer_activate(zmk_keymap_layer_id_t layer, bool locking);
int zmk_keymap_layer_deactivate(zmk_keymap_layer_id_t layer, bool locking);
int zmk_keymap_layer_to(zmk_keymap_layer_id_t layer, bool locking);
const struct zmk_behavior_binding *zmk_keymap_get_layer_binding_at_idx(
    zmk_keymap_layer_id_t layer, uint16_t position);
int zmk_behavior_invoke_binding(const struct zmk_behavior_binding *binding,
                                struct zmk_behavior_binding_event event, bool pressed);
int raise_zmk_keycode_state_changed_from_encoded(uint32_t code, bool pressed, int64_t timestamp);

#endif
