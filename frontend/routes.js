// The app's routing table, as pure functions. A view has one address:
//
//   /                  the board
//   /Survivor          the board, filtered to one show
//   /Survivor/51       a season
//   /Survivor/51/10    a season with one episode open
//
// Ids never stay in the address bar; a route names a show by slug and a
// season by number, and is resolved to ids against the loaded board.

// First path segments that something other than a show answers: the API,
// Cloudflare's own endpoints, and /index, which assets redirect to /.
const RESERVED = new Set(['api', 'cdn-cgi', 'index']);

const slugKey = (slug) => slug.normalize('NFC').toLowerCase();

function slugify(name) {
    return name
        .normalize('NFC')
        .replace(/['’]|\p{Variation_Selector}/gu, '')
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '');
}

// Gives every show its `slug`. Names are unique but slugs need not be ("A B" and
// "A-B"), so the lowest id keeps the plain one — a show added later cannot take
// over an existing link — and any other gets `~id`, which no name slugifies to.
export function withSlugs(shows) {
    const taken = new Set(RESERVED);
    const slugs = new Map();
    for (const show of [...shows].sort((a, b) => a.id - b.id)) {
        const plain = slugify(show.name);
        const slug = plain && !taken.has(slugKey(plain)) ? plain : `${plain}~${show.id}`;
        taken.add(slugKey(slug));
        slugs.set(show.id, slug);
    }
    return shows.map((s) => ({ ...s, slug: slugs.get(s.id) }));
}

export function showPath(show) {
    return show ? `/${encodeURIComponent(show.slug)}` : '/';
}

export function seasonPath(show, number, episode = null) {
    return `${showPath(show)}/${number}${episode == null ? '' : `/${episode}`}`;
}

// What a location asks for: `{ slug, number, episode }`, or `{ seasonId,
// episode }` for a `#/season/45/episode/3` link, the address of a season whose show
// has no slug here yet. A path that fits neither is `{ unknown: true }`.
//
// Numbers carry the [1-9]\d* guard: no leading zeros and no bare 0, neither of
// which names a season or an episode.
export function parseRoute({ pathname, hash }) {
    const legacy = /^#\/season\/([1-9]\d*)(?:\/episode\/([1-9]\d*))?$/.exec(hash);
    if (pathname === '/' && legacy) {
        return { seasonId: Number(legacy[1]), episode: legacy[2] ? Number(legacy[2]) : null };
    }
    if (pathname === '/') return { slug: null, number: null, episode: null };
    const match = /^\/([^/]+)(?:\/([1-9]\d*)(?:\/([1-9]\d*))?)?\/?$/.exec(pathname);
    if (!match) return { unknown: true };
    let slug;
    try {
        slug = decodeURIComponent(match[1]);
    } catch {
        return { unknown: true };
    }
    return {
        slug,
        number: match[2] ? Number(match[2]) : null,
        episode: match[3] ? Number(match[3]) : null,
    };
}

// The ids a route names, `{ showId, seasonId, episode }` with null for a level
// it does not reach, or null when the board has no such show or season.
export function resolveRoute(route, shows, seasons) {
    if (route.unknown) return null;
    if (route.seasonId != null) {
        const season = seasons.find((s) => s.id === route.seasonId);
        return season
            ? { showId: season.show_id, seasonId: season.id, episode: route.episode }
            : null;
    }
    if (route.slug == null) return { showId: null, seasonId: null, episode: null };
    const show = shows.find((s) => slugKey(s.slug) === slugKey(route.slug));
    if (!show) return null;
    if (route.number == null) return { showId: show.id, seasonId: null, episode: null };
    const season = seasons.find((s) => s.show_id === show.id && s.number === route.number);
    return season ? { showId: show.id, seasonId: season.id, episode: route.episode } : null;
}

// The one address of a resolved target, or null if the board has lost it.
export function targetPath(target, shows, seasons) {
    const show = shows.find((s) => s.id === target.showId);
    if (target.showId != null && !show) return null;
    if (target.seasonId == null) return showPath(show);
    const season = seasons.find((s) => s.id === target.seasonId);
    return season ? seasonPath(show, season.number, target.episode) : null;
}
