import UIKit

/// Opens the iOS share sheet with the answer's picture and its link.
@MainActor
enum Sharer {
    static func present(urlString: String?, imageString: String?) {
        Task {
            var items: [Any] = []

            // Only fetch the picture from the app's own address.
            if let s = imageString, let url = URL(string: s), url.host == Config.appURL.host,
               let (data, _) = try? await URLSession.shared.data(from: url),
               let image = UIImage(data: data) {
                items.append(image)
            }
            if let s = urlString, let url = URL(string: s), url.host == Config.appURL.host { items.append(url) }
            guard !items.isEmpty, let top = topViewController() else { return }
            top.present(UIActivityViewController(activityItems: items, applicationActivities: nil), animated: true)
        }
    }

    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var controller = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let presented = controller?.presentedViewController { controller = presented }
        return controller
    }
}
