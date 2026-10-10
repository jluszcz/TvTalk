import { describe, it, expect } from 'vitest';
import {
    seasonLabel,
    seasonParts,
    abbreviateName,
    authorAccent,
    isFullyWatched,
    sortSeasons,
    sortBySeenCount,
    selectableSeasons,
    setWatched,
    clearsCurrentlyWatching,
    replyTargetGone,
    quoteSnippet,
    bodyAfterPost,
    formatAdjust,
    clampAdjust,
    settledAdjust,
    relativeTime,
    feedLine,
    parseHashRoute,
    shouldScrollToEpisode,
    skipLabel,
    filterByShow,
    collapseShows,
    resolveShowFilter,
    nextSeasonNumber,
    linkLabel,
} from '../../frontend/utils.js';

// ---------------------------------------------------------------------------
// seasonLabel
// ---------------------------------------------------------------------------

const shows = [
    { id: 1, name: 'Lanterns', url: '' },
    { id: 2, name: 'The Great British Bake Off', url: '' },
    { id: 3, name: 'andor', url: '' },
];

describe('seasonLabel', () => {
    it('names the show, the season, and the subtitle', () => {
        expect(seasonLabel({ number: 2, subtitle: 'Return' }, shows[0])).toBe(
            'Lanterns Season 2: Return',
        );
    });
    it('omits an empty subtitle', () => {
        expect(seasonLabel({ number: 14, subtitle: '' }, shows[1])).toBe(
            'The Great British Bake Off Season 14',
        );
    });
    it('falls back to the bare season when the show is unknown', () => {
        expect(seasonLabel({ number: 3, subtitle: '' }, undefined)).toBe('Season 3');
    });
});

// ---------------------------------------------------------------------------
// seasonParts
// ---------------------------------------------------------------------------

describe('seasonParts', () => {
    it('splits show, number, and subtitle', () => {
        expect(seasonParts({ number: 1, subtitle: 'X' }, shows[0])).toEqual({
            show: 'Lanterns',
            number: 'Season 1',
            subtitle: 'X',
        });
    });
    it('uses empty strings for a missing show or subtitle', () => {
        expect(seasonParts({ number: 1 }, undefined)).toEqual({
            show: '',
            number: 'Season 1',
            subtitle: '',
        });
    });
});

// ---------------------------------------------------------------------------
// abbreviateName
// ---------------------------------------------------------------------------

describe('abbreviateName', () => {
    it('collapses a shared column to initials', () => {
        expect(abbreviateName('Bob & Carol')).toBe('B & C');
    });

    it('leaves a single name alone', () => {
        expect(abbreviateName('Alice')).toBe('Alice');
    });

    it('leaves a multi-word single name alone', () => {
        expect(abbreviateName('Mary Jane')).toBe('Mary Jane');
    });

    it('handles more than two names', () => {
        expect(abbreviateName('Dave & Erin & Alice')).toBe('D & E & A');
    });

    it('tolerates missing spaces around the ampersand', () => {
        expect(abbreviateName('Bob&Carol')).toBe('B & C');
    });

    it('uppercases a lowercased name', () => {
        expect(abbreviateName('bob & carol')).toBe('B & C');
    });

    it('passes a name with a stray ampersand through untouched', () => {
        expect(abbreviateName('Alice &')).toBe('Alice &');
    });
});

// ---------------------------------------------------------------------------
// authorAccent
// ---------------------------------------------------------------------------

describe('authorAccent', () => {
    it("marks the caller's own notes", () => {
        expect(authorAccent({ mine: true, author_index: 2 })).toBe('mine');
    });

    it('keys everyone else off the slot the server assigned', () => {
        expect(authorAccent({ mine: false, author_index: 0 })).toBe(1);
        expect(authorAccent({ mine: false, author_index: 2 })).toBe(3);
    });

    it('gives each half of a shared column its own slot', () => {
        expect(authorAccent({ mine: false, author_index: 1 })).not.toBe(
            authorAccent({ mine: false, author_index: 2 }),
        );
    });

    it('wraps around once the roster outgrows the palette', () => {
        expect(authorAccent({ mine: false, author_index: 5 })).toBe(1);
    });

    it('returns null for an author the server could not place', () => {
        expect(authorAccent({ mine: false, author_index: null })).toBe(null);
    });
});

