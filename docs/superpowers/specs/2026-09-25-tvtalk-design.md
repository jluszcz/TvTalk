# TV Talk — Design

## Intent

TV Talk is Outwatch (`../Outwatch`) for arbitrary TV instead of _Survivor_: a small
group's shared board of which seasons each column (a person or a couple) has watched,
plus per-episode spoiler-safe discussion with watch timers, reveals, replies, reactions,
episode statuses, and the activity feed. Everything Outwatch does carries over with the
same rules; what changes is that a "season" is the combination of a **show** and a
**season number**, with its own episode count, and that roster members can add and edit
shows and seasons themselves. The board gets a show filter.

Initial content: _The Great British Bake Off_ Season 14 and _Lanterns_ Season 1.

## Decisions

| Topic                | Decision                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Name                 | "TV Talk" (page title, manifest, home-screen title); package/worker/D1 name `tvtalk`      |
| Header               | "No Spoilies!"                                                                            |
| Icon                 | Supplied by the user as `assets/icon-source.png`; icon set generated with `sips` as in Outwatch's README |
| Season terminology   | Always "Season N" (no per-show "Series")                                                  |
| Currently watching   | One per (column, show)                                                                    |
| Add / edit           | Any roster member can add and edit shows and seasons; nothing is deletable from the UI    |
| Board filter         | Single-select show dropdown; flat list                                                    |
| Data model           | Surrogate integer `seasons.id`; every episode-scoped table stays keyed on `season_id`     |
| Repo                 | Fresh copy of Outwatch's current tree (no history); migrations collapsed into one schema  |

## Schema

`migrations/0001_initial.sql` is Outwatch's final schema (through its migration 0011)
with these changes:

```sql
CREATE TABLE shows (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
    url        TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE seasons (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id       INTEGER NOT NULL REFERENCES shows (id),
    number        INTEGER NOT NULL,
    subtitle      TEXT NOT NULL DEFAULT '',
    url           TEXT NOT NULL DEFAULT '',
    episode_count INTEGER NOT NULL,
    created_at    TEXT NOT NULL,
    UNIQUE (show_id, number)
);

CREATE TABLE currently_watching (
    user_id   TEXT    NOT NULL REFERENCES users (id),
    show_id   INTEGER NOT NULL REFERENCES shows (id),
    season_id INTEGER NOT NULL REFERENCES seasons (id),
    PRIMARY KEY (user_id, show_id)
);
```

- `url` of `''` means no link. It replaces Outwatch's `wikipedia_url`.
- `users` loses `currently_watching_season_id`.
- Unchanged from Outwatch: `users`, `user_emails` (email `COLLATE NOCASE`, `name`,
  `feed_seen_at`), `watched`, `posts` (`author_email`, `reply_to_post_id`, `edited_at`,
  `offset_secs`), `reactions`, `reveals`, `watch_sessions`, `watch_offsets`,
  `episode_statuses`, and all their indexes.

`migrations/0002_seed.sql` inserts the two shows and their seasons. The episode counts
and Wikipedia links are verified at implementation time; Bake Off Season 14 has 10
episodes.

Invariants:

- `currently_watching.season_id` belongs to `currently_watching.show_id`, and the column
  has not watched it. The route enforces both in one conditional statement, so a
  concurrent `POST /api/watched` cannot interleave, as Outwatch does today.
- Marking a season watched deletes the column's `currently_watching` row for that show
  if it points at that season.
- A season's `episode_count` is never lower than the highest episode referenced by any
  `posts`, `episode_statuses`, `reveals`, `watch_sessions`, or `watch_offsets` row for
  that season.

## API

All mutations require roster membership (403 otherwise) and validate with
`zValidator` + zod, as the existing routes do.

### Changed

- `GET /api/board`
    - Adds `shows: [{ id, name, url }]`, ordered by name.
    - Each season is `{ id, show_id, number, subtitle, url, episode_count, post_count, watched_by }`.
    - Each user is `{ id, name, currently_watching: { [show_id]: season_id } }`.
- `PUT /api/currently-watching` takes `{ show_id, season_id | null }`.
    - An unknown show or season is a 404, a season that is not in that show is a 400,
      and a season the caller's column has already watched is a 409.
    - `null` clears the pick for that show.
- `POST /api/watched` clears the matching `currently_watching` row for the season's
  show, in the same `DB.batch` as the insert.
- `GET /api/seasons/:season_id/discussion`: the season is
  `{ id, number, subtitle, url, episode_count, show: { id, name, url } }`.
- `GET /api/feed`: each event adds `show_name` and `season_number`.

### New

- `POST /api/shows` takes `{ name, url? }` and returns 201 `{ show }`.
    - `name` is trimmed, 1–100 characters. `url` is empty or an `http(s)` URL, at most
      500 characters.
    - A case-insensitive duplicate name is a 409.
- `PATCH /api/shows/:show_id` takes `{ name?, url? }`, with the same rules. It returns
  404 for an unknown show and 409 for a duplicate name.
