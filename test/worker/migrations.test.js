import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('seed', () => {
    it('seeds Bake Off Season 14 and Lanterns Season 1', async () => {
        const { results } = await env.DB.prepare(
            `SELECT shows.name AS show, seasons.number AS number, seasons.episode_count AS episodes
             FROM seasons JOIN shows ON shows.id = seasons.show_id
             WHERE shows.name <> 'Survivor'
             ORDER BY shows.name ASC`,
        ).all();
        expect(results).toEqual([
            { show: 'Lanterns', number: 1, episodes: 8 },
            { show: 'The Great British Bake Off', number: 14, episodes: 10 },
        ]);
    });

    // Outwatch (../Outwatch) reads and writes this database as a Survivor-only
    // frontend and finds the show by this exact name. The episode counts were
    // transcribed by hand from Wikipedia: a dropped value leaves a 0 and a
    // slipped digit leaves a 130, and both are caught here.
    it('seeds Survivor seasons 1–51 for Outwatch', async () => {
        const { results } = await env.DB.prepare(
            `SELECT seasons.number AS number, seasons.subtitle AS subtitle,
                    seasons.url AS url, seasons.episode_count AS episodes
             FROM seasons JOIN shows ON shows.id = seasons.show_id
             WHERE shows.name = 'Survivor'
             ORDER BY seasons.number ASC`,
        ).all();
        expect(results.map((r) => r.number)).toEqual(Array.from({ length: 51 }, (_, i) => i + 1));
        for (const season of results) {
            expect(season.episodes).toBeGreaterThanOrEqual(12);
            expect(season.episodes).toBeLessThanOrEqual(17);
        }
        expect(results[0]).toEqual({
            number: 1,
            subtitle: 'Borneo',
            url: 'https://en.wikipedia.org/wiki/Survivor:_Borneo',
            episodes: 13,
        });
        expect(results[50].url).toBe('https://en.wikipedia.org/wiki/Survivor_51');
    });

    it('refuses a second show whose name differs only in case', async () => {
        await expect(
            env.DB.prepare(
                "INSERT INTO shows (name, url, created_at) VALUES ('lanterns', '', '2026-09-25T00:00:00.000Z')",
            ).run(),
        ).rejects.toThrow(/UNIQUE/);
    });
});

// The two columns individual attribution rests on, both defined in
// 0001_initial.sql. sqlite_master is a faithful record of whether they
// actually applied.
describe('individual author columns', () => {
    it('adds a per-person name and a post author', async () => {
        const { results } = await env.DB.prepare(
            `SELECT name, sql FROM sqlite_master
             WHERE type = 'table' AND name IN ('posts', 'user_emails')`,
        ).all();
        const sqlFor = Object.fromEntries(results.map((r) => [r.name, r.sql]));
        expect(sqlFor.user_emails).toMatch(/name\s+TEXT/);
        expect(sqlFor.posts).toMatch(/author_email\s+TEXT/);
    });
});

// The reply, edit, and reaction columns and tables, all defined in
// 0001_initial.sql. sqlite_master is a faithful record of whether they
// actually applied.
describe('reply, edit, and reaction schema', () => {
    it('adds the reply and edit columns to posts', async () => {
        const row = await env.DB.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'posts'",
        ).first();
        expect(row.sql).toMatch(/reply_to_post_id\s+INTEGER/);
        expect(row.sql).toMatch(/edited_at\s+TEXT/);
    });

    it('creates the reactions table keyed on the individual', async () => {
        const row = await env.DB.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reactions'",
        ).first();
        expect(row.sql).toContain('COLLATE NOCASE');
        expect(row.sql).toContain('PRIMARY KEY (post_id, email, emoji)');
    });

    it('rejects a duplicate reaction from the same person', async () => {
        await env.DB.exec(
            "INSERT OR IGNORE INTO users (id, name, sort_order) VALUES ('user-mig', 'Mig', 9)",
        );
        await env.DB.exec(
            "INSERT OR IGNORE INTO user_emails (email, user_id) VALUES ('mig@example.com', 'user-mig')",
        );
        const inserted = await env.DB.prepare(
            `INSERT INTO posts (season_id, episode, user_id, body, created_at)
             VALUES (1, 1, 'user-mig', 'note', '2026-07-28T00:00:00.000Z')
             RETURNING id`,
        ).first();
        const postId = inserted.id;
        const insert = () =>
            env.DB.prepare(
                `INSERT OR IGNORE INTO reactions (post_id, email, emoji, created_at)
                 VALUES (?, 'mig@example.com', '👍', '2026-07-28T00:00:00.000Z')`,
            )
                .bind(postId)
                .run();
        await insert();
        await insert();
        const { results } = await env.DB.prepare(
            'SELECT COUNT(*) AS n FROM reactions WHERE post_id = ?',
        )
            .bind(postId)
            .all();
        expect(results[0].n).toBe(1);
    });
});

