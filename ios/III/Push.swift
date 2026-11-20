import UIKit
import UserNotifications

enum Push {
    /// Asks for permission (the system shows its prompt once) and, if granted, registers with Apple.
    static func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }
}
