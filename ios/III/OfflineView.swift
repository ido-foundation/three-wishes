import SwiftUI

/// Shown over the web view when the app cannot be reached.
struct OfflineView: View {
    let retry: () -> Void

    var body: some View {
        ZStack {
            Color("Night").ignoresSafeArea()
            VStack(spacing: 26) {
                Image("LaunchSeal")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 96)
                Text("NO CONNECTION")
                    .font(.system(size: 12, weight: .medium))
                    .tracking(2.4)
                    .foregroundColor(Color.white.opacity(0.7))
                Button(action: retry) {
                    Text("TRY AGAIN")
                        .font(.system(size: 13, weight: .medium))
                        .tracking(1.8)
                        .foregroundColor(Color("Night"))
                        .padding(.horizontal, 32)
                        .padding(.vertical, 16)
                        .background(Capsule().fill(Color(red: 0.949, green: 0.914, blue: 0.894)))
                }
            }
        }
    }
}
