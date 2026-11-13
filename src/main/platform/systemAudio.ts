import { desktopCapturer, type Session, type WebContents } from 'electron';

/**
 * Register on the intended window's dedicated session, before its page loads.
 * The caller must invoke capture from a user gesture. This only authorizes the
 * supplied main frame; no mic source or network service is selected here.
 *
 * platform: windows / macos
 */
export function installSystemAudioHandler(session: Session, owner: WebContents): void {
  session.setDisplayMediaRequestHandler((request, callback) => {
    if (request.frame !== owner.mainFrame || !request.userGesture || !request.audioRequested || !request.videoRequested) {
      callback({});
      return;
    }
    void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        if (!sources[0] || owner.isDestroyed() || request.frame !== owner.mainFrame) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch(() => callback({}));
  });
}
