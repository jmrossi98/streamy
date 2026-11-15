import { CopyField, Notice, Panel } from "@/components/ui";

/** Where to get a Jellyfin app on each kind of device. */
const DEVICES: { device: string; how: string }[] = [
  { device: "Roku", how: "add the Jellyfin channel from the Roku Channel Store." },
  { device: "iPhone or iPad", how: "install Jellyfin Mobile from the App Store." },
  { device: "Android, Fire TV or Google TV", how: "install Jellyfin from Google Play or the Amazon Appstore." },
  { device: "Apple TV", how: "install Swiftfin from the App Store." },
  { device: "A computer or a TV's web browser", how: "just open the server address." },
];

/**
 * How to watch the library in the Jellyfin apps with one's own account: the
 * server's public address, the username (the Streamy name -- the accounts
 * are mirrored, see jellyfinAccounts.ts) and the password, which is the
 * Streamy one once it has been pushed.
 */
export function JellyfinAppCard({
  address,
  username,
  passwordReady,
}: {
  address: string;
  username: string;
  /** False until the Streamy password has been set on the Jellyfin account (next sign-in). */
  passwordReady: boolean;
}) {
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-white">Watch in the Jellyfin app</h2>
      <p className="mb-4 text-sm text-white/50">
        Everything here also plays in the Jellyfin apps on a Roku, phone or TV, signed in as you. Where you stop in
        one picks up in the other.
      </p>
      <Panel className="space-y-5 text-sm">
        <div className="space-y-2">
          <CopyField label="Server" value={address} />
          <CopyField label="Username" value={username} />
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-white/50">Password</span>
            <span className="text-white/85">your Streamy password</span>
          </div>
        </div>

        {!passwordReady && (
          <Notice tone="info">
            Your Jellyfin password is set to your Streamy password the next time you sign in to Streamy. Sign out and
            back in once, then sign in to the app.
          </Notice>
        )}

        <div>
          <h3 className="mb-2 font-medium text-white">Set up the app</h3>
          <ul className="space-y-1.5 text-white/70">
            {DEVICES.map((d) => (
              <li key={d.device}>
                <span className="text-white/90">{d.device}:</span> {d.how}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-white/70">
            Then choose to add a server, enter the address above exactly (with <code>https://</code>), and sign in with
            your username and password.
          </p>
        </div>

        <p className="text-xs text-white/40">
          Works from internet connections in the US; a VPN set to another country can&apos;t connect. A password you
          change inside a Jellyfin app works there until you next change your Streamy password.
        </p>
      </Panel>
    </section>
  );
}
