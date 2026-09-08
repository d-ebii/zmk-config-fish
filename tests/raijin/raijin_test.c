/* SPDX-License-Identifier: MIT
 * Pure state-machine tests: no Zephyr, keyboard hardware, or IME required.
 * Codes use ZMK's encoded keyboard usage page (0x07 << 16 | HID usage).
 */
#include "raijin.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define HID(usage) (UINT32_C(0x070000) | (usage))
#define LETTER(letter) HID(UINT32_C(0x04) + (uint32_t)((letter) - 'a'))
#define SPACE_CODE HID(UINT32_C(0x2c))
#define BACKSPACE_CODE HID(UINT32_C(0x2a))
#define ESCAPE_CODE HID(UINT32_C(0x29))
#define CAPACITY 256

static const char *current_test;

static void fail(const char *file, int line, const char *condition) {
    fprintf(stderr, "FAIL %s (%s:%d): %s\n", current_test, file, line, condition);
    exit(EXIT_FAILURE);
}

#define CHECK(condition) do { \
    if (!(condition)) { fail(__FILE__, __LINE__, #condition); } \
} while (0)

struct fixture {
    struct rj_state state;
    uint32_t codes[CAPACITY];
    int64_t times[CAPACITY];
    size_t count;
    bool aux_changes[CAPACITY];
    size_t aux_count;
    int64_t now;
};

struct binding {
    uint32_t command;
    uint32_t value;
};

/* Fish's right-hand keys; positions 30/31 are the two right thumb keys. */
static const struct binding letters[RJ_KEY_COUNT] = {
    [4] = {LETTER('k'), LETTER('o')},
    [5] = {LETTER('w'), LETTER('o')},
    [6] = {LETTER('r'), LETTER('a')},
    [7] = {LETTER('y'), LETTER('i')},
    [14] = {LETTER('g'), LETTER('o')},
    [15] = {LETTER('t'), LETTER('o')},
    [16] = {LETTER('n'), LETTER('a')},
    [17] = {LETTER('s'), LETTER('i')},
    [18] = {LETTER('h'), LETTER('e')},
    [19] = {LETTER('p'), LETTER('e')},
    [24] = {LETTER('d'), LETTER('o')},
    [25] = {LETTER('m'), LETTER('a')},
    [26] = {LETTER('z'), LETTER('i')},
    [27] = {LETTER('b'), LETTER('e')},
    [30] = {RJ_BACKSPACE, 0},
    [31] = {RJ_SPACE, 0},
};

static void on_emit(uint32_t code, int64_t timestamp, void *context) {
    struct fixture *fixture = context;
    CHECK(fixture->count < CAPACITY);
    fixture->codes[fixture->count] = code;
    fixture->times[fixture->count] = timestamp;
    fixture->count++;
}

static void on_aux(bool active, void *context) {
    struct fixture *fixture = context;
    CHECK(fixture->aux_count < CAPACITY);
    fixture->aux_changes[fixture->aux_count++] = active;
}

static void init(struct fixture *fixture) {
    struct rj_config config = {
        .vowels = {
            [6] = LETTER('u'), [15] = LETTER('o'), [16] = LETTER('a'),
            [17] = LETTER('i'), [18] = LETTER('e'),
        },
        .space_code = SPACE_CODE,
        .backspace_code = BACKSPACE_CODE,
        .u_code = LETTER('u'),
        .tapping_term_ms = 180,
    };
    struct rj_callbacks callbacks = {.emit = on_emit, .aux = on_aux};
    memset(fixture, 0, sizeof(*fixture));
    fixture->now = 1000;
    rj_init(&fixture->state, &config, callbacks, fixture);
    rj_enable(&fixture->state, true);
}

static bool press_binding(struct fixture *fixture, uint8_t position,
                          uint32_t command, uint32_t value) {
    /* The adapter prepares before it resolves the possibly changed layer. */
    bool auxiliary = rj_prepare_press(&fixture->state, position, fixture->now);
    rj_press(&fixture->state, position, command, value, fixture->now++);
    return auxiliary;
}

static bool down(struct fixture *fixture, uint8_t position) {
    CHECK(position < RJ_KEY_COUNT);
    CHECK(letters[position].command != 0 || position == RJ_SPACE_POSITION);
    return press_binding(fixture, position, letters[position].command,
                         letters[position].value);
}

static void up(struct fixture *fixture, uint8_t position) {
    rj_release(&fixture->state, position, fixture->now++);
}

static void tap(struct fixture *fixture, uint8_t position) {
    down(fixture, position);
    up(fixture, position);
}

static uint32_t expected_code(char letter) {
    if (letter >= 'a' && letter <= 'z') {
        return LETTER(letter);
    }
    switch (letter) {
    case ' ': return SPACE_CODE;
    case '\b': return BACKSPACE_CODE;
    case '\x1b': return ESCAPE_CODE;
    default: fail(__FILE__, __LINE__, "unknown expected character"); return 0;
    }
}

static void expect_text(const struct fixture *fixture, const char *expected) {
    if (fixture->count != strlen(expected)) {
        fprintf(stderr, "Expected %zu output events, got %zu\n",
                strlen(expected), fixture->count);
        fail(__FILE__, __LINE__, "output length");
    }
    for (size_t i = 0; i < fixture->count; i++) {
        if (fixture->codes[i] != expected_code(expected[i])) {
            fprintf(stderr, "Output %zu: expected 0x%08lx, got 0x%08lx\n", i,
                    (unsigned long)expected_code(expected[i]),
                    (unsigned long)fixture->codes[i]);
            fail(__FILE__, __LINE__, "output code");
        }
    }
}

static void expect_aux(const struct fixture *fixture, const char *expected) {
    CHECK(fixture->aux_count == strlen(expected));
    for (size_t i = 0; i < fixture->aux_count; i++) {
        CHECK(expected[i] == '+' || expected[i] == '-');
        CHECK(fixture->aux_changes[i] == (expected[i] == '+'));
    }
}

static void all_released(const struct fixture *fixture) {
    for (size_t i = 0; i < RJ_KEY_COUNT; i++) {
        CHECK(fixture->state.keys[i].role == RJ_UP);
    }
    CHECK(!rj_aux_active(&fixture->state));
    CHECK(rj_deadline(&fixture->state) == 0);
}

static void test_ka_ko_ki_na_ru(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 4); tap(&fixture, 16); up(&fixture, 4); /* K + A */
    down(&fixture, 4); tap(&fixture, 31); up(&fixture, 4); /* K + Space(O) */
    down(&fixture, 4); tap(&fixture, 17); up(&fixture, 4); /* K + I */
    down(&fixture, 16); tap(&fixture, 31); up(&fixture, 16); /* N + Space(A) */
    down(&fixture, 6); tap(&fixture, 30); up(&fixture, 6); /* R + Bspc(U) */
    expect_text(&fixture, "kakokinaru");
    expect_aux(&fixture, "");
    all_released(&fixture);
}

