// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <string>
#include <vector>

namespace olc {

/**
 * The fixed OBS hotkey slots (DT-9). OBS stores key assignments by the registration NAME, so these names are a
 * contract with the user's profile: never rename one. `id` is what the app receives in POST /api/internal/hotkey;
 * a contract test pins this table against server/src/hotkeys/slots.ts.
 */
struct SlotDef {
    std::string id;           // "message-1" .. "message-12", "clear", "next", "prev", "time-plus", "time-minus", "control-toggle"
    std::string obsName;      // "obs-live-clock.message.1" ...
    std::string description;  // what OBS shows in Settings > Hotkeys
    bool emergency;           // the app asks for a second press within 1 s (DT-9)
};

const std::vector<SlotDef>& hotkeySlots();
const SlotDef* findSlot(const std::string& id);

} // namespace olc
