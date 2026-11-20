import UIKit

enum Haptics {
    /// light | medium | heavy | rigid | success | selection
    static func play(_ style: String) {
        switch style {
        case "light": UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "heavy": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case "rigid": UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "selection": UISelectionFeedbackGenerator().selectionChanged()
        default: break
        }
    }
}
