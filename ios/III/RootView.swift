import SwiftUI

struct RootView: View {
    @StateObject private var bridge = Bridge.shared

    var body: some View {
        ZStack {
            Color("Night").ignoresSafeArea()
            WebView().ignoresSafeArea()
            if bridge.isOffline {
                OfflineView { bridge.reload() }
                    .transition(.opacity)
            }
        }
        .preferredColorScheme(.dark)
        // iii://i/AB12-CD34 opens the invitation; iii://w/<token> opens a shared answer.
        .onOpenURL { url in
            let path = "/" + (url.host ?? "") + url.path
            Bridge.shared.open(path: path)
        }
    }
}
