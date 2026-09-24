import { getDownloadRouting } from "@/lib/radarr";

/**
 * Why downloads go the way they go.
 *
 * "Torrent wins every time" is a reasonable thing to notice and an
 * unreasonable thing to have to reverse-engineer: the answer is spread across
 * a Radarr delay profile, the indexer list, and each indexer's live health,
 * in two different apps.
 *
 * The specific failure this is built to expose is the one that actually
 * happened here. Usenet was the preferred protocol the whole time, with a
 * 30-minute handicap on torrents, and torrents still won every grab -- not
 * because the preference was wrong, but because no usenet release could be
 * fetched at all. A preference you cannot act on looks exactly like a
 * preference you do not have, and nothing on this page could tell them apart.
 */
export async function DownloadRoutingPanel() {
  const routing = await getDownloadRouting();

  if (!routing) {
    return <p className="text-sm text-white/40">Radarr isn&apos;t reachable, so routing is unknown.</p>;
  }

  const { preference, recentGrabs, indexers } = routing;
  const totalGrabs = recentGrabs.usenet + recentGrabs.torrent;

  // The contradiction worth surfacing: a protocol that is preferred, enabled,
  // and has working indexers, yet never wins. Stated as an observation rather
  // than a diagnosis -- this panel can see that it never wins, not why.
  const preferredProto = preference?.preferred;
  const preferredWins =
    preferredProto === "usenet"
      ? recentGrabs.usenet
      : preferredProto === "torrent"
        ? recentGrabs.torrent
        : null;
  const preferredHasIndexers =
    preferredProto === "usenet" ? indexers.usenet > 0 : preferredProto === "torrent" ? indexers.torrent > 0 : false;
  const contradiction =
    preferredProto && preferredWins === 0 && totalGrabs > 0 && preferredHasIndexers;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="mb-1 font-medium text-white/80">How Radarr chooses</h3>
        {preference ? (
          <p className="text-white/60">
            Prefers <span className="text-white/90">{preference.preferred}</span>. Usenet releases
            wait <span className="text-white/90">{preference.usenetDelayMinutes} min</span>, torrents
            wait <span className="text-white/90">{preference.torrentDelayMinutes} min</span> before
            they can be grabbed.
            {preference.torrentDelayMinutes > preference.usenetDelayMinutes && (
              <> That handicap is what gives usenet first refusal.</>
            )}
          </p>
        ) : (
          <p className="text-white/40">No delay profile found.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/30">Last {totalGrabs} grabs</p>
          <p className="mt-1 text-white/70">
            {recentGrabs.usenet} usenet · {recentGrabs.torrent} torrent
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-white/30">Indexers searching</p>
          <p className="mt-1 text-white/70">
            {indexers.usenet} usenet · {indexers.torrent} torrent
          </p>
        </div>
      </div>

      {contradiction && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-amber-300">
            {preferredProto} is preferred and has {preferredProto === "usenet" ? indexers.usenet : indexers.torrent}{" "}
            indexer(s) searching, but has won none of the last {totalGrabs} grabs.
          </p>
          <p className="mt-1 text-xs text-white/50">
            Searching and grabbing are different paths, and only the second one
            actually fetches the release file. A protocol can return plenty of
            results and still fail at the moment of the grab.
          </p>
        </div>
      )}

      {routing.failingIndexerIds.length > 0 && (
        <p className="text-xs text-white/40">
          {routing.failingIndexerIds.length} indexer(s) currently backing off after failures - they
          are skipped while disabled, which narrows what either protocol can offer.
        </p>
      )}
    </div>
  );
}
