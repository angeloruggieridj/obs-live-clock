// SPDX-License-Identifier: GPL-2.0-or-later
#include "HotkeySlots.hpp"

namespace olc {

namespace {
std::vector<SlotDef> build() {
    std::vector<SlotDef> slots;
    for (int n = 1; n <= 12; ++n) {
        const auto s = std::to_string(n);
        slots.push_back({"message-" + s, "obs-live-clock.message." + s, "OBS Live Clock: Messaggio " + s, false});
    }
    slots.push_back({"clear", "obs-live-clock.clear", "OBS Live Clock: CLEAR", false});
    slots.push_back({"next", "obs-live-clock.next", "OBS Live Clock: NEXT", true});
    slots.push_back({"prev", "obs-live-clock.prev", "OBS Live Clock: PREV", true});
    slots.push_back({"time-plus", "obs-live-clock.time.plus", "OBS Live Clock: +tempo", true});
    slots.push_back({"time-minus", "obs-live-clock.time.minus", "OBS Live Clock: -tempo", true});
    slots.push_back({"control-toggle", "obs-live-clock.control.toggle", "OBS Live Clock: MANUALE/AUTO", true});
    return slots;
}
}  // namespace

const std::vector<SlotDef>& hotkeySlots() {
    static const std::vector<SlotDef> slots = build();
    return slots;
}

const SlotDef* findSlot(const std::string& id) {
    for (const auto& slot : hotkeySlots())
        if (slot.id == id) return &slot;
    return nullptr;
}

}  // namespace olc
