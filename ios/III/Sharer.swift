import UIKit

/// Opens the iOS share sheet with the answer's picture and its link.
enum Sharer {
    private final class Box { var image: UIImage? }

    static func present(urlString: String?, imageString: String?) {
        let box = Box()
        let group = DispatchGroup()

        // Only fetch the picture from the app's own address.
        if let s = imageString, let url = URL(string: s), url.host == Config.appURL.host {
            group.enter()
            URLSession.shared.dataTask(with: url) { data, _, _ in
                if let data = data { box.image = UIImage(data: data) }
                group.leave()
            }.resume()
        }

        group.notify(queue: .main) {
            var items: [Any] = []
            if let image = box.image { items.append(image) }
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