// ---------------------------------------------------------------------------
// isFullyWatched
// ---------------------------------------------------------------------------

describe('isFullyWatched', () => {
    it('is true when every user has watched', () => {
        expect(isFullyWatched({ watched_by: ['a', 'b'] }, 2)).toBe(true);
    });

    it('is false when some users have not watched', () => {
        expect(isFullyWatched({ watched_by: ['a'] }, 2)).toBe(false);
    });

    it('is false when nobody has watched', () => {
        expect(isFullyWatched({ watched_by: [] }, 2)).toBe(false);
    });

    it('is false when there are no users', () => {
        expect(isFullyWatched({ watched_by: [] }, 0)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// sortSeasons
// ---------------------------------------------------------------------------

describe('sortSeasons', () => {
    const seasons = [
        { id: 10, show_id: 2, number: 14, watched_by: [] },
        { id: 11, show_id: 1, number: 2, watched_by: ['a'] },
        { id: 12, show_id: 1, number: 1, watched_by: ['a', 'b'] }, // fully watched
        { id: 13, show_id: 3, number: 1, watched_by: [] },
        { id: 14, show_id: 2, number: 3, watched_by: [] },
    ];

    it('orders by show name case-insensitively, then number, sinking fully watched', () => {
        expect(sortSeasons(seasons, 2, shows).map((s) => s.id)).toEqual([13, 11, 14, 10, 12]);
    });
    it('does not mutate the input', () => {
        const copy = [...seasons];
        sortSeasons(seasons, 2, shows);
        expect(seasons).toEqual(copy);
    });
    it('sinks nothing when there are no users', () => {
        expect(sortSeasons(seasons, 0, shows).map((s) => s.id)).toEqual([13, 12, 11, 14, 10]);
    });
});

// ---------------------------------------------------------------------------
// sortBySeenCount
// ---------------------------------------------------------------------------

describe('sortBySeenCount', () => {
    const seasons = [
        { id: 10, show_id: 2, number: 14, watched_by: ['a'] },
        { id: 11, show_id: 1, number: 2, watched_by: ['a'] },
        { id: 12, show_id: 1, number: 1, watched_by: ['a', 'b'] }, // fully watched
        { id: 13, show_id: 3, number: 1, watched_by: [] },
    ];
    it('orders by watcher count, then show, then number, sinking fully watched', () => {
        expect(sortBySeenCount(seasons, 2, shows).map((s) => s.id)).toEqual([13, 11, 10, 12]);
    });
});

// ---------------------------------------------------------------------------
// filterByShow
// ---------------------------------------------------------------------------

describe('filterByShow', () => {
    const seasons = [
        { id: 1, show_id: 1 },
        { id: 2, show_id: 2 },
    ];
    it('returns everything for null', () => {
        expect(filterByShow(seasons, null)).toBe(seasons);
    });
    it("keeps only that show's seasons", () => {
        expect(filterByShow(seasons, 2).map((s) => s.id)).toEqual([2]);
    });
});

// ---------------------------------------------------------------------------
// collapseShows
// ---------------------------------------------------------------------------

describe('collapseShows', () => {
    const seasons = [
        { id: 10, show_id: 2, number: 14, watched_by: ['a', 'b'] },
        { id: 11, show_id: 1, number: 1, watched_by: ['a', 'b'] },
        { id: 12, show_id: 1, number: 2, watched_by: ['b'] },
        { id: 13, show_id: 1, number: 3, watched_by: ['b', 'a'] },
    ];

    it('leaves a single-season show as its season', () => {
        expect(collapseShows(seasons).find((e) => e.show_id === 2)).toBe(seasons[0]);
    });
    it('folds a multi-season show into one group, keeping season order', () => {
        const group = collapseShows(seasons).find((e) => e.show_id === 1);
        expect(group.group).toBe(true);
        expect(group.seasons.map((s) => s.id)).toEqual([11, 12, 13]);
    });
    it('counts as watched by only the users who watched every season', () => {
        const group = collapseShows(seasons).find((e) => e.show_id === 1);
        expect(group.watched_by).toEqual(['b']);
    });
    it('sorts alongside seasons, sinking a fully watched show', () => {
        const done = seasons.map((s) => ({ ...s, watched_by: ['a', 'b'] }));
        const sorted = sortSeasons(
            collapseShows([...done.slice(1), { id: 14, show_id: 3, number: 1, watched_by: [] }]),
            2,
            shows,
        );
        expect(sorted.map((e) => (e.group ? `show-${e.show_id}` : e.id))).toEqual([14, 'show-1']);
    });
});

// ---------------------------------------------------------------------------
// resolveShowFilter
// ---------------------------------------------------------------------------

describe('resolveShowFilter', () => {
    it('accepts a saved id of an existing show, as a string', () => {
        expect(resolveShowFilter('2', shows)).toBe(2);
    });
    it.each([null, undefined, '', 'abc', '99', '1.5'])('falls back to all for %j', (saved) => {
        expect(resolveShowFilter(saved, shows)).toBe(null);
    });
});

// ---------------------------------------------------------------------------
// selectableSeasons
// ---------------------------------------------------------------------------

describe('selectableSeasons', () => {
    const seasons = [
        { id: 1, show_id: 1, watched_by: ['me'] },
        { id: 2, show_id: 1, watched_by: ['other'] },
        { id: 3, show_id: 2, watched_by: [] },
    ];
    it("offers only this show's seasons the user hasn't watched", () => {
        expect(selectableSeasons(seasons, 'me', 1).map((s) => s.id)).toEqual([2]);
    });
});

// ---------------------------------------------------------------------------
// setWatched
// ---------------------------------------------------------------------------

describe('setWatched', () => {
    it('adds the user when marking watched', () => {
        expect(setWatched(['other'], 'me', true)).toEqual(['other', 'me']);
    });

    it('does not duplicate a user who is already present', () => {
        expect(setWatched(['me', 'other'], 'me', true)).toEqual(['other', 'me']);
    });

    it('removes the user when unmarking', () => {
        expect(setWatched(['me', 'other'], 'me', false)).toEqual(['other']);
    });

    it('is a no-op removal when the user is absent', () => {
        expect(setWatched(['other'], 'me', false)).toEqual(['other']);
    });

    it('does not mutate the input', () => {
        const watchedBy = ['me', 'other'];
        setWatched(watchedBy, 'me', false);
        expect(watchedBy).toEqual(['me', 'other']);
    });
});

// ---------------------------------------------------------------------------
// clearsCurrentlyWatching
// ---------------------------------------------------------------------------

describe('clearsCurrentlyWatching', () => {
    const me = { id: 'me', currently_watching: { 1: 7, 2: 9 } };
    it("is true when checking the season that is this show's pick", () => {
        expect(clearsCurrentlyWatching(me, { id: 7, show_id: 1 }, true)).toBe(true);
    });
    it('is false when unchecking', () => {
        expect(clearsCurrentlyWatching(me, { id: 7, show_id: 1 }, false)).toBe(false);
    });
    it("is false for a season that is not the show's pick", () => {
        expect(clearsCurrentlyWatching(me, { id: 8, show_id: 1 }, true)).toBe(false);
    });
    it('is false with no me', () => {
        expect(clearsCurrentlyWatching(undefined, { id: 7, show_id: 1 }, true)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// quoteSnippet
// ---------------------------------------------------------------------------

describe('quoteSnippet', () => {
    it('leaves a short single-line body alone', () => {
        expect(quoteSnippet('short note')).toBe('short note');
    });

    it('collapses newlines and runs of whitespace to single spaces', () => {
        expect(quoteSnippet('first line\n\nsecond   line')).toBe('first line second line');
    });

    it('trims surrounding whitespace', () => {
        expect(quoteSnippet('  padded  ')).toBe('padded');
    });

    it('truncates a long body with an ellipsis', () => {
        const snippet = quoteSnippet('x'.repeat(200));
        expect(snippet).toHaveLength(61);
        expect(snippet.endsWith('…')).toBe(true);
    });

    it('does not add an ellipsis at exactly the limit', () => {
        expect(quoteSnippet('x'.repeat(60))).toBe('x'.repeat(60));
    });
});

// ---------------------------------------------------------------------------
// bodyAfterPost
// ---------------------------------------------------------------------------

describe('bodyAfterPost', () => {
    it('clears the box when it still holds what was posted', () => {
        expect(bodyAfterPost('a thought', 'a thought')).toBe('');
    });

    it('clears a note posted with surrounding whitespace', () => {
        // The regression this exists for: the body goes out trimmed, but the box
        // holds the raw text, and a phone's predictive keyboard puts a space
        // after every accepted word. Comparing the box against the trimmed text
        // never matched, so the note stayed in the box after it posted.
        expect(bodyAfterPost('a thought ', 'a thought ')).toBe('');
    });

    it('keeps text typed on top of the note while it was in flight', () => {
        expect(bodyAfterPost('a thought and more', 'a thought')).toBe('a thought and more');
    });
});

// ---------------------------------------------------------------------------
// replyTargetGone
// ---------------------------------------------------------------------------

describe('replyTargetGone', () => {
    it('reads a 404 on a reply as a parent that is gone for good', () => {
        expect(replyTargetGone(12, { status: 404 })).toBe(true);
    });

    it('leaves an ordinary note alone, since it has no chip to drop', () => {
        expect(replyTargetGone(null, { status: 404 })).toBe(false);
    });

    it('keeps the chip through a failure the next attempt could survive', () => {
        // A 500 or a dropped connection says nothing about the parent, and the
        // reply is still worth sending as a reply.
        expect(replyTargetGone(12, { status: 500 })).toBe(false);
        expect(replyTargetGone(12, new Error('Load failed'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// formatAdjust
// ---------------------------------------------------------------------------

describe('formatAdjust', () => {
    it('shows no correction as a plus-minus zero', () => {
        expect(formatAdjust(0)).toBe('±0:00');
    });

    it('signs a forward correction', () => {
        expect(formatAdjust(45)).toBe('+0:45');
        expect(formatAdjust(75)).toBe('+1:15');
    });

    // U+2212, matching the −1m / −15s buttons rather than a hyphen.
    it('signs a backward correction with a real minus', () => {
        expect(formatAdjust(-45)).toBe('−0:45');
    });
});

// ---------------------------------------------------------------------------
// clampAdjust
// ---------------------------------------------------------------------------

describe('clampAdjust', () => {
    it('adds the delta to the current total', () => {
        expect(clampAdjust(0, 15, 3600)).toBe(15);
        expect(clampAdjust(15, 15, 3600)).toBe(30);
    });

    it('accumulates a run of taps against its own result, not a fixed base', () => {
        // The regression this exists for: two rapid nudges must land on 30, not
        // both compute 0 + 15 against a total that hasn't round-tripped to the
        // server yet.
        let pending = 0;
        pending = clampAdjust(pending, 15, 3600);
        pending = clampAdjust(pending, 15, 3600);
        expect(pending).toBe(30);
    });

    it('clamps at the positive limit', () => {
        expect(clampAdjust(3590, 15, 3600)).toBe(3600);
    });

    it('clamps at the negative limit', () => {
        expect(clampAdjust(-3590, -15, 3600)).toBe(-3600);
    });

    it('is a no-op once already at the limit', () => {
        expect(clampAdjust(3600, 15, 3600)).toBe(3600);
    });
});

// ---------------------------------------------------------------------------
// settledAdjust
// ---------------------------------------------------------------------------

describe('settledAdjust', () => {
    it('keeps the optimistic value once the newest request succeeds', () => {
        expect(settledAdjust(true, true, 30, 0)).toBe(30);
    });

    it('reverts to the last known-good value when the newest request fails', () => {
        // The regression this exists for: a failed PUT leaves the server's
        // adjust_secs unchanged, so nothing else notices and undoes the
        // optimistic update — this is the decision that does.
        expect(settledAdjust(true, false, 30, 0)).toBe(0);
    });

    it('ignores a stale failure once a newer request has already settled', () => {
        // The regression this one exists for: two overlapping taps resolve out
        // of order, and an older failure landing after a newer success must not
        // stomp the confirmed result back down.
        expect(settledAdjust(false, false, 30, 0)).toBeUndefined();
    });

    it('ignores a stale success once a newer request has already settled', () => {
        expect(settledAdjust(false, true, 30, 0)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// relativeTime
// ---------------------------------------------------------------------------

describe('relativeTime', () => {
    const now = Date.parse('2026-08-02T12:00:00.000Z');
    const ago = (secs) => new Date(now - secs * 1000).toISOString();

    it('calls the present moment just now', () => {
        expect(relativeTime(ago(0), now)).toBe('just now');
    });

    it('still says just now at five minutes exactly', () => {
        expect(relativeTime(ago(300), now)).toBe('just now');
    });

    it('starts counting minutes just past five', () => {
        expect(relativeTime(ago(301), now)).toBe('5 minutes ago');
    });

    it('counts minutes up to the hour', () => {
        expect(relativeTime(ago(59 * 60), now)).toBe('59 minutes ago');
    });

    it('switches to hours at sixty minutes', () => {
        expect(relativeTime(ago(60 * 60), now)).toBe('1 hour ago');
    });

    it('truncates towards zero rather than rounding', () => {
        expect(relativeTime(ago(119 * 60), now)).toBe('1 hour ago');
    });

    it('pluralises hours', () => {
        expect(relativeTime(ago(3 * 60 * 60), now)).toBe('3 hours ago');
    });

    it('counts hours up to the day', () => {
        expect(relativeTime(ago(23 * 60 * 60 + 59 * 60), now)).toBe('23 hours ago');
    });

    it('switches to days at twenty-four hours', () => {
        expect(relativeTime(ago(24 * 60 * 60), now)).toBe('1 day ago');
    });

    it('pluralises days', () => {
        expect(relativeTime(ago(3 * 24 * 60 * 60), now)).toBe('3 days ago');
    });

    // A device clock running fast would otherwise produce "in 3 hours".
    it('clamps a future stamp to just now', () => {
        expect(relativeTime(new Date(now + 60 * 60 * 1000).toISOString(), now)).toBe('just now');
    });
});

// ---------------------------------------------------------------------------
// nextSeasonNumber
// ---------------------------------------------------------------------------

describe('nextSeasonNumber', () => {
    const seasons = [
        { show_id: 1, number: 1 },
        { show_id: 1, number: 4 },
        { show_id: 2, number: 14 },
    ];
    it("is one past the show's highest", () => {
        expect(nextSeasonNumber(seasons, 1)).toBe(5);
    });
    it('is 1 for a show with no seasons', () => {
        expect(nextSeasonNumber(seasons, 3)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// feedLine
// ---------------------------------------------------------------------------

describe('feedLine', () => {
    it('names the show, season number, and episode', () => {
        expect(
            feedLine({ author_name: 'Carol', show_name: 'Lanterns', season_number: 1, episode: 3 }),
        ).toBe('Carol commented on Lanterns Season 1 Episode 3');
    });
});

// ---------------------------------------------------------------------------
// linkLabel
// ---------------------------------------------------------------------------

describe('linkLabel', () => {
    it('names Wikipedia', () => {
        expect(linkLabel('https://en.wikipedia.org/wiki/Lanterns_(TV_series)')).toBe('Wikipedia ↗');
    });
    it('is generic for anything else', () => {
        expect(linkLabel('https://example.com')).toBe('Link ↗');
    });
});

// ---------------------------------------------------------------------------
// parseHashRoute
// ---------------------------------------------------------------------------

describe('parseHashRoute', () => {
    it('reads a season', () => {
        expect(parseHashRoute('#/season/45')).toEqual({ seasonId: 45, episode: null });
    });

    it('reads a season and an episode', () => {
        expect(parseHashRoute('#/season/45/episode/3')).toEqual({ seasonId: 45, episode: 3 });
    });

    it('falls back to the board for an empty hash', () => {
        expect(parseHashRoute('')).toEqual({ seasonId: null, episode: null });
    });

    it('falls back to the board for an unrelated hash', () => {
        expect(parseHashRoute('#/settings')).toEqual({ seasonId: null, episode: null });
    });

    // Season 0 and episode 0 do not exist. Matching them would mount the view
    // and surface the API's raw validation error instead of showing the board.
    it('rejects a zero season', () => {
        expect(parseHashRoute('#/season/0')).toEqual({ seasonId: null, episode: null });
    });

    it('rejects a zero episode', () => {
        expect(parseHashRoute('#/season/45/episode/0')).toEqual({ seasonId: null, episode: null });
    });

    it('rejects a leading zero', () => {
        expect(parseHashRoute('#/season/045')).toEqual({ seasonId: null, episode: null });
    });

    it('rejects trailing junk', () => {
        expect(parseHashRoute('#/season/45/episode/3/x')).toEqual({
            seasonId: null,
            episode: null,
        });
    });
});

// ---------------------------------------------------------------------------
// shouldScrollToEpisode
// ---------------------------------------------------------------------------

describe('shouldScrollToEpisode', () => {
    // The arrival state: the discussion has loaded, the board named by the
    // route is the open one, and this route episode has not been jumped to yet.
    const arrived = { routeEpisode: 3, openEpisode: 3, ready: true, scrolled: null };

    it('jumps on arrival', () => {
        expect(shouldScrollToEpisode(arrived)).toBe(true);
    });

    it('does not jump when the route names no episode', () => {
        expect(shouldScrollToEpisode({ ...arrived, routeEpisode: null, openEpisode: null })).toBe(
            false,
        );
    });

    // The bug this function exists for: `data` and `loading` settle in two
    // separate renders, and the episode cards only exist after the second, so a
    // check that reads "the response arrived" fires against a DOM that still
    // holds nothing but "Loading…" — and nothing re-runs it afterwards.
    it('does not jump while the view is still loading', () => {
        expect(shouldScrollToEpisode({ ...arrived, ready: false })).toBe(false);
    });

    // The other half: the effect that opens the board and the one that jumps to
    // it run in the same commit, so the jump would measure a layout in which the
    // previously open board is still expanded and this one is still collapsed.
    it('waits for the open board to catch up with the route', () => {
        expect(shouldScrollToEpisode({ ...arrived, openEpisode: 8 })).toBe(false);
    });

    it('does not jump twice for the same route episode', () => {
        expect(shouldScrollToEpisode({ ...arrived, scrolled: 3 })).toBe(false);
    });

    it('jumps again when the route names a different episode', () => {
        expect(shouldScrollToEpisode({ ...arrived, scrolled: 8 })).toBe(true);
    });
});

describe('skipLabel', () => {
    const alice = { user_id: 'user-alice', name: 'Alice', status: 'skipping' };
    const bob = { user_id: 'user-bob', name: 'Bob & Carol', status: 'skipping' };

    it('is empty when nobody is skipping', () => {
        expect(skipLabel([], 'user-alice')).toBe('');
    });

    it('is empty when statuses is missing', () => {
        expect(skipLabel(undefined, 'user-alice')).toBe('');
    });

    it('names the caller as You', () => {
        expect(skipLabel([{ ...alice, reason: 'recap' }], 'user-alice')).toBe('Skipped recap: You');
    });

    it('collapses to one reason when everyone agrees', () => {
        expect(
            skipLabel(
                [
                    { ...alice, reason: 'recap' },
                    { ...bob, reason: 'recap' },
                ],
                'user-alice',
            ),
        ).toBe('Skipped recap: You, Bob & Carol');
    });

    // The rarer branch, and so the one most likely to rot unnoticed.
    it('names a reason per person when they disagree', () => {
        expect(
            skipLabel(
                [
                    { ...alice, reason: 'recap' },
                    { ...bob, reason: 'reunion' },
                ],
                'user-alice',
            ),
        ).toBe('Skipped: You (recap), Bob & Carol (reunion)');
    });

    it('puts the caller first regardless of roster order', () => {
        expect(
            skipLabel(
                [
                    { ...bob, reason: 'recap' },
                    { ...alice, reason: 'recap' },
                ],
                'user-alice',
            ),
        ).toBe('Skipped recap: You, Bob & Carol');
    });

    it('uses names when the caller is not skipping', () => {
        expect(skipLabel([{ ...bob, reason: 'reunion' }], 'user-alice')).toBe(
            'Skipped reunion: Bob & Carol',
        );
    });

    // A reader who is not on the roster has no id to match, and every name stands.
    it('handles a null caller id', () => {
        expect(skipLabel([{ ...bob, reason: 'recap' }], null)).toBe('Skipped recap: Bob & Carol');
    });
});
