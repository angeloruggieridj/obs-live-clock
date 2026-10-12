// SPDX-License-Identifier: GPL-2.0-or-later
#include "HotkeyRegistrar.hpp"

#include <obs-frontend-api.h>
#include <obs-module.h>
#include <util/config-file.h>

#include "HotkeySlots.hpp"

namespace olc {

HotkeyRegistrar::HotkeyRegistrar(HotkeyForwarder& forwarder) : forwarder_(forwarder) {}

HotkeyRegistrar::~HotkeyRegistrar() { unregisterAll(); }

void HotkeyRegistrar::onHotkey(void* data, obs_hotkey_id, obs_hotkey_t*, bool pressed) {
    if (!pressed) return;  // OBS calls back on release too; only the press counts
    const auto* target = static_cast<Target*>(data);
    // This runs on OBS's hotkey thread: onPress() only numbers the press and queues a job.
    target->owner->forwarder_.onPress(target->slotId);
}

void HotkeyRegistrar::registerAll() {
    if (!ids_.empty()) return;
    for (const SlotDef& slot : hotkeySlots()) {
        auto target = std::make_unique<Target>(Target{this, slot.id});
        const obs_hotkey_id id = obs_hotkey_register_frontend(slot.obsName.c_str(), slot.description.c_str(), &HotkeyRegistrar::onHotkey, target.get());
        targets_.push_back(std::move(target));
        ids_.push_back(id);
    }
    reloadBindings();
}

void HotkeyRegistrar::reloadBindings() {
    config_t* profile = obs_frontend_get_profile_config();
    if (!profile) return;
    const auto& slots = hotkeySlots();
    for (size_t i = 0; i < ids_.size() && i < slots.size(); ++i) {
        if (ids_[i] == OBS_INVALID_HOTKEY_ID) continue;
        const char* json = config_get_string(profile, "Hotkeys", slots[i].obsName.c_str());
        obs_data_array_t* bindings = nullptr;
        obs_data_t* data = json ? obs_data_create_from_json(json) : nullptr;
        if (data) bindings = obs_data_get_array(data, "bindings");
        obs_hotkey_load(ids_[i], bindings);  // a null array clears the bindings: the new profile has none
        if (bindings) obs_data_array_release(bindings);
        if (data) obs_data_release(data);
    }
}

void HotkeyRegistrar::unregisterAll() {
    for (const obs_hotkey_id id : ids_)
        if (id != OBS_INVALID_HOTKEY_ID) obs_hotkey_unregister(id);
    ids_.clear();
    targets_.clear();  // only now: no callback can reach them any more
}

}  // namespace olc
