import { h } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import htm from 'htm';
import {
    seasonLabel,
    seasonParts,
    showMap,
    abbreviateName,
    isFullyWatched,
    sortSeasons,
    sortBySeenCount,
    selectableSeasons,
    filterByShow,
    collapseShows,
    resolveShowFilter,
} from './utils.js';
import { Icon } from './icons.js';
import { FeedBell } from './feed.js';
import { AddSeasonForm } from './manage.js';

const html = htm.bind(h);

// How long a jumped-to row stays lit. Long enough to find the row after the
// scroll settles, short enough that it is gone before you act on it.
const FLASH_MS = 2500;

// Shared with discussion.js, whose feed-arrival scroll follows the same
// respect-the-setting rule this file's NowWatching jump established.
export const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Header({ theme, onToggleTheme, showFeed }) {
    // The toggle shows the theme a click switches *to*, so the sun appears
    // only while dark is in effect and the moon only while light is. This is
    // the one remaining place a component needs to know the theme to draw an
    // icon, and it is a choice of *glyph*, not of variant — read off the
    // `theme` prop this component already receives.
    const dark = theme === 'dark';
    const title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    return html`
        <header class="header">
            <h1 class="title">No Spoilies!</h1>
            <div class="header-actions">
                ${
                    // Only for someone on the roster: every feed route 403s for
                    // anyone else, so the bell would be a control that can only
                    // fail.
                    showFeed ? html`<${FeedBell} />` : null
                }
                <button class="theme-btn" title=${title} onClick=${onToggleTheme}>
                    <${Icon} name=${dark ? 'sun' : 'moon'} />
                </button>
            </div>
        </header>
    `;
}

