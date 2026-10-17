import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { api } from './api.js';
import { useSubmitGuard } from './hooks.js';
import { nextSeasonNumber, seasonsOfShow, moveTarget, episodeNumbers } from './utils.js';

const html = htm.bind(h);

const NEW_SHOW = 'new';

const jsonRequest = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

// Adds a season, creating its show first when "New show…" is picked. Not
// optimistic: the new rows need the server's ids, so success refetches the
// board through onDone(showId) — the id lets the board switch its show filter
// onto the show the season just landed in, so an active filter on a different
// show doesn't hide the row that was just added.
//
// Creating the show and the season are two requests. If the second fails, the
// show already exists, so the picker switches to it and the board refetches
// (onChanged): retrying then adds the season to that show instead of 409ing on
// the name.
export function AddSeasonForm({ shows, seasons, defaultShowId, onDone, onChanged, onCancel }) {
    const initialShow = defaultShowId ?? shows[0]?.id ?? NEW_SHOW;
    const [showChoice, setShowChoice] = useState(initialShow);
    const [showName, setShowName] = useState('');
    const [showUrl, setShowUrl] = useState('');
    const [number, setNumber] = useState(
        String(initialShow === NEW_SHOW ? 1 : nextSeasonNumber(seasons, initialShow)),
    );
    const [episodeCount, setEpisodeCount] = useState('');
    const [subtitle, setSubtitle] = useState('');
    const [url, setUrl] = useState('');
    const [error, setError] = useState(null);
    const { busy, run, canCancel } = useSubmitGuard();

    const pickShow = (value) => {
        const choice = value === NEW_SHOW ? NEW_SHOW : Number(value);
        setShowChoice(choice);
        setNumber(String(choice === NEW_SHOW ? 1 : nextSeasonNumber(seasons, choice)));
    };

    const submit = (e) => {
        e.preventDefault();
        // The guard's text is only its "is there anything to send" check; the
        // season number is the one field that is always required.
        run(number, async () => {
            setError(null);
            try {
                let showId = showChoice;
                if (showChoice === NEW_SHOW) {
                    const { show } = await api(
                        '/api/shows',
                        jsonRequest('POST', { name: showName, url: showUrl }),
                    );
                    showId = show.id;
                    setShowChoice(show.id);
                    onChanged();
                }
                await api(
                    `/api/shows/${showId}/seasons`,
                    jsonRequest('POST', {
                        number: Number(number),
                        episode_count: Number(episodeCount),
                        subtitle,
                        url,
                    }),
                );
                onDone(showId);
            } catch (err) {
                setError(err.message);
            }
        });
    };

    return html`
        <form class="manage-form" onSubmit=${submit}>
            <h3 class="manage-title">Add a season</h3>
            ${error && html`<div class="error">${error}</div>`}
            <label class="manage-field">
                <span>Show</span>
                <select value=${showChoice} onChange=${(e) => pickShow(e.target.value)}>
                    ${shows.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}
                    <option value=${NEW_SHOW}>New show…</option>
                </select>
            </label>
            ${
                showChoice === NEW_SHOW &&
                html`
                    <label class="manage-field">
                        <span>Show name</span>
                        <input
                            required
                            maxlength="100"
                            value=${showName}
                            onInput=${(e) => setShowName(e.target.value)}
                        />
                    </label>
                    <label class="manage-field">
                        <span>Show link (optional)</span>
                        <input
                            type="url"
                            maxlength="500"
                            placeholder="https://en.wikipedia.org/wiki/…"
                            value=${showUrl}
                            onInput=${(e) => setShowUrl(e.target.value)}
                        />
                    </label>
                `
            }
            <div class="manage-row">
                <label class="manage-field">
                    <span>Season</span>
                    <input
                        type="number"
                        required
                        min="1"
                        max="999"
                        value=${number}
                        onInput=${(e) => setNumber(e.target.value)}
                    />
                </label>
                <label class="manage-field">
                    <span>Episodes</span>
                    <input
                        type="number"
                        required
                        min="1"
                        max="50"
                        value=${episodeCount}
                        onInput=${(e) => setEpisodeCount(e.target.value)}
                    />
                </label>
            </div>
            <label class="manage-field">
                <span>Subtitle (optional)</span>
                <input
                    maxlength="100"
                    value=${subtitle}
                    onInput=${(e) => setSubtitle(e.target.value)}
                />
            </label>
            <label class="manage-field">
                <span>Season link (optional)</span>
                <input
                    type="url"
                    maxlength="500"
                    value=${url}
                    onInput=${(e) => setUrl(e.target.value)}
                />
            </label>
            <div class="manage-actions">
                <button type="submit" class="sort-btn active" disabled=${busy}>
                    ${busy ? 'Adding…' : 'Add season'}
                </button>
                <button
                    type="button"
                    class="sort-btn"
                    disabled=${busy}
                    onClick=${() => canCancel() && onCancel()}
                >
                    Cancel
                </button>
            </div>
        </form>
    `;
}

