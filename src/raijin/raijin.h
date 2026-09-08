/* SPDX-License-Identifier: MIT */
#ifndef FISH_RAIJIN_H
#define FISH_RAIJIN_H

#include <stdbool.h>
#include <stdint.h>

#define RJ_KEY_COUNT 32
#define RJ_BACKSPACE_POSITION 30
#define RJ_SPACE_POSITION 31
#define RJ_SPACE 0
#define RJ_BACKSPACE 1
#define RJ_DIRECT 2
#define RJ_DOUBLE 3

enum rj_role {
    RJ_UP, RJ_CONSONANT, RJ_OUTPUT, RJ_MANUAL, RJ_AUX_PENDING,
    RJ_AUX_HELD, RJ_SUPPRESSED
};

struct rj_key {
    enum rj_role role;
    uint32_t order;
    uint32_t thumb_vowel;
    bool consumed;
};

struct rj_config {
    uint32_t vowels[RJ_KEY_COUNT];
    uint32_t space_code;
    uint32_t backspace_code;
    uint32_t u_code;
    uint16_t tapping_term_ms;
};

struct rj_callbacks {
    void (*emit)(uint32_t code, int64_t timestamp, void *context);
    void (*aux)(bool active, void *context);
};

struct rj_state {
    struct rj_config config;
    struct rj_callbacks callbacks;
    void *context;
    struct rj_key keys[RJ_KEY_COUNT];
    uint32_t order;
    int64_t deadline;
    bool enabled;
    bool auxiliary;
};

void rj_init(struct rj_state *state, const struct rj_config *config,
             struct rj_callbacks callbacks, void *context);
void rj_enable(struct rj_state *state, bool enabled);
void rj_reset(struct rj_state *state);
bool rj_prepare_press(struct rj_state *state, uint8_t position, int64_t now);
void rj_press(struct rj_state *state, uint8_t position, uint32_t command,
              uint32_t value, int64_t now);
void rj_release(struct rj_state *state, uint8_t position, int64_t now);
void rj_tick(struct rj_state *state, int64_t now);
int64_t rj_deadline(const struct rj_state *state);
bool rj_aux_active(const struct rj_state *state);

#endif
