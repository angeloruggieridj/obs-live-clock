// SPDX-License-Identifier: GPL-2.0-or-later
#include "Texts.hpp"

#include <array>

namespace olc {

Lang langFromLocale(std::string_view locale) {
    if (locale.size() >= 2 && (locale[0] == 'i' || locale[0] == 'I') && (locale[1] == 't' || locale[1] == 'T') &&
        (locale.size() == 2 || locale[2] == '-' || locale[2] == '_'))
        return Lang::It;
    return Lang::En;
}

namespace {
struct Row {
    const char* it;
    const char* en;
};

// Order = enum order. A test checks the count and that nothing is empty.
const std::array<Row, static_cast<size_t>(Msg::COUNT_)> kRows = {{
    /* DockTitle */ {"OBS Live Clock", "OBS Live Clock"},
    /* FallbackBody */
    {"Questa versione di OBS non può mostrare pagine web in un pannello. Apri OBS Live Clock nel browser, oppure "
     "aggiungi l'indirizzo qui sotto da Docks > Pannelli browser personalizzati.",
     "This OBS cannot show web pages in a dock. Open OBS Live Clock in your browser, or add the address below under "
     "Docks > Custom Browser Docks."},
    /* OpenInBrowser */ {"Apri nel browser", "Open in browser"},
    /* CopyUrl */ {"Copia indirizzo", "Copy address"},
    /* UrlLabel */ {"Indirizzo", "Address"},
    /* StatusChecking */ {"Controllo dell'app in corso…", "Checking the app…"},
    /* StatusLaunching */ {"Avvio dell'app in corso…", "Starting the app…"},
    /* StatusRunning */ {"App collegata", "App connected"},
    /* StatusFailed */
    {"L'app è stata avviata ma non risponde. Controlla il comando di avvio nelle impostazioni.",
     "The app was started but does not answer. Check the launch command in the settings."},
    /* StatusUnavailableLocal */
    {"L'app non risponde e non viene riavviata (avvio automatico spento o limite raggiunto).",
     "The app does not answer and is not restarted (auto start is off or the limit was reached)."},
    /* StatusUnavailableRemote */ {"Il server remoto non risponde.", "The remote server does not answer."},
    /* StatusIncompatibleAppNewer */
    {"L'app è più recente del plugin: aggiorna il plugin di OBS Live Clock.",
     "The app is newer than the plugin: update the OBS Live Clock plugin."},
    /* StatusIncompatibleAppOlder */
    {"L'app è più vecchia del plugin: aggiorna l'app di OBS Live Clock.",
     "The app is older than the plugin: update the OBS Live Clock app."},
    /* LaunchSpecMissing */
    {"L'app non è in esecuzione e non so come avviarla: indica il comando nelle impostazioni.",
     "The app is not running and I do not know how to start it: set the command in the settings."},
    /* LaunchFailed */
    {"Il sistema non ha potuto avviare l'app. Controlla il comando nelle impostazioni.",
     "The system could not start the app. Check the command in the settings."},
    /* CredentialsServerDisabled */
    {"Il server WebSocket di OBS è spento: attivalo in Strumenti > Impostazioni server WebSocket.",
     "The OBS WebSocket server is off: enable it under Tools > WebSocket Server Settings."},
    /* CredentialsUnreadable */
    {"Non riesco a leggere le impostazioni del server WebSocket di OBS: inseriscile a mano nell'app.",
     "I cannot read the OBS WebSocket server settings: enter them by hand in the app."},
    /* CredentialsFailing */
    {"Non riesco a consegnare le credenziali di OBS all'app: riprovo.",
     "I cannot hand the OBS credentials to the app: retrying."},
    /* SettingsTitle */ {"Impostazioni di OBS Live Clock", "OBS Live Clock settings"},
    /* ModeLocal */ {"App su questo computer", "App on this computer"},
    /* ModeRemote */ {"App su un altro computer", "App on another computer"},
    /* RemoteUrlLabel */ {"Indirizzo del server", "Server address"},
    /* RemoteUrlInvalid */
    {"Indirizzo non valido: usa http:// o https:// seguito dal nome del computer (e dalla porta).",
     "Invalid address: use http:// or https:// followed by the computer name (and the port)."},
    /* AppCommandLabel */ {"Comando di avvio dell'app", "App launch command"},
    /* AppCommandHint */ {"Vuoto = usa quello dell'installazione", "Empty = use the installed one"},
    /* AutoStart */ {"Avvia l'app quando OBS è pronto", "Start the app when OBS is ready"},
    /* Browse */ {"Sfoglia…", "Browse…"},
    /* MenuEntry */ {"OBS Live Clock…", "OBS Live Clock…"},
}};
}  // namespace

std::string text(Lang lang, Msg msg) {
    const auto index = static_cast<size_t>(msg);
    if (index >= kRows.size()) return {};
    return lang == Lang::It ? kRows[index].it : kRows[index].en;
}

std::string describeStatus(Lang lang, const Status& s) {
    if (s.compat == Compat::AppNewer) return text(lang, Msg::StatusIncompatibleAppNewer);
    if (s.compat == Compat::AppOlder) return text(lang, Msg::StatusIncompatibleAppOlder);
    if (s.launchSpecMissing) return text(lang, Msg::LaunchSpecMissing);
    if (s.launchFailed) return text(lang, Msg::LaunchFailed);
    switch (s.phase) {
    case LaunchPhase::Checking: return text(lang, Msg::StatusChecking);
    case LaunchPhase::Launching: return text(lang, Msg::StatusLaunching);
    case LaunchPhase::Failed: return text(lang, Msg::StatusFailed);
    case LaunchPhase::Unavailable:
        return text(lang, s.remote ? Msg::StatusUnavailableRemote : Msg::StatusUnavailableLocal);
    case LaunchPhase::Incompatible: return text(lang, Msg::StatusIncompatibleAppNewer);
    case LaunchPhase::Running: break;
    }
    switch (s.credentials) {
    case CredentialState::ServerDisabled: return text(lang, Msg::CredentialsServerDisabled);
    case CredentialState::ConfigUnreadable: return text(lang, Msg::CredentialsUnreadable);
    case CredentialState::Failing: return text(lang, Msg::CredentialsFailing);
    case CredentialState::NotApplicable:
    case CredentialState::Delivered: break;
    }
    return {};
}

}  // namespace olc