static void test_all_consonant_space_vowels(void) {
    const uint8_t positions[] = {4, 5, 6, 7, 14, 15, 16, 17, 18, 19, 24, 25, 26, 27};
    /* Independently written expectations for every physical consonant key. */
    const char *expected[] = {"ko", "wo", "ra", "yi", "go", "to", "na",
                              "si", "he", "pe", "do", "ma", "zi", "be"};
    for (size_t i = 0; i < sizeof(positions) / sizeof(positions[0]); i++) {
        struct fixture fixture;
        init(&fixture);
        down(&fixture, positions[i]);
        tap(&fixture, 31);
        up(&fixture, positions[i]);
        expect_text(&fixture, expected[i]);
        all_released(&fixture);
    }
}

static void test_all_vowel_positions(void) {
    const uint8_t positions[] = {6, 15, 16, 17, 18};
    const char *expected[] = {"ku", "ko", "ka", "ki", "ke"};
    for (size_t i = 0; i < sizeof(positions) / sizeof(positions[0]); i++) {
        struct fixture fixture;
        init(&fixture);
        down(&fixture, 4);
        tap(&fixture, positions[i]);
        up(&fixture, 4);
        expect_text(&fixture, expected[i]);
        all_released(&fixture);
    }
}

static void test_manual_vowels_a_u(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 31); tap(&fixture, 16); up(&fixture, 31);
    down(&fixture, 31); tap(&fixture, 6); up(&fixture, 31);
    expect_text(&fixture, "au");
    all_released(&fixture);
}

