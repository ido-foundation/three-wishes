// The bridge to the iPhone app's native shell. In a browser or a Home Screen app everything here
// does nothing and `available` is false; inside the shell the page talks to Swift through one
// message handler named "native".
const handler = () => window.webkit?.messageHandlers?.native;

export const native = {
  /** True only inside the iPhone app (its user agent says so and the handler exists). */
  get available() {
    return /III-iOS/.test(navigator.userAgent) && !!handler();
  },
  post(message) {
    try {
      handler().postMessage(message);
      return true;
    } catch {
      return false;
    }
  },
  /** light | medium | heavy | rigid | success | selection */
  haptic(style) {
    return this.available && this.post({ type: 'haptic', style });
  },
  /** Opens the iOS share sheet with the picture and the link. */
  share(url, image) {
    return this.available && this.post({ type: 'share', url, image });
  },
  /** Asks for permission to notify, once the person has a reason to say yes. */
  requestPush() {
    return this.available && this.post({ type: 'push' });
  },
  /** Tells the shell the person is signed in, so it can hand over the phone's push token. */
  ready() {
    return this.available && this.post({ type: 'ready' });
  },
};
