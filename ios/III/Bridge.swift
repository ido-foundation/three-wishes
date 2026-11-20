import Foundation
import WebKit

/// The one place the web view, notifications and links meet.
final class Bridge: ObservableObject {
    static let shared = Bridge()

    /// True after a page fails to load; the offline screen shows over the web view.
    @Published var isOffline = false

    weak var webView: WKWebView?
    private var pushToken: String?
    private var pendingPath: String?

    /// Returns true if it opened a path that was waiting (a link that started the app).
    @discardableResult
    func attach(_ webView: WKWebView) -> Bool {
        self.webView = webView
        if let path = pendingPath {
            pendingPath = nil
            open(path: path)
            return true
        }
        return false
    }

    /// Opens a path of the app (for example "/i/AB12-CD34" or "/?w=...") in the web view.
    func open(path: String) {
        guard let webView = webView else {
            pendingPath = path
            return
        }
        guard let url = URL(string: path, relativeTo: Config.appURL)?.absoluteURL,
              url.host == Config.appURL.host else { return }
        webView.load(URLRequest(url: url))
    }

    func reload() {
        isOffline = false
        webView?.load(URLRequest(url: Config.appURL))
    }

    func setPushToken(_ token: String) {
        pushToken = token
        deliverToken()
    }

    /// Hands the phone's token to the page, which sends it to the server as the signed-in person.
    /// The token is hexadecimal, so it is safe to place in the script.
    func deliverToken() {
        guard let token = pushToken, let webView = webView else { return }
        let script = "window.nativePush && window.nativePush('\(token)', '\(Config.apnsEnvironment)');"
        DispatchQueue.main.async {
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}
