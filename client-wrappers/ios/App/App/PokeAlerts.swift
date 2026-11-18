import UIKit
import Capacitor
import UserNotifications

/**
 The poke on the iPhone (docs/design/poke-alarm.md, "iPhone").

 A poke is sent as a Critical Alert: it rings with the phone on silent and in any Focus. iOS only allows that when (1) Apple has given the app the Critical Alerts
 entitlement and (2) the person said yes to critical alerts in the FIRST permission question the app asks (the option cannot be added by a later question). The
 push plugin of Capacitor asks without that option, so this plugin asks first, with it; the push plugin then finds the answer already given and does not ask again.
 The web app calls `PokeAlerts.requestCritical()` just before it turns push on (core/push.service.ts).
 */
@objc(PokeAlertsPlugin)
public class PokeAlertsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PokeAlertsPlugin"
    public let jsName = "PokeAlerts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestCritical", returnType: CAPPluginReturnPromise)
    ]

    /// Asks for alerts, badge, sound AND critical alerts. Answers `{ granted: Bool }` (notifications as a whole; whether critical alerts were allowed is the person's switch in Settings).
    @objc func requestCritical(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound, .criticalAlert]) { granted, _ in
            call.resolve(["granted": granted])
        }
    }
}

/// The one screen of the app (the web view), with the PokeAlerts plugin added to it.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PokeAlertsPlugin())
    }
}