// Edits a season and its show together, since the season view is the one place
// both are on screen. Sends only what changed, show first: a rename that 409s
// then leaves the season untouched rather than half-saved.
export function EditSeasonForm({ season, onSaved, onChanged, onCancel }) {
    const [showName, setShowName] = useState(season.show.name);
    const [showUrl, setShowUrl] = useState(season.show.url);
    const [subtitle, setSubtitle] = useState(season.subtitle);
    const [url, setUrl] = useState(season.url);
    const [episodeCount, setEpisodeCount] = useState(String(season.episode_count));
    const [error, setError] = useState(null);
    const { busy, run, canCancel } = useSubmitGuard();

    const submit = (e) => {
        e.preventDefault();
        run(episodeCount, async () => {
            setError(null);
            const showChanges = {};
            if (showName.trim() !== season.show.name) showChanges.name = showName;
            if (showUrl.trim() !== season.show.url) showChanges.url = showUrl;
            const seasonChanges = {};
            if (subtitle.trim() !== season.subtitle) seasonChanges.subtitle = subtitle;
            if (url.trim() !== season.url) seasonChanges.url = url;
            if (Number(episodeCount) !== season.episode_count) {
                seasonChanges.episode_count = Number(episodeCount);
            }
            // Tracked separately from seasonChanges failing: the show PATCH can
            // land and then the season PATCH 409 (e.g. the episode-count
            // shrink guard), which needs both a different error message and a
            // refresh — the header is still showing the pre-save show name
            // until one happens — while the form itself stays open.
            let showSaved = false;
            try {
                if (Object.keys(showChanges).length) {
                    await api(`/api/shows/${season.show.id}`, jsonRequest('PATCH', showChanges));
                    showSaved = true;
                }
                if (Object.keys(seasonChanges).length) {
                    await api(`/api/seasons/${season.id}`, jsonRequest('PATCH', seasonChanges));
                }
                await onSaved();
            } catch (err) {
                if (showSaved) {
                    setError(`Saved the show, but not the season: ${err.message}`);
                    // Best-effort: the error banner above already reflects
                    // reality, and the next focus refresh retries.
                    await onChanged().catch(() => {});
                } else {
                    setError(err.message);
                }
            }
        });
    };

    return html`
        <form class="manage-form" onSubmit=${submit}>
            <h3 class="manage-title">Edit season</h3>
            ${error && html`<div class="error">${error}</div>`}
            <label class="manage-field">
                <span>Show name</span>
                <input
                    required
                    maxlength="100"
                    value=${showName}
                    onInput=${(e) => setShowName(e.target.value)}
                />
            </label>
            <label class="manage-field">
                <span>Show link</span>
                <input
                    type="url"
                    maxlength="500"
                    value=${showUrl}
                    onInput=${(e) => setShowUrl(e.target.value)}
                />
            </label>
            <div class="manage-row">
                <label class="manage-field">
                    <span>Subtitle</span>
                    <input
                        maxlength="100"
                        value=${subtitle}
                        onInput=${(e) => setSubtitle(e.target.value)}
                    />
                </label>
                <label class="manage-field">
                    <span>Episodes</span>
                    <input
                        type="number"
                        required
                        min="1"
                        max="50"
                        value=${episodeCount}
                        onInput=${(e) => setEpisodeCount(e.target.value)}
                    />
                </label>
            </div>
            <label class="manage-field">
                <span>Season link</span>
                <input
                    type="url"
                    maxlength="500"
                    value=${url}
                    onInput=${(e) => setUrl(e.target.value)}
                />
            </label>
            <div class="manage-actions">
                <button type="submit" class="sort-btn active" disabled=${busy}>
                    ${busy ? 'Saving…' : 'Save'}
                </button>
                <button
                    type="button"
                    class="sort-btn"
                    disabled=${busy}
                    onClick=${() => canCancel() && onCancel()}
                >
                    Cancel
                </button>
            </div>
        </form>
    `;
}