static void test_manual_repeated_vowels(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 31);
    tap(&fixture, 16); tap(&fixture, 17); tap(&fixture, 6);
    tap(&fixture, 18); tap(&fixture, 15);
    up(&fixture, 31);
    expect_text(&fixture, "aiueo");
    all_released(&fixture);
}

static void test_kyou(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 4); down(&fixture, 7); up(&fixture, 4);
    tap(&fixture, 15); tap(&fixture, 30); up(&fixture, 7);
    expect_text(&fixture, "kyou");
    expect_aux(&fixture, "");
    all_released(&fixture);
}

static void test_katta(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 4); tap(&fixture, 16); up(&fixture, 4);
    tap(&fixture, 15); down(&fixture, 15); tap(&fixture, 16); up(&fixture, 15);
    expect_text(&fixture, "katta");
    all_released(&fixture);
}

static void test_nna_fa_va(void) {
    const uint8_t auxiliary_positions[] = {27, 19, 5};
    const uint32_t auxiliary_commands[] = {RJ_DOUBLE, RJ_DIRECT, RJ_DIRECT};
    const uint32_t auxiliary_values[] = {LETTER('n'), LETTER('f'), LETTER('v')};
    struct fixture fixture;
    init(&fixture);
    for (size_t i = 0; i < 3; i++) {
        down(&fixture, 30);
        CHECK(press_binding(&fixture, auxiliary_positions[i],
                            auxiliary_commands[i], auxiliary_values[i]));
        up(&fixture, auxiliary_positions[i]); up(&fixture, 30);
        down(&fixture, 31); tap(&fixture, 16); up(&fixture, 31);
    }
    expect_text(&fixture, "nnafava");
    expect_aux(&fixture, "+-+-+-");
    all_released(&fixture);
}

static void test_latest_held_and_release_fallback(void) {
    struct fixture fixture;
    init(&fixture);
    /* Descending positions catch accidental physical-index priority. */
    down(&fixture, 25); down(&fixture, 7); down(&fixture, 4);
    tap(&fixture, 31); up(&fixture, 4);
    tap(&fixture, 31); up(&fixture, 7);
    tap(&fixture, 31); up(&fixture, 25);
    expect_text(&fixture, "mykoia");
    all_released(&fixture);
}

static void test_vowel_hold_does_not_become_consonant(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 4); down(&fixture, 16);
    CHECK(fixture.state.keys[16].role == RJ_OUTPUT);
    up(&fixture, 4);
    down(&fixture, 31);
    expect_text(&fixture, "ka");
    CHECK(fixture.state.keys[31].role == RJ_MANUAL);
    up(&fixture, 31); up(&fixture, 16);
    expect_text(&fixture, "ka ");
    all_released(&fixture);
}

static void test_vowel_key_becomes_consonant_after_repress(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 4); tap(&fixture, 16); up(&fixture, 4);
    down(&fixture, 16); tap(&fixture, 31); up(&fixture, 16);
    expect_text(&fixture, "kana");
    all_released(&fixture);
}

