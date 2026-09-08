/* SPDX-License-Identifier: MIT */
#include "raijin.h"
#include <string.h>

static void emit(struct rj_state *state, uint32_t code, int64_t now) {
    if (code && state->callbacks.emit) {
        state->callbacks.emit(code, now, state->context);
    }
}

static void auxiliary(struct rj_state *state, bool active) {
    if (state->auxiliary == active) {
        return;
    }
    state->auxiliary = active;
    if (state->callbacks.aux) {
        state->callbacks.aux(active, state->context);
    }
}

static int latest_consonant(const struct rj_state *state) {
    int latest = -1;
    for (int i = 0; i < RJ_KEY_COUNT; i++) {
        if (state->keys[i].role == RJ_CONSONANT &&
            (latest < 0 || state->keys[i].order > state->keys[latest].order)) {
            latest = i;
        }
    }
    return latest;
}

static void next_order(struct rj_state *state) {
    /* Preserve relative order across the (extremely rare) uint32 wrap. */
    if (state->order == UINT32_MAX) {
        uint32_t sorted[RJ_KEY_COUNT];
        int count = 0;
        for (int i = 0; i < RJ_KEY_COUNT; i++) {
            if (state->keys[i].role == RJ_CONSONANT) {
                sorted[count++] = state->keys[i].order;
            }
        }
        for (int i = 0; i < RJ_KEY_COUNT; i++) {
            if (state->keys[i].role != RJ_CONSONANT) {
                continue;
            }
            uint32_t rank = 1;
            for (int j = 0; j < count; j++) {
                rank += sorted[j] < state->keys[i].order;
            }
            state->keys[i].order = rank;
        }
        state->order = (uint32_t)count;
    }
    state->order++;
}

void rj_init(struct rj_state *state, const struct rj_config *config,
             struct rj_callbacks callbacks, void *context) {
    memset(state, 0, sizeof(*state));
    state->config = *config;
    state->callbacks = callbacks;
    state->context = context;
}

void rj_reset(struct rj_state *state) {
    memset(state->keys, 0, sizeof(state->keys));
    state->order = 0;
    state->deadline = 0;
    auxiliary(state, false);
}

void rj_enable(struct rj_state *state, bool enabled) {
    if (state->enabled != enabled) {
        state->enabled = enabled;
        rj_reset(state);
    }
}

static void enter_auxiliary(struct rj_state *state) {
    state->keys[RJ_BACKSPACE_POSITION].role = RJ_AUX_HELD;
    state->keys[RJ_BACKSPACE_POSITION].consumed = true;
    state->deadline = 0;
    auxiliary(state, true);
}

void rj_tick(struct rj_state *state, int64_t now) {
    if (state->enabled && state->deadline && now >= state->deadline &&
        state->keys[RJ_BACKSPACE_POSITION].role == RJ_AUX_PENDING) {
        enter_auxiliary(state);
    }
}

bool rj_prepare_press(struct rj_state *state, uint8_t position, int64_t now) {
    if (!state->enabled || position >= RJ_KEY_COUNT) {
        return false;
    }
    rj_tick(state, now);
    if (state->keys[RJ_BACKSPACE_POSITION].role == RJ_AUX_PENDING &&
        position != RJ_BACKSPACE_POSITION && position != RJ_SPACE_POSITION) {
        enter_auxiliary(state);
    }
    return state->auxiliary;
}

void rj_press(struct rj_state *state, uint8_t position, uint32_t command,
              uint32_t value, int64_t now) {
    if (!state->enabled || position >= RJ_KEY_COUNT || state->keys[position].role != RJ_UP) {
        return;
    }
    struct rj_key *key = &state->keys[position];
    struct rj_key *space = &state->keys[RJ_SPACE_POSITION];
    struct rj_key *backspace = &state->keys[RJ_BACKSPACE_POSITION];
    int consonant = latest_consonant(state);
    key->role = RJ_OUTPUT;

    if (command == RJ_SPACE) {
        if (backspace->role == RJ_AUX_PENDING || backspace->role == RJ_AUX_HELD || state->auxiliary) {
            backspace->consumed = true;
            key->role = RJ_SUPPRESSED;
        } else if (consonant >= 0) {
            emit(state, state->keys[consonant].thumb_vowel, now);
        } else {
            key->role = RJ_MANUAL;
            key->consumed = false;
        }
        return;
    }

    if (command == RJ_BACKSPACE) {
        if (space->role == RJ_MANUAL) {
            space->consumed = true;
            key->role = RJ_SUPPRESSED;
        } else if (consonant >= 0) {
            emit(state, state->config.u_code, now);
        } else {
            key->role = RJ_AUX_PENDING;
            key->consumed = false;
            state->deadline = now + state->config.tapping_term_ms;
        }
        return;
    }

    if (command == RJ_DIRECT || command == RJ_DOUBLE) {
        if (space->role == RJ_MANUAL) {
            space->consumed = true;
        }
        emit(state, value, now);
        if (command == RJ_DOUBLE) {
            emit(state, value, now);
        }
        return;
    }

    if (space->role == RJ_MANUAL) {
        space->consumed = true;
        emit(state, state->config.vowels[position], now);
        return;
    }
    if (state->auxiliary) {
        /* The adapter must resolve this position through the auxiliary keymap. */
        key->role = RJ_SUPPRESSED;
        return;
    }
    if (consonant >= 0 && state->config.vowels[position]) {
        emit(state, state->config.vowels[position], now);
        return;
    }
    next_order(state);
    key->role = RJ_CONSONANT;
    key->order = state->order;
    key->thumb_vowel = value;
    emit(state, command, now);
}

void rj_release(struct rj_state *state, uint8_t position, int64_t now) {
    if (position >= RJ_KEY_COUNT) {
        return;
    }
    rj_tick(state, now);
    struct rj_key key = state->keys[position];
    state->keys[position] = (struct rj_key){0};
    if (!state->enabled) {
        return;
    }
    switch (key.role) {
    case RJ_MANUAL:
        if (!key.consumed) {
            emit(state, state->config.space_code, now);
        }
        break;
    case RJ_AUX_PENDING:
        state->deadline = 0;
        if (!key.consumed) {
            emit(state, state->config.backspace_code, now);
        }
        break;
    case RJ_AUX_HELD:
        state->deadline = 0;
        auxiliary(state, false);
        break;
    default:
        break;
    }
}

int64_t rj_deadline(const struct rj_state *state) {
    return state->enabled ? state->deadline : 0;
}

bool rj_aux_active(const struct rj_state *state) {
    return state->enabled && state->auxiliary;
}
