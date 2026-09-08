# SPDX-License-Identifier: MIT

if ((NOT CONFIG_ZMK_SPLIT) OR CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
  target_include_directories(app PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
  target_sources_ifdef(CONFIG_ZMK_BEHAVIOR_ONISHI_RAIJIN app PRIVATE
    src/raijin/raijin.c
    src/behaviors/behavior_onishi_raijin.c)
endif()
