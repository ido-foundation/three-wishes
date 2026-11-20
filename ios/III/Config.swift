import Foundation

/// Settings that come from the build (see project.yml and Info.plist), not from code.
enum Config {
    /// Where the app lives. Must be https. Set `APP_URL` in project.yml.
    static var appURL: URL {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "AppURL") as? String) ?? ""
        return URL(string: raw) ?? URL(string: "https://invalid.example")!
    }

    /// "sandbox" for a build run from Xcode, "production" for TestFlight and the App Store.
    static var apnsEnvironment: String {
        (Bundle.main.object(forInfoDictionaryKey: "ApnsEnv") as? String) ?? "production"
    }

    /// Appended to the web view's user agent; the web app looks for it to know it is inside the app.
    static let userAgentName = "III-iOS/1.0"
}
