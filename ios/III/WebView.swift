import SwiftUI
import UIKit
import WebKit

/// The app itself, full screen. The page draws everything; this only hosts it and lets it reach
/// the phone (haptics, the share sheet, notifications) through one message handler, "native".
struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore.default() // cookies and storage persist
        configuration.applicationNameForUserAgent = Config.userAgentName
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.add(context.coordinator, name: "native")

        let web = WKWebView(frame: .zero, configuration: configuration)
        let night = UIColor(named: "Night") ?? UIColor(red: 0.008, green: 0.012, blue: 0.102, alpha: 1)
        web.isOpaque = false
        web.backgroundColor = night
        web.scrollView.backgroundColor = night
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never // the page handles the safe areas itself
        web.allowsLinkPreview = false
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true } // Safari > Develop on a Mac
        #endif

        if !Bridge.shared.attach(web) {
            web.load(URLRequest(url: Config.appURL))
        }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "native")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        // Messages from the page: { type: "haptic" | "share" | "push" | "ready", ... }
        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "haptic":
                Haptics.play(body["style"] as? String ?? "light")
            case "share":
                Sharer.present(urlString: body["url"] as? String, imageString: body["image"] as? String)
            case "push":
                Push.requestAuthorization()
            case "ready":
                Bridge.shared.deliverToken()
            default:
                break
            }
        }

        // The app stays on its own address; anything else opens in Safari.
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if url.scheme == "about" || url.scheme == "blob" || url.host == Config.appURL.host {
                decisionHandler(.allow)
                return
            }
            if url.scheme == "https" || url.scheme == "http" || url.scheme == "mailto" {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Bridge.shared.isOffline = false
            Bridge.shared.deliverToken()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        /// A navigation we cancelled ourselves is not a failure.
        private func failed(_ error: Error) {
            let e = error as NSError
            if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
            DispatchQueue.main.async { Bridge.shared.isOffline = true }
        }
    }
}