static void test_duplicate_presses_and_releases(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 4); down(&fixture, 4);
    CHECK(fixture.state.order == 1);
    down(&fixture, 31); down(&fixture, 31);
    up(&fixture, 31); up(&fixture, 31); up(&fixture, 4); up(&fixture, 4);
    down(&fixture, 31); down(&fixture, 31);
    up(&fixture, 31); up(&fixture, 31);
    expect_text(&fixture, "ko ");
    all_released(&fixture);
}

static void test_manual_invalid_vowel_suppresses_space(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 31); tap(&fixture, 5); up(&fixture, 31); /* W has no vowel. */
    expect_text(&fixture, "");
    all_released(&fixture);
}

static void test_space_tap_outputs_on_release(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 31);
    expect_text(&fixture, "");
    fixture.now += 1000;
    int64_t release_time = fixture.now;
    up(&fixture, 31);
    expect_text(&fixture, " ");
    CHECK(fixture.times[0] == release_time);
    all_released(&fixture);
}

static void test_space_then_backspace_suppresses_both(void) {
    for (int reverse_release = 0; reverse_release <= 1; reverse_release++) {
        struct fixture fixture;
        init(&fixture);
        down(&fixture, 31); down(&fixture, 30);
        CHECK(rj_deadline(&fixture.state) == 0);
        rj_tick(&fixture.state, fixture.now + 1000);
        if (reverse_release) { up(&fixture, 31); up(&fixture, 30); }
        else { up(&fixture, 30); up(&fixture, 31); }
        expect_text(&fixture, "");
        expect_aux(&fixture, "");
        all_released(&fixture);
    }
}

static void test_backspace_then_space_suppresses_taps(void) {
    for (int reverse_release = 0; reverse_release <= 1; reverse_release++) {
        struct fixture fixture;
        init(&fixture);
        down(&fixture, 30); down(&fixture, 31);
        if (reverse_release) { up(&fixture, 30); up(&fixture, 31); }
        else { up(&fixture, 31); up(&fixture, 30); }
        expect_text(&fixture, "");
        expect_aux(&fixture, "");
        all_released(&fixture);
    }
}

static void test_backspace_short_tap(void) {
    struct fixture fixture;
    init(&fixture);
    int64_t pressed = fixture.now;
    down(&fixture, 30);
    expect_text(&fixture, "");
    CHECK(rj_deadline(&fixture.state) == pressed + 180);
    fixture.now = pressed + 179;
    up(&fixture, 30);
    expect_text(&fixture, "\b");
    CHECK(fixture.times[0] == pressed + 179);
    expect_aux(&fixture, "");
    rj_tick(&fixture.state, pressed + 500);
    expect_aux(&fixture, "");
    all_released(&fixture);
}

static void test_backspace_exact_boundary_release(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 30);
    fixture.now = rj_deadline(&fixture.state);
    up(&fixture, 30);
    expect_text(&fixture, "");
    expect_aux(&fixture, "+-");
    all_released(&fixture);
}

static void test_backspace_deadline_and_aux_space_suppression(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 30);
    int64_t deadline = rj_deadline(&fixture.state);
    rj_tick(&fixture.state, deadline - 1);
    CHECK(!rj_aux_active(&fixture.state));
    rj_tick(&fixture.state, deadline);
    CHECK(rj_aux_active(&fixture.state));
    CHECK(rj_deadline(&fixture.state) == 0);
    rj_tick(&fixture.state, deadline + 500);
    expect_aux(&fixture, "+");
    fixture.now = deadline + 501;
    tap(&fixture, 31);
    up(&fixture, 30);
    expect_text(&fixture, "");
    expect_aux(&fixture, "+-");
    all_released(&fixture);
}

static void test_duplicate_backspace_does_not_extend_deadline(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 30);
    int64_t deadline = rj_deadline(&fixture.state);
    fixture.now = deadline - 20;
    down(&fixture, 30);
    CHECK(rj_deadline(&fixture.state) == deadline);
    fixture.now = deadline;
    up(&fixture, 30); up(&fixture, 30);
    expect_text(&fixture, "");
    expect_aux(&fixture, "+-");
    all_released(&fixture);
}