// The correction deliberately lives outside watch_sessions: `start` zeroes that
// row, and zeroing a correction would silently un-shift notes it had already
// moved. Its own table is what makes it outlive the session that produced it.
describe('watch offset corrections', () => {
    it('has a watch_offsets table keyed per user, season, and episode', async () => {
        const { results } = await env.DB.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'watch_offsets'",
        ).all();
        expect(results).toHaveLength(1);
        expect(results[0].sql).toContain('adjust_secs');
        expect(results[0].sql).toContain('PRIMARY KEY (user_id, season_id, episode)');
    });

    it('indexes the season_id column for efficient reads by season', async () => {
        const { results } = await env.DB.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_watch_offsets_season'",
        ).all();
        expect(results).toHaveLength(1);
    });
});

// idx_posts_created, from 0001_initial.sql. GET /api/feed filters posts on
// created_at alone, which idx_posts_board (season_id, episode, id) cannot
// serve — its leading column is not in the query — so without this index the
// bell would scan the whole table on every page load. Asserted through the
// query planner as well as sqlite_master: the index existing is not the
// property worth having, being used is, and a later index or a rewritten
// WHERE clause could take that away while leaving the CREATE statement sitting
// there looking correct.
describe('feed window index', () => {
    it('creates idx_posts_created', async () => {
        const { results } = await env.DB.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_posts_created'",
        ).all();
        expect(results).toHaveLength(1);
    });

    it('plans the feed window scan through it', async () => {
        const { results } = await env.DB.prepare(
            'EXPLAIN QUERY PLAN SELECT id FROM posts WHERE created_at >= ?',
        )
            .bind('2026-01-01T00:00:00.000Z')
            .all();
        const plan = results.map((row) => row.detail).join(' ');
        expect(plan).toContain('idx_posts_created');
    });
});

// feed_seen_at, defined on user_emails in 0001_initial.sql. It sits there
// rather than on users because reading the feed is something a person does
// with their own eyes — a shared column's two logins keep separate badges.
describe('feed seen marks', () => {
    it('adds a per-individual feed_seen_at to user_emails', async () => {
        const row = await env.DB.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_emails'",
        ).first();
        expect(row.sql).toContain('feed_seen_at TEXT');
    });

    it('does not add the column to users', async () => {
        const row = await env.DB.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'",
        ).first();
        expect(row.sql).not.toContain('feed_seen_at');
    });
});

// A skip is a per-column, per-episode row, the same shape reveals and
// watch_offsets take. The index is what the discussion read leans on: it loads
// every user's statuses for one season, filtering on the primary key's second
// column, which the implicit PK index cannot serve.
describe('episode statuses', () => {
    it('creates the table with a status and a reason', async () => {
        const row = await env.DB.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'episode_statuses'",
        ).first();
        expect(row).not.toBeNull();
        expect(row.sql).toContain('PRIMARY KEY (user_id, season_id, episode)');
        expect(row.sql).toMatch(/status\s+TEXT\s+NOT NULL/);
        expect(row.sql).toMatch(/reason\s+TEXT\s+NOT NULL/);
    });

    it('indexes the table by season', async () => {
        const row = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_episode_statuses_season'",
        ).first();
        expect(row).not.toBeNull();
    });
});
