import { h, render } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { setWatched, clearsCurrentlyWatching } from './utils.js';
import { api } from './api.js';
import { useTheme, useRefreshGuard, useRefreshOnFocus, useRoute } from './hooks.js';
import { withSlugs, resolveRoute, showPath, targetPath } from './routes.js';
import { Header, Board } from './board.js';
import { SeasonView } from './discussion.js';

const html = htm.bind(h);

function App() {
    const [users, setUsers] = useState([]);
    const [shows, setShows] = useState([]);
    const [seasons, setSeasons] = useState([]);
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { theme, toggle: toggleTheme } = useTheme();
    const { route, setRoute, navigate } = useRoute();

    // The shows as of the last applied board, for `chooseShow`: a caller that
    // awaited a refetch holds a callback from a render before it.
    const showsRef = useRef(shows);

    const fetchBoard = useCallback(() => api('/api/board'), []);
    const applyBoard = useCallback((board) => {
        setUsers(board.users);
        showsRef.current = withSlugs(board.shows);
        setShows(showsRef.current);
        setSeasons(board.seasons);
        setMe(board.me);
    }, []);
    const { refresh, beginMutation, endMutation } = useRefreshGuard(fetchBoard, applyBoard);
    useRefreshOnFocus(refresh, setError);

    useEffect(() => {
        (async () => {
            try {
                await refresh();
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        })();
    }, [refresh]);

    // Resolved once per route and then held by id: a refetch that brings in a
    // rename must not turn the open season into an address that names nothing,
    // which would unmount it along with whatever was being typed.
    const resolvedRef = useRef({ route: null, target: null });
    if (resolvedRef.current.route !== route || !resolvedRef.current.target) {
        resolvedRef.current = { route, target: resolveRoute(route, shows, seasons) };
    }
    const target = loading ? null : resolvedRef.current.target;
    const routeSeasonId = target?.seasonId ?? null;
    const routeShowId = target?.showId ?? null;

    // A link can name something added since the board was last fetched, so an
    // address that does not resolve gets one refetch before it is called missing.
    const [missingRoute, setMissingRoute] = useState(null);
    const unresolved = !loading && !target;
    useEffect(() => {
        if (!unresolved) return undefined;
        // A slow response for an address since left must not answer for this one.
        let left = false;
        refresh()
            .then(
                (applied) => applied && setError(null),
                (err) => setError(err.message),
            )
            .finally(() => {
                if (!left) setMissingRoute(route);
            });
        return () => {
            left = true;
        };
    }, [unresolved, route, refresh]);

    // Keeps the address bar on the one readable address for what is on screen —
    // through a rename, a different case, an id-based link, or an episode being
    // opened. Replaces rather than pushes, so Back leaves a season instead of
    // stepping through every episode opened in it.
    useEffect(() => {
        const path = target && targetPath(target, shows, seasons);
        if (path && path !== window.location.pathname + window.location.hash) {
            window.history.replaceState(null, '', path);
        }
    }, [target, shows, seasons]);

    // By id, which the effect above turns into the address.
    const openEpisode = useCallback(
        (episode) => setRoute({ seasonId: routeSeasonId, episode, byHand: true }),
        [setRoute, routeSeasonId],
    );

    const chooseShow = useCallback(
        (showId) => navigate(showPath(showsRef.current.find((s) => s.id === showId))),
        [navigate],
    );

    // The board a season was opened from, so its back link returns to the same
    // filter. A season arrived at directly goes back to all shows.
    const boardShowIdRef = useRef(null);
    if (target && routeSeasonId == null) boardShowIdRef.current = routeShowId;

    // A season's post-count badge goes stale the moment you post from inside it,
    // since the season view fetches its own discussion data rather than /api/board.
    // Refetch the board on the way back out — unless the way out is an address
    // that does not resolve, which the effect above is already refetching for.
    const prevRouteSeasonId = useRef(routeSeasonId);
    useEffect(() => {
        if (prevRouteSeasonId.current != null && routeSeasonId == null && !unresolved) {
            refresh().catch((err) => setError(err.message));
        }
        prevRouteSeasonId.current = routeSeasonId;
    }, [routeSeasonId, unresolved, refresh]);

    const meId = me?.id ?? null;

    // Keep the latest users in a ref so the optimistic callbacks can read the
    // current state without listing `users` in their deps — that would recreate
    // them on every board change and risk stale closures.
    const usersRef = useRef(users);
    usersRef.current = users;

    const setCurrentlyWatching = useCallback(
        async (showId, seasonId) => {
            beginMutation();
            const prev =
                usersRef.current.find((u) => u.id === meId)?.currently_watching?.[showId] ?? null;
            const withPick = (picks, id) => {
                const next = { ...picks };
                if (id == null) delete next[showId];
                else next[showId] = id;
                return next;
            };
            setUsers((current) =>
                current.map((u) =>
                    u.id === meId
                        ? { ...u, currently_watching: withPick(u.currently_watching, seasonId) }
                        : u,
                ),
            );
            try {
                await api('/api/currently-watching', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ show_id: showId, season_id: seasonId }),
                });
                setError(null);
            } catch (err) {
                setUsers((current) =>
                    current.map((u) =>
                        u.id === meId
                            ? { ...u, currently_watching: withPick(u.currently_watching, prev) }
                            : u,
                    ),
                );
                setError(err.message);
            } finally {
                endMutation();
            }
        },
        [meId, beginMutation, endMutation],
    );

    const toggle = useCallback(
        async (season, checked) => {
            const seasonId = season.id;
            beginMutation();
            // Marking a season seen also clears it as your currently-watching
            // season (the server does this too) — you can't be mid-watch on
            // something you've finished.
            const clearsCurrent = clearsCurrentlyWatching(
                usersRef.current.find((u) => u.id === meId),
                season,
                checked,
            );

            // Optimistic: flip the cell, then reconcile with the server.
            setSeasons((prev) =>
                prev.map((s) =>
                    s.id === seasonId
                        ? { ...s, watched_by: setWatched(s.watched_by, meId, checked) }
                        : s,
                ),
            );
            if (clearsCurrent) {
                setUsers((prev) =>
                    prev.map((u) => {
                        if (u.id !== meId) return u;
                        const next = { ...u.currently_watching };
                        delete next[season.show_id];
                        return { ...u, currently_watching: next };
                    }),
                );
            }
            try {
                if (checked) {
                    await api('/api/watched', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ season_id: seasonId }),
                    });
                } else {
                    await api(`/api/watched/${seasonId}`, { method: 'DELETE' });
                }
                setError(null);
            } catch (err) {
                // Revert the optimistic change on failure.
                setSeasons((prev) =>
                    prev.map((s) =>
                        s.id === seasonId
                            ? { ...s, watched_by: setWatched(s.watched_by, meId, !checked) }
                            : s,
                    ),
                );
                if (clearsCurrent) {
                    setUsers((prev) =>
                        prev.map((u) =>
                            u.id === meId
                                ? {
                                      ...u,
                                      currently_watching: {
                                          ...u.currently_watching,
                                          [season.show_id]: seasonId,
                                      },
                                  }
                                : u,
                        ),
                    );
                }
                setError(err.message);
            } finally {
                endMutation();
            }
        },
        [meId, beginMutation, endMutation],
    );

    // For the add form: creating a show or season is not optimistic — the new
    // row needs the server's id — so the board simply refetches afterwards.
    const refreshBoard = useCallback(
        () =>
            refresh().then(
                () => setError(null),
                (err) => setError(err.message),
            ),
        [refresh],
    );

    return html`
        <div class="container">
            <${Header}
                theme=${theme}
                onToggleTheme=${toggleTheme}
                shows=${shows}
                showFeed=${Boolean(meId)}
            />
            <main class="app">
                ${error && html`<div class="error">${error}</div>`}
                ${loading && html`<div class="loading">Loading…</div>`}
                ${
                    !loading &&
                    !me &&
                    users.length > 0 &&
                    routeSeasonId == null &&
                    html`
                        <div class="notice">
                            You're not on the watch list — the board is read-only.
                        </div>
                    `
                }
                ${
                    !loading &&
                    !error &&
                    users.length === 0 &&
                    routeSeasonId == null &&
                    html`
                        <div class="empty-state">
                            No users yet. Add people to the board (see README).
                        </div>
                    `
                }
                ${unresolved && missingRoute !== route && html`<div class="loading">Loading…</div>`}
                ${
                    unresolved &&
                    missingRoute === route &&
                    !error &&
                    html`<div class="notice">
                        There's no show or season at this address. <a href="/">Go to the board</a>
                    </div>`
                }
                ${
                    !loading &&
                    routeSeasonId != null &&
                    html`<${SeasonView}
                        key=${routeSeasonId}
                        seasonId=${routeSeasonId}
                        route=${route}
                        routeEpisode=${target.episode}
                        backHref=${showPath(shows.find((s) => s.id === boardShowIdRef.current))}
                        onOpenEpisode=${openEpisode}
                        onEdited=${refreshBoard}
                    />`
                }
                ${
                    !loading &&
                    target &&
                    routeSeasonId == null &&
                    users.length > 0 &&
                    html`
                        <${Board}
                            users=${users}
                            shows=${shows}
                            seasons=${seasons}
                            meId=${meId}
                            showId=${routeShowId}
                            onChooseShow=${chooseShow}
                            onToggle=${toggle}
                            onSetCurrentlyWatching=${setCurrentlyWatching}
                            onRefresh=${refreshBoard}
                        />
                    `
                }
            </main>
        </div>
    `;
}

render(html`<${App} />`, document.getElementById('root'));