function SeasonRow({ season, show, users, meId, fullyWatched, flash, onToggle }) {
    const { show: showName, number, subtitle } = seasonParts(season, show);
    const label = seasonLabel(season, show);
    const rowClass = [fullyWatched ? 'watched-all' : '', flash ? 'flash' : '']
        .filter(Boolean)
        .join(' ');
    // The id is what NowWatching's jump buttons scroll to. Keyed on the season
    // rather than the row's position, so it survives a re-sort.
    return html`
        <tr id=${`season-row-${season.id}`} class=${rowClass}>
            <td class="season-cell">
                <div class="season-cell-row">
                    <a href=${`#/season/${season.id}`} aria-label=${label}
                        >${showName ? html`<span class="season-show">${showName}</span>` : null}<span
                            class="season-num"
                            >${number}</span
                        >${subtitle ? html`<span class="season-sub">${subtitle}</span>` : null}</a
                    >
                    ${
                        season.post_count > 0
                            ? html`<span class="post-badge" title=${`${season.post_count} notes`}
                                  ><${Icon} name="chat" />${season.post_count}</span
                              >`
                            : null
                    }
                </div>
            </td>
            ${users.map((u) => {
                const checked = season.watched_by.includes(u.id);
                const isMe = u.id === meId;
                const isCurrentlyWatching = u.currently_watching?.[season.show_id] === season.id;
                return html`
                    <td key=${u.id} class=${'check-cell' + (isMe ? ' mine' : '')}>
                        <label
                            class="check-hit"
                            title=${isMe ? undefined : `Only ${u.name} can change this`}
                        >
                            ${
                                isCurrentlyWatching
                                    ? html`<span
                                          class="watching-indicator"
                                          role="img"
                                          aria-label=${`${u.name} is currently watching this season`}
                                          >▶</span
                                      >`
                                    : null
                            }
                            <input
                                type="checkbox"
                                checked=${checked}
                                disabled=${!isMe}
                                aria-label=${`${u.name} watched ${label}`}
                                onChange=${
                                    isMe ? (e) => onToggle(season, e.target.checked) : undefined
                                }
                            />
                        </label>
                    </td>
                `;
            })}
        </tr>
    `;
}

// A multi-season show folded into one row on the "All shows" board. Clicking it
// filters the board to that show, which is how you get at its seasons. Each
// user cell reads as progress through the show rather than a checkbox, since
// there is no single season to toggle.
function ShowRow({ group, show, users, meId, fullyWatched, onOpen }) {
    const total = group.seasons.length;
    const name = show?.name ?? '';
    return html`
        <tr
            id=${`show-row-${group.show_id}`}
            class=${'show-row' + (fullyWatched ? ' watched-all' : '')}
        >
            <td class="season-cell">
                <button
                    class="show-open"
                    aria-label=${`Show all ${total} seasons of ${name}`}
                    onClick=${() => onOpen(group.show_id)}
                >
                    <span class="show-open-name">${name}</span
                    ><span class="show-open-count">${total} seasons ›</span>
                </button>
            </td>
            ${users.map((u) => {
                const watched = group.seasons.filter((s) => s.watched_by.includes(u.id)).length;
                const isCurrentlyWatching = u.currently_watching?.[group.show_id] != null;
                return html`
                    <td
                        key=${u.id}
                        class=${'check-cell show-progress' + (u.id === meId ? ' mine' : '')}
                    >
                        <span
                            class="check-hit"
                            role="img"
                            aria-label=${`${u.name} watched ${watched} of ${total} seasons of ${name}`}
                        >
                            ${
                                isCurrentlyWatching
                                    ? html`<span class="watching-indicator" aria-hidden="true"
                                          >▶</span
                                      >`
                                    : null
                            }
                            <span aria-hidden="true">${watched}/${total}</span>
                        </span>
                    </td>
                `;
            })}
        </tr>
    `;
}

// A summary strip above the board: one chip per column listing the season it is
// on for each show. Your own chip has a picker per show (from the seasons you
// haven't watched); everyone else's is read-only. Each entry leads with a jump
// button that scrolls that season into view.
function NowWatching({ users, shows, seasons, meId, onSetCurrentlyWatching, onJump }) {
    const seasonsById = new Map(seasons.map((s) => [s.id, s]));
    return html`
        <div class="now-watching">
            <span class="now-watching-label">Now Watching</span>
            <div class="now-watching-items">
                ${users.map((u) => {
                    const isMe = u.id === meId;
                    const picks = shows
                        .map((show) => ({
                            show,
                            season: seasonsById.get(u.currently_watching?.[show.id]),
                        }))
                        .filter((p) => p.season);
                    return html`
                        <div
                            key=${u.id}
                            class=${'nw-chip' + (isMe ? ' mine' : '') + (picks.length ? ' active' : '')}
                        >
                            <span class="nw-name">${isMe ? 'You' : u.name}</span>
                            ${
                                isMe
                                    ? shows
                                          .filter(
                                              (show) =>
                                                  u.currently_watching?.[show.id] != null ||
                                                  selectableSeasons(seasons, meId, show.id).length >
                                                      0,
                                          )
                                          .map((show) => {
                                              const cwId = u.currently_watching?.[show.id] ?? null;
                                              const current =
                                                  cwId != null ? seasonsById.get(cwId) : null;
                                              return html`<span key=${show.id} class="nw-entry">
                                                  ${
                                                      current
                                                          ? html`<button
                                                                class="nw-jump"
                                                                aria-label=${`Jump to your current season, ${seasonLabel(current, show)}`}
                                                                onClick=${() => onJump(current.id)}
                                                            >
                                                                ▶
                                                            </button>`
                                                          : null
                                                  }
                                                  <select
                                                      class="nw-select"
                                                      aria-label=${`Your current season of ${show.name}`}
                                                      value=${cwId ?? ''}
                                                      onChange=${(e) =>
                                                          onSetCurrentlyWatching(
                                                              show.id,
                                                              e.target.value
                                                                  ? Number(e.target.value)
                                                                  : null,
                                                          )}
                                                  >
                                                      <option value="">
                                                          ${show.name}: not watching
                                                      </option>
                                                      ${selectableSeasons(
                                                          seasons,
                                                          meId,
                                                          show.id,
                                                      ).map(
                                                          (s) => html`
                                                              <option key=${s.id} value=${s.id}>
                                                                  ${seasonLabel(s, show)}
                                                              </option>
                                                          `,
                                                      )}
                                                  </select>
                                              </span>`;
                                          })
                                    : picks.length
                                      ? picks.map(
                                            ({ show, season }) =>
                                                html`<span key=${show.id} class="nw-entry">
                                                    <button
                                                        class="nw-jump"
                                                        aria-label=${`Jump to ${u.name}'s current season, ${seasonLabel(season, show)}`}
                                                        onClick=${() => onJump(season.id)}
                                                    >
                                                        ▶
                                                    </button>
                                                    <span class="nw-season"
                                                        >${seasonLabel(season, show)}</span
                                                    >
                                                </span>`,
                                        )
                                      : html`<span class="nw-season">—</span>`
                            }
                        </div>
                    `;
                })}
            </div>
        </div>
    `;
}

// Where the board's show filter is remembered. Per browser, not per person: it
// is a view preference, and storage failing (private mode, blocked site data)
// only means the filter resets to all shows.
const SHOW_FILTER_KEY = 'showFilter';

function readSavedShowFilter() {
    try {
        return localStorage.getItem(SHOW_FILTER_KEY);
    } catch {
        return null;
    }
}

function saveShowFilter(showId) {
    try {
        if (showId == null) localStorage.removeItem(SHOW_FILTER_KEY);
        else localStorage.setItem(SHOW_FILTER_KEY, String(showId));
    } catch {
        // Nothing to do: the filter still applies for this page view.
    }
}

export function Board({
    users,
    shows,
    seasons,
    meId,
    onToggle,
    onSetCurrentlyWatching,
    onRefresh,
}) {
    const [sortMode, setSortMode] = useState('season');
    const [savedFilter, setSavedFilter] = useState(readSavedShowFilter);
    const [flashId, setFlashId] = useState(null);
    const [adding, setAdding] = useState(false);
    // A NowWatching jump to a season folded inside a show row: the jump first
    // opens that show, and this carries the season over to the next render,
    // where its row exists to scroll to.
    const [pendingJump, setPendingJump] = useState(null);
    const showId = resolveShowFilter(savedFilter, shows);
    const shownShows = useMemo(
        () => (showId == null ? shows : shows.filter((s) => s.id === showId)),
        [shows, showId],
    );
    const shownSeasons = useMemo(() => filterByShow(seasons, showId), [seasons, showId]);
    const showsById = useMemo(() => showMap(shows), [shows]);
    const userCount = users.length;
    // Only "All shows" collapses: a filter already narrows the board to one
    // show, and there the point is to see its seasons.
    const sorted = useMemo(() => {
        const rows = showId == null ? collapseShows(shownSeasons) : shownSeasons;
        return sortMode === 'seen'
            ? sortBySeenCount(rows, userCount, shows)
            : sortSeasons(rows, userCount, shows);
    }, [shownSeasons, showId, userCount, shows, sortMode]);

    const chooseShow = (value) => {
        const next = value ? Number(value) : null;
        saveShowFilter(next);
        setSavedFilter(next == null ? null : String(next));
    };

    // Show the current user's column left-most.
    const orderedUsers = useMemo(
        () => [...users].sort((a, b) => (b.id === meId) - (a.id === meId)),
        [users, meId],
    );

    useEffect(() => {
        if (flashId == null) return undefined;
        const timer = setTimeout(() => setFlashId(null), FLASH_MS);
        return () => clearTimeout(timer);
    }, [flashId]);

    useEffect(() => {
        if (pendingJump == null) return;
        setPendingJump(null);
        jumpTo(pendingJump, false);
    }, [pendingJump]);

    // Scrolling alone leaves you hunting for the row you landed on, so the jump
    // also lights it. Focus moves to the season link — with preventScroll, since
    // scrollIntoView is what decides where the row sits — so the jump goes
    // somewhere for a keyboard user instead of only moving the viewport.
    // `openShow` is false on the second attempt, so a row that still is not
    // there after opening its show gives up instead of trying again forever.
    const jumpTo = (seasonId, openShow = true) => {
        const row = document.getElementById(`season-row-${seasonId}`);
        if (!row) {
            const season = seasons.find((s) => s.id === seasonId);
            if (openShow && season && showId == null) {
                chooseShow(season.show_id);
                setPendingJump(seasonId);
            }
            return;
        }
        row.querySelector('.season-cell a')?.focus({ preventScroll: true });
        row.scrollIntoView({
            block: 'center',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
        setFlashId(seasonId);
    };

    return html`
        <div>
            <${NowWatching}
                users=${orderedUsers}
                shows=${shownShows}
                seasons=${seasons}
                meId=${meId}
                onSetCurrentlyWatching=${onSetCurrentlyWatching}
                onJump=${jumpTo}
            />
            <div class="board-controls">
                <label class="show-filter">
                    <span class="sort-label">Show</span>
                    <select
                        class="show-filter-select"
                        value=${showId ?? ''}
                        onChange=${(e) => chooseShow(e.target.value)}
                    >
                        <option value="">All shows</option>
                        ${shows.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}
                    </select>
                </label>
                <div class="sort-controls">
                    <span class="sort-label">Sort by</span>
                    <button
                        class=${'sort-btn' + (sortMode === 'season' ? ' active' : '')}
                        aria-pressed=${sortMode === 'season'}
                        onClick=${() => setSortMode('season')}
                    >
                        Season
                    </button>
                    <button
                        class=${'sort-btn' + (sortMode === 'seen' ? ' active' : '')}
                        aria-pressed=${sortMode === 'seen'}
                        onClick=${() => setSortMode('seen')}
                    >
                        Seen Count
                    </button>
                </div>
                ${
                    meId &&
                    !adding &&
                    html`<button class="sort-btn add-season-btn" onClick=${() => setAdding(true)}>
                        ＋ Add season
                    </button>`
                }
            </div>
            ${
                adding &&
                html`<${AddSeasonForm}
                    shows=${shows}
                    seasons=${seasons}
                    defaultShowId=${showId}
                    onChanged=${onRefresh}
                    onDone=${(addedShowId) => {
                        setAdding(false);
                        // An active filter on some other show would hide the row
                        // just added, and so would "All shows" once the show has
                        // a second season and folds into a show row, so follow
                        // the season to its show.
                        const hidden =
                            showId == null
                                ? seasons.some((s) => s.show_id === addedShowId)
                                : showId !== addedShowId;
                        if (hidden) chooseShow(addedShowId);
                        onRefresh();
                    }}
                    onCancel=${() => setAdding(false)}
                />`
            }
            ${
                showId != null &&
                html`<button class="back-link back-btn" onClick=${() => chooseShow(null)}>
                    ← All shows
                </button>`
            }
            <div class="table-wrapper">
                <table id="board">
                    <thead>
                        <tr>
                            <th class="season-head">Show / Season</th>
                            ${orderedUsers.map(
                                (u) => html`
                                    <th
                                        key=${u.id}
                                        class=${'check-head' + (u.id === meId ? ' mine' : '')}
                                    >
                                        <span class="user-name-full">${u.name}</span
                                        ><span class="user-name-short"
                                            >${abbreviateName(u.name)}</span
                                        >${
                                            u.id === meId
                                                ? html`<span class="you"> (you)</span>`
                                                : null
                                        }
                                    </th>
                                `,
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            sorted.length === 0 && seasons.length > 0
                                ? html`<tr>
                                      <td class="empty-row" colspan=${orderedUsers.length + 1}>
                                          No seasons for this show yet.
                                      </td>
                                  </tr>`
                                : sorted.map((s) =>
                                      s.group
                                          ? html`<${ShowRow}
                                                key=${`show-${s.show_id}`}
                                                group=${s}
                                                show=${showsById.get(s.show_id)}
                                                users=${orderedUsers}
                                                meId=${meId}
                                                fullyWatched=${isFullyWatched(s, userCount)}
                                                onOpen=${chooseShow}
                                            />`
                                          : html`<${SeasonRow}
                                                key=${s.id}
                                                season=${s}
                                                show=${showsById.get(s.show_id)}
                                                users=${orderedUsers}
                                                meId=${meId}
                                                fullyWatched=${isFullyWatched(s, userCount)}
                                                flash=${s.id === flashId}
                                                onToggle=${onToggle}
                                            />`,
                                  )
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;
}