static void test_early_prepare_resolves_auxiliary_binding(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 30);
    fixture.now += 20;
    CHECK(rj_prepare_press(&fixture.state, 4, fixture.now));
    CHECK(rj_aux_active(&fixture.state));
    CHECK(rj_deadline(&fixture.state) == 0);
    rj_press(&fixture.state, 4, RJ_DIRECT, ESCAPE_CODE, fixture.now++);
    /* Releasing the thumb first must not change the key's recorded role. */
    up(&fixture, 30); up(&fixture, 4);
    tap(&fixture, 4);
    expect_text(&fixture, "\x1b" "k");
    expect_aux(&fixture, "+-");
    all_released(&fixture);
}

static void test_auxiliary_rejects_unresolved_consonant(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 30);
    CHECK(down(&fixture, 4));
    CHECK(fixture.state.keys[4].role == RJ_SUPPRESSED);
    up(&fixture, 4); up(&fixture, 30);
    expect_text(&fixture, "");
    expect_aux(&fixture, "+-");
    all_released(&fixture);
}

static void test_direct_and_double_consume_manual_space(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 31);
    press_binding(&fixture, 19, RJ_DIRECT, LETTER('f')); up(&fixture, 19);
    press_binding(&fixture, 27, RJ_DOUBLE, LETTER('n')); up(&fixture, 27);
    up(&fixture, 31);
    expect_text(&fixture, "fnn");
    CHECK(fixture.times[1] == fixture.times[2]);
    all_released(&fixture);
}

static void test_direct_output_does_not_become_held_consonant(void) {
    struct fixture fixture;
    init(&fixture);
    press_binding(&fixture, 19, RJ_DIRECT, LETTER('f'));
    tap(&fixture, 31);
    up(&fixture, 19);
    expect_text(&fixture, "f ");
    all_released(&fixture);
}

static void test_reset_cancels_pending_and_stale_releases(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 30);
    int64_t deadline = rj_deadline(&fixture.state);
    rj_reset(&fixture.state);
    rj_tick(&fixture.state, deadline + 1000);
    fixture.now = deadline + 1001;
    up(&fixture, 30);
    down(&fixture, 31);
    rj_reset(&fixture.state);
    up(&fixture, 31);
    expect_text(&fixture, "");
    expect_aux(&fixture, "");
    all_released(&fixture);
    /* Reset preserves the mode's enabled flag and permits a fresh sequence. */
    down(&fixture, 4); tap(&fixture, 31); up(&fixture, 4);
    expect_text(&fixture, "ko");
}

static void test_disable_clears_auxiliary_and_reentry(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 30);
    fixture.now = rj_deadline(&fixture.state);
    rj_tick(&fixture.state, fixture.now);
    CHECK(rj_aux_active(&fixture.state));
    rj_enable(&fixture.state, false);
    CHECK(!rj_aux_active(&fixture.state));
    CHECK(!rj_prepare_press(&fixture.state, 4, fixture.now));
    down(&fixture, 4); up(&fixture, 4); up(&fixture, 30);
    rj_tick(&fixture.state, fixture.now + 1000);
    expect_text(&fixture, "");
    expect_aux(&fixture, "+-");
    all_released(&fixture);
    rj_enable(&fixture.state, true);
    up(&fixture, 30); up(&fixture, 31); /* old unpaired releases after entry */
    down(&fixture, 16); tap(&fixture, 31); up(&fixture, 16);
    expect_text(&fixture, "na");
    all_released(&fixture);
}

static void test_enable_is_idempotent(void) {
    struct fixture fixture;
    init(&fixture);
    down(&fixture, 4);
    rj_enable(&fixture.state, true);
    tap(&fixture, 31); up(&fixture, 4);
    expect_text(&fixture, "ko");
    all_released(&fixture);
}

