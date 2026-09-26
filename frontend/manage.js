import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { api } from './api.js';
import { useSubmitGuard } from './hooks.js';
import { nextSeasonNumber } from './utils.js';

const html = htm.bind(h);

const NEW_SHOW = 'new';

const jsonRequest = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

// Adds a season, creating its show first when "New show…" is picked. Not
// optimistic: the new rows need the server's ids, so success refetches the
// board through onDone.
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
                onDone();
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
                    await onChanged();
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