- `POST /api/shows/:show_id/seasons` takes `{ number, subtitle?, url?, episode_count }`
  and returns 201 `{ season }`.
    - `number` is an integer 1–999, `episode_count` an integer 1–50, and `subtitle` is
      trimmed, at most 100 characters.
    - An unknown show is a 404 and a duplicate `(show_id, number)` is a 409.
- `PATCH /api/seasons/:season_id` takes `{ subtitle?, url?, episode_count? }`.
    - An unknown season is a 404.
    - Lowering `episode_count` below a referenced episode (see Invariants) is a 409 whose
      message names the highest referenced episode. It is one conditional
      `UPDATE … WHERE NOT EXISTS (…)`, so it is race-free.
    - `number` and `show_id` are immutable, since together they are the season's
      identity.

Nothing is deletable through the API. Cleanup is done directly in D1.

## Frontend

- **Branding.** `<h1>` reads "No Spoilies!". `index.html` `<title>`,
  `apple-mobile-web-app-title` and `manifest.json` `name`/`short_name` read "TV Talk".
- **Labels (`utils.js`).**
    - `seasonLabel(season, show)` returns "Lanterns Season 1", or
      "Lanterns Season 1: Subtitle" when there is a subtitle.
    - `seasonParts` returns `{ show, number: 'Season N', subtitle }`.
    - The board's first cell shows the show name on a small line above "Season N".
- **Board filter.**
    - A "Show" `<select>` ("All shows" plus each show A–Z) sits beside the Sort buttons.
    - The selection is persisted to `localStorage` inside try/catch. An unknown or
      missing saved value means All.
    - The filter applies to the rows and to the Now Watching strip.
- **Sorting.**
    - "Season" sorts by show name, then season number.
    - "Seen Count" sorts by watcher count, then show name, then number.
    - Both sink fully watched seasons to the bottom, as in Outwatch.
- **Now Watching.**
    - Each column's chip lists one entry per show it has a current season for, each with
      its own ▶ jump.
    - The viewer's chip has one `<select>` per (filtered) show that still has seasons the
      viewer's column hasn't watched. `selectableSeasons` becomes per show.
- **Add season.**
    - "＋ Add season" beside the filter opens an inline form. The show picker lists the
      existing shows plus "New show…", which reveals name and link fields.
    - The season number is prefilled with that show's max + 1 (or 1). Episode count is
      required; subtitle and link are optional.
    - Submit creates the show first if it is new, then the season, then refetches the
      board. It is guarded by the existing `submit-guard.js`.
    - Server errors render inline. If the show was created but the season failed, the
      form switches the picker to the new show so a retry doesn't 409 on the name.
- **Edit.**
    - The season view header gets an "Edit" button beside the link. It opens an inline
      form for the season's subtitle, link and episode count, and the show's name and
      link.
    - Saves go to the two PATCH routes and server messages render inline, including the
      shrink-guard 409.
- **Feed and routing.** `#/season/:id` and `#/season/:id/episode/:n` are unchanged.
  Feed lines read "Carol commented on Lanterns Season 1 Episode 3".

## Testing

The Outwatch suite (`test/worker`, `test/frontend`) is carried over and updated for the
new payloads. Additions:

- **Worker.**
    - Show and season create and patch: validation, 403 for anyone off the roster, 404,
      409 for duplicates, and trimming.
    - The episode-count shrink guard against each of the five referencing tables, plus
      a lowering to exactly the highest referenced episode succeeding.
    - Per-show currently-watching: the season must belong to that show, a watched season
      is refused, `null` clears, and `POST /api/watched` clears only that show's pick.
    - The board and feed payload shapes, and the discussion's `show` object.
- **Migrations.** `migrations.test.js` covers the collapsed schema and the seed rows.
- **Frontend.**
    - Labels and parts.
    - Show-then-number sorting under both sort modes.
    - The filter helper, including the unknown-saved-value fallback.
    - Per-show `selectableSeasons` and the next-season-number helper.

Done means `npm test`, `npm run lint` and `npm run build` all pass.

## Repo and ops

- Copy Outwatch's tracked files except the Survivor-specific material: its migrations,
  `seed.sql` rows, `assets/icon-source.png` and `public/*.png`. The icon files are
  regenerated once the user supplies `assets/icon-source.png`. Until then,
  `index.html`/`manifest.json` still reference them and they 404.
- `wrangler.toml`: `name = "tvtalk"`, `database_name = "tvtalk"`, and a placeholder
  `database_id` to be filled in after `wrangler d1 create tvtalk`.
  `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` secrets are set up as in Outwatch.
- `roster.example.sql`, `seed.sql` and `scripts/` are updated for the `tvtalk` database
  name and new ids. `roster.sql` stays gitignored.
- `README.md`, `AGENTS.md` and `frontend/AGENTS.md` are rewritten for TV Talk, with
  Survivor prose removed and the new tables and routes documented.
- CI workflows, husky, prettier and eslint config are copied unchanged, apart from name
  references.

## Out of scope

Deleting shows or seasons from the UI, per-show "Series" terminology, episode titles,
pretty/slug URLs, and importing Outwatch data.