static void test_order_wrap_preserves_latest_held(void) {
    struct fixture fixture;
    init(&fixture);
    fixture.state.order = UINT32_MAX - 2;
    down(&fixture, 25); down(&fixture, 7); down(&fixture, 4);
    CHECK(fixture.state.order == 3);
    CHECK(fixture.state.keys[25].order == 1);
    CHECK(fixture.state.keys[7].order == 2);
    CHECK(fixture.state.keys[4].order == 3);
    tap(&fixture, 31); up(&fixture, 4);
    tap(&fixture, 31); up(&fixture, 7);
    tap(&fixture, 31); up(&fixture, 25);
    expect_text(&fixture, "mykoia");
    all_released(&fixture);
}

static void test_out_of_range_positions_are_ignored(void) {
    struct fixture fixture;
    init(&fixture);
    CHECK(!rj_prepare_press(&fixture.state, RJ_KEY_COUNT, fixture.now));
    CHECK(!rj_prepare_press(&fixture.state, UINT8_MAX, fixture.now));
    rj_press(&fixture.state, RJ_KEY_COUNT, RJ_DIRECT, LETTER('a'), fixture.now);
    rj_press(&fixture.state, UINT8_MAX, RJ_SPACE, 0, fixture.now);
    rj_release(&fixture.state, RJ_KEY_COUNT, fixture.now);
    rj_release(&fixture.state, UINT8_MAX, fixture.now);
    expect_text(&fixture, "");
    expect_aux(&fixture, "");
    all_released(&fixture);
}

static void test_no_callbacks_are_supported(void) {
    struct fixture fixture;
    init(&fixture);
    fixture.state.callbacks = (struct rj_callbacks){0};
    tap(&fixture, 4);
    down(&fixture, 30);
    fixture.now = rj_deadline(&fixture.state);
    rj_tick(&fixture.state, fixture.now);
    up(&fixture, 30);
    expect_text(&fixture, "");
    expect_aux(&fixture, "");
    all_released(&fixture);
}

struct test_case {
    const char *name;
    void (*run)(void);
};

#define TEST(name) {#name, test_##name}

int main(void) {
    const struct test_case tests[] = {
        TEST(ka_ko_ki_na_ru),
        TEST(all_consonant_space_vowels),
        TEST(all_vowel_positions),
        TEST(manual_vowels_a_u),
        TEST(manual_repeated_vowels),
        TEST(kyou),
        TEST(katta),
        TEST(nna_fa_va),
        TEST(latest_held_and_release_fallback),
        TEST(vowel_hold_does_not_become_consonant),
        TEST(vowel_key_becomes_consonant_after_repress),
        TEST(duplicate_presses_and_releases),
        TEST(manual_invalid_vowel_suppresses_space),
        TEST(space_tap_outputs_on_release),
        TEST(space_then_backspace_suppresses_both),
        TEST(backspace_then_space_suppresses_taps),
        TEST(backspace_short_tap),
        TEST(backspace_exact_boundary_release),
        TEST(backspace_deadline_and_aux_space_suppression),
        TEST(duplicate_backspace_does_not_extend_deadline),
        TEST(early_prepare_resolves_auxiliary_binding),
        TEST(auxiliary_rejects_unresolved_consonant),
        TEST(direct_and_double_consume_manual_space),
        TEST(direct_output_does_not_become_held_consonant),
        TEST(reset_cancels_pending_and_stale_releases),
        TEST(disable_clears_auxiliary_and_reentry),
        TEST(enable_is_idempotent),
        TEST(order_wrap_preserves_latest_held),
        TEST(out_of_range_positions_are_ignored),
        TEST(no_callbacks_are_supported),
    };
    size_t count = sizeof(tests) / sizeof(tests[0]);
    for (size_t i = 0; i < count; i++) {
        current_test = tests[i].name;
        printf("[%zu/%zu] %s\n", i + 1, count, current_test);
        fflush(stdout);
        tests[i].run();
    }
    printf("PASS: %zu Raijin state-machine tests\n", count);
    return EXIT_SUCCESS;
}
