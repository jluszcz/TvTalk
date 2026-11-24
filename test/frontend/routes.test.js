import { describe, it, expect } from 'vitest';
import {
    withSlugs,
    showPath,
    seasonPath,
    parseRoute,
    resolveRoute,
    targetPath,
} from '../../frontend/routes.js';

const shows = withSlugs([
    { id: 2, name: 'The Great British Bake Off' },
    { id: 1, name: 'Survivor' },
]);
const seasons = [
    { id: 70, show_id: 1, number: 51 },
    { id: 9, show_id: 2, number: 14 },
];
const parse = (pathname, hash = '') => parseRoute({ pathname, hash });
const resolve = (pathname, hash) => resolveRoute(parse(pathname, hash), shows, seasons);
const slugs = (...names) =>
    withSlugs(names.map((name, i) => ({ id: i + 1, name }))).map((s) => s.slug);

describe('withSlugs', () => {
    it.each([
        ['Survivor', 'Survivor'],
        ['The Great British Bake Off', 'The-Great-British-Bake-Off'],
        ["Grey's Anatomy", 'Greys-Anatomy'],
        ['M*A*S*H', 'M-A-S-H'],
        ['9-1-1', '9-1-1'],
        ['What If…?', 'What-If'],
        ['Pokémon', 'Pokémon'],
        ['a/b', 'a-b'],
        ['I ❤️ LA', 'I-LA'],
        ['❤️', '~1'],
        ['..', '~1'],
        ['API', 'API~1'],
        ['index', 'index~1'],
    ])('%s becomes %s', (name, slug) => {
        expect(slugs(name)).toEqual([slug]);
    });

    it('keeps the plain slug on the lowest id when two collide', () => {
        expect(slugs('A B', 'a-b')).toEqual(['A-B', 'a-b~2']);
        expect(
            withSlugs([
                { id: 5, name: 'A B' },
                { id: 3, name: 'A-B' },
            ]).map((s) => s.slug),
        ).toEqual(['A-B~5', 'A-B']);
    });
});

describe('paths', () => {
    it('names a show, a season, and an episode', () => {
        expect(showPath(null)).toBe('/');
        expect(showPath(shows[0])).toBe('/The-Great-British-Bake-Off');
        expect(seasonPath(shows[1], 51)).toBe('/Survivor/51');
        expect(seasonPath(shows[1], 51, 10)).toBe('/Survivor/51/10');
    });
});

describe('resolveRoute', () => {
    it('resolves every level by name and number', () => {
        expect(resolve('/')).toEqual({ showId: null, seasonId: null, episode: null });
        expect(resolve('/Survivor')).toEqual({ showId: 1, seasonId: null, episode: null });
        expect(resolve('/Survivor/51')).toEqual({ showId: 1, seasonId: 70, episode: null });
        expect(resolve('/Survivor/51/10')).toEqual({ showId: 1, seasonId: 70, episode: 10 });
    });

    it('ignores case and a trailing slash', () => {
        expect(resolve('/survivor/51/')).toEqual({ showId: 1, seasonId: 70, episode: null });
    });

    it('honours id-based hash links', () => {
        expect(resolve('/', '#/season/70')).toEqual({ showId: 1, seasonId: 70, episode: null });
        expect(resolve('/', '#/season/70/episode/3')).toEqual({
            showId: 1,
            seasonId: 70,
            episode: 3,
        });
    });

    it('reads any other hash as the board', () => {
        for (const hash of ['#/', '#/season/0', '#/season/045', '#/season/70/episode/0']) {
            expect(resolve('/', hash)).toEqual({ showId: null, seasonId: null, episode: null });
        }
    });

    it.each([
        '/Nope',
        '/Survivor/99',
        '/Survivor/0',
        '/Survivor/051',
        '/Survivor/51/0',
        '/Survivor/51/10/x',
        '/%E0%A4%A',
    ])('does not resolve %s', (path) => {
        expect(resolve(path)).toBe(null);
    });

    it('round-trips a slug that needs encoding', () => {
        const list = withSlugs([{ id: 4, name: 'Pokémon' }]);
        const path = showPath(list[0]);
        expect(path).toBe('/Pok%C3%A9mon');
        expect(resolveRoute(parse(path), list, []).showId).toBe(4);
    });
});

describe('targetPath', () => {
    it('is the inverse of resolveRoute', () => {
        for (const path of ['/', '/Survivor', '/Survivor/51', '/Survivor/51/10']) {
            expect(targetPath(resolve(path), shows, seasons)).toBe(path);
        }
    });

    it('rewrites a hash link to its readable address', () => {
        expect(targetPath(resolve('/', '#/season/70/episode/3'), shows, seasons)).toBe(
            '/Survivor/51/3',
        );
    });

    it('is null for a show or season the board does not have', () => {
        expect(targetPath({ showId: 8, seasonId: null, episode: null }, shows, seasons)).toBe(null);
        expect(targetPath({ showId: 1, seasonId: 8, episode: null }, shows, seasons)).toBe(null);
    });
});