// Moves the caller's own notes on one episode to another — the repair for notes
// posted on the wrong episode, season, or show. A native modal <dialog>, the
// app's only one: showModal() brings the focus trap, Escape, and the backdrop
// with it, and a move is a decision to make with the board held still behind
// it rather than a menu to dismiss in passing.
//
// Not optimistic, like the forms above: the server decides which notes are the
// caller's and folds each episode's timer correction into the moved offsets, so
// success refetches the view (onMoved) rather than guessing. The pickers start
// on the episode the notes are already on, and Move stays disabled until the
// target differs. Shows and seasons come from /api/board, fetched on open — a
// target that does not exist yet has to be added from the board first.
export function MoveNotesDialog({ season, episode, count, onMoved, onCancel }) {
    const dialogRef = useRef(null);
    const [seasons, setSeasons] = useState(null);
    const [shows, setShows] = useState(null);
    const [target, setTarget] = useState({
        showId: season.show.id,
        seasonId: season.id,
        episode,
    });
    const [error, setError] = useState(null);
    const { busy, run, canCancel } = useSubmitGuard();

    useEffect(() => {
        dialogRef.current?.showModal();
        api('/api/board')
            .then((board) => {
                setShows(board.shows);
                setSeasons(board.seasons);
            })
            .catch((err) => setError(err.message));
    }, []);

    // Escape fires `cancel` before the dialog closes itself; the dialog's
    // lifetime belongs to the parent's state, so it is refused here and handed
    // to onCancel — which is also refused while a move is in flight.
    const dismiss = (e) => {
        e?.preventDefault();
        if (canCancel()) onCancel();
    };
    // A browser may close the dialog without a cancelable `cancel` — Chrome
    // does on a second Escape with no user activation in between — which would
    // leave it closed while the parent still has it mounted, and the Move
    // comments button, already `moving`, could not reopen it. Mirror that close
    // into the parent's state, or reopen it while a move is in flight.
    const closed = () => {
        if (canCancel()) onCancel();
        else dialogRef.current?.showModal();
    };
    // A backdrop click is one that both starts and ends on the dialog itself: a
    // drag from inside the form released over the backdrop also targets the
    // dialog, as the nearest common ancestor, and must not dismiss.
    const pressedRef = useRef(null);

    const pick = (change) => setTarget((cur) => moveTarget(seasons, { ...cur, ...change }));
    const unchanged = target.seasonId === season.id && target.episode === episode;
    const targetSeason = seasons?.find((s) => s.id === target.seasonId);
    const note =
        `Moves the ${count} ${count === 1 ? 'note' : 'notes'} you wrote on Episode ${episode}, ` +
        "keeping their times. Everyone else's stay put.";

    const submit = (e) => {
        e.preventDefault();
        if (unchanged) return;
        run('move', async () => {
            setError(null);
            try {
                await api(
                    `/api/seasons/${season.id}/episodes/${episode}/posts/move`,
                    jsonRequest('POST', {
                        to_season_id: target.seasonId,
                        to_episode: target.episode,
                    }),
                );
                await onMoved();
            } catch (err) {
                setError(err.message);
            }
        });
    };

    return html`
        <dialog
            ref=${dialogRef}
            class="move-dialog"
            aria-labelledby="move-dialog-title"
            onCancel=${dismiss}
            onClose=${closed}
            onPointerDown=${(e) => (pressedRef.current = e.target)}
            onClick=${(e) =>
                e.target === dialogRef.current && pressedRef.current === e.target && dismiss()}
        >
            <form class="manage-form" onSubmit=${submit}>
                <h3 class="manage-title" id="move-dialog-title">Move comments</h3>
                <p class="move-dialog-note">${note}</p>
                ${error && html`<div class="error">${error}</div>`}
                ${
                    seasons
                        ? html`
                              <label class="manage-field">
                                  <span>Show</span>
                                  <select
                                      value=${target.showId}
                                      onChange=${(e) => pick({ showId: Number(e.target.value) })}
                                  >
                                      ${shows
                                          .filter((s) => seasons.some((x) => x.show_id === s.id))
                                          .map(
                                              (s) =>
                                                  html`<option key=${s.id} value=${s.id}>
                                                      ${s.name}
                                                  </option>`,
                                          )}
                                  </select>
                              </label>
                              <div class="manage-row">
                                  <label class="manage-field">
                                      <span>Season</span>
                                      <select
                                          value=${target.seasonId}
                                          onChange=${(e) =>
                                              pick({ seasonId: Number(e.target.value) })}
                                      >
                                          ${seasonsOfShow(seasons, target.showId).map(
                                              (s) =>
                                                  html`<option key=${s.id} value=${s.id}>
                                                      ${s.number}${s.subtitle ? `: ${s.subtitle}` : ''}
                                                  </option>`,
                                          )}
                                      </select>
                                  </label>
                                  <label class="manage-field">
                                      <span>Episode</span>
                                      <select
                                          value=${target.episode}
                                          onChange=${(e) =>
                                              pick({ episode: Number(e.target.value) })}
                                      >
                                          ${episodeNumbers(targetSeason?.episode_count).map(
                                              (n) =>
                                                  html`<option key=${n} value=${n}>${n}</option>`,
                                          )}
                                      </select>
                                  </label>
                              </div>
                          `
                        : !error && html`<div class="loading">Loading…</div>`
                }
                <div class="manage-actions">
                    <button
                        type="submit"
                        class="sort-btn active"
                        disabled=${busy || !seasons || unchanged}
                    >
                        ${busy ? 'Moving…' : 'Move'}
                    </button>
                    <button
                        type="button"
                        class="sort-btn"
                        disabled=${busy}
                        onClick=${() => dismiss()}
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </dialog>
    `;
}
