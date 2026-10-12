// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <obs.h>

#include <memory>
#include <string>
#include <vector>

#include "HotkeyForwarder.hpp"

namespace olc {

/**
 * Registers the 18 fixed slots with OBS (DT-9) and forwards presses to the HotkeyForwarder.
 *
 * Key assignments: when the operator assigns a key in OBS Settings > Hotkeys, OBS stores it in the profile's
 * basic.ini under [Hotkeys], keyed by the registration name. OBS reloads such bindings only for its own hotkeys;
 * for a plugin's frontend hotkeys libobs does nothing, so this class loads them itself after registering and again
 * when the profile changes.
 */
class HotkeyRegistrar {
public:
    explicit HotkeyRegistrar(HotkeyForwarder& forwarder);
    ~HotkeyRegistrar();

    void registerAll();       // UI thread, after OBS finished loading (a profile is active)
    void reloadBindings();    // UI thread, on profile change
    void unregisterAll();     // UI thread, before the forwarder and its worker are destroyed

    HotkeyForwarder& forwarder() { return forwarder_; }

private:
    struct Target {
        HotkeyRegistrar* owner;
        std::string slotId;
    };
    static void onHotkey(void* data, obs_hotkey_id id, obs_hotkey_t* hotkey, bool pressed);

    HotkeyForwarder& forwarder_;
    std::vector<std::unique_ptr<Target>> targets_;
    std::vector<obs_hotkey_id> ids_;
};

}  // namespace olc
