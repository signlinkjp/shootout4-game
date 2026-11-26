import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TABS, PTS, pointsFor, monthKey, weekKey, daysLeftInMonth, daysLeftInWeek, startOfWeek,
  emptyTally, addToTally, diffOf, rateOf, emptyStanding, normalizeStanding, rollStanding,
  addStandingResult, tallyFor, normalizeRow, toWire, fromWire, rankTable, compareTally,
  seasonInfo, medalFor,
} from '../src/core/ranking.js';
import {
  EMPTY_SHOTS, addShotDirection, shotSummary, loadShots, saveShots, loadStanding, recordStanding,
} from '../src/storage.js';
import { tr } from '../src/i18n.js';

/* 2026-11-27（金）05:15 ローカル時刻を基準にする（CI の UTC ランナーでも同じ日付で動くように） */
const NOW = new Date(2026, 10, 27, 5, 15, 0);

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('IPKSF 公式の勝ち点: 5本以内勝3 / サドンデス勝2 / サドンデス負1 / 5本以内負0', () => {
  assert.deepEqual({ ...PTS }, { regularWin: 3, suddenWin: 2, suddenLoss: 1, regularLoss: 0 });
  assert.equal(pointsFor({ win: true, sudden: false }), 3);
  assert.equal(pointsFor({ win: true, sudden: true }), 2);
  assert.equal(pointsFor({ win: false, sudden: true }), 1);
  assert.equal(pointsFor({ win: false, sudden: false }), 0);
  /* 負けてもマイナスにならない */
  assert.equal(addToTally(emptyTally(), { win: false, sudden: false }).points, 0);
});

test('期間のキー: 月は毎月1日、週は毎週月曜で切り替わる', () => {
  assert.equal(monthKey(NOW), '2026-11');
  assert.equal(monthKey(new Date(2026, 11, 1, 0, 0, 0)), '2026-12');
  /* 2026-11-27 は金曜 → 週の始まりは 11-23（月） */
  assert.equal(weekKey(NOW), '2026-11-23');
  assert.equal(weekKey(new Date(2026, 10, 29, 23, 59, 0)), '2026-11-23', '日曜はまだ同じ週');
  assert.equal(weekKey(new Date(2026, 10, 30, 0, 0, 0)), '2026-11-30', '月曜で切り替わる');
  assert.equal(startOfWeek(NOW).getDay(), 1);
  /* 残り日数（月間は翌月1日まで、週間は次の月曜まで） */
  assert.equal(daysLeftInMonth(NOW), 4);
  assert.equal(daysLeftInWeek(NOW), 3);
  assert.equal(daysLeftInWeek(new Date(2026, 10, 29, 12, 0, 0)), 1);
});

test('集計: 得失点差・勝率・勝ち点を同時に積む', () => {
  let tally = emptyTally();
  tally = addToTally(tally, { win: true, sudden: false, goals: 5, conceded: 4 });
  tally = addToTally(tally, { win: false, sudden: true, goals: 6, conceded: 7 });
  assert.deepEqual(tally, { points: 4, wins: 1, losses: 1, goals: 11, conceded: 11, played: 2 });
  assert.equal(diffOf(tally), 0);
  assert.equal(rateOf(tally), 50);
  assert.equal(rateOf(emptyTally()), 0);
});

test('月間・週間は期間が変わると0に戻り、総合と勝率（通算）は残る', () => {
  const { standing } = addStandingResult(emptyStanding(NOW), { win: true, sudden: false, goals: 3, conceded: 1 }, NOW);
  assert.equal(standing.total.points, 3);
  assert.equal(standing.month.points, 3);
  assert.equal(standing.week.points, 3);
  assert.equal(standing.month.key, '2026-11');

  /* 週があける（月曜）→ 週間だけ0 */
  const nextWeek = new Date(2026, 10, 30, 0, 0, 30);
  const rolled = rollStanding(standing, nextWeek);
  assert.equal(rolled.changed, true);
  assert.equal(rolled.standing.week.points, 0);
  assert.equal(rolled.standing.week.key, '2026-11-30');
  assert.equal(rolled.standing.month.points, 3, '同じ月なら月間は残る');
  assert.equal(rolled.standing.total.points, 3, '総合は残る');

  /* 月があける → 月間も0（総合は残る） */
  const nextMonth = new Date(2026, 11, 1, 0, 0, 10);
  const monthRoll = rollStanding(standing, nextMonth);
  assert.equal(monthRoll.standing.month.points, 0);
  assert.equal(monthRoll.standing.month.key, '2026-12');
  assert.equal(monthRoll.standing.total.points, 3);
});

test('タブごとの集計: 古い期間の行は月間・週間では0として扱う', () => {
  const { standing } = addStandingResult(emptyStanding(NOW), { win: true, sudden: true, goals: 6, conceded: 5 }, NOW);
  assert.equal(tallyFor(standing, 'total').points, 2);
  assert.equal(tallyFor(standing, 'month').points, 2);
  assert.equal(tallyFor(standing, 'week').points, 2);
  assert.equal(tallyFor(standing, 'rate').points, 2, '勝率タブは通算の集計を見る');

  const old = normalizeStanding({ total: { points: 9, wins: 3, losses: 0 }, month: { key: '2026-10', points: 9, wins: 3 }, week: { key: '2026-10-19', points: 9, wins: 3 } }, NOW);
  assert.equal(tallyFor(old, 'total').points, 9);
  assert.equal(tallyFor(old, 'month').points, 0);
  assert.equal(tallyFor(old, 'week').points, 0);
});

test('壊れた保存値でも落ちない（負の数・文字列・欠損）', () => {
  const broken = normalizeStanding({ total: { points: -5, wins: 'x', goals: 3.7 }, month: null, week: 'oops' }, NOW);
  assert.equal(broken.total.points, 0);
  assert.equal(broken.total.wins, 0);
  assert.equal(broken.total.goals, 3);
  assert.equal(broken.month.key, '2026-11');
  assert.equal(broken.week.played, 0);
  assert.equal(normalizeRow(null), null);
  assert.equal(normalizeRow({ id: '' }), null);
});

test('順位の決定順: 勝ち点 → 得失点差 → 総ゴール数 → 勝率', () => {
  const a = { points: 3, wins: 1, losses: 0, goals: 2, conceded: 1 };
  const b = { points: 3, wins: 1, losses: 0, goals: 4, conceded: 3 };
  const c = { points: 3, wins: 1, losses: 0, goals: 4, conceded: 0 };
  /* 勝ち点が同じなら得失点差（c が +4 で最上位、a と b は +1 どうしで総ゴール数） */
  assert.deepEqual([a, b, c].sort(compareTally).map((tally) => tally.conceded), [0, 3, 1]);
  /* 得失点差が同じなら総ゴール数 */
  const d = { points: 1, wins: 1, losses: 2, goals: 5, conceded: 5 };
  const e = { points: 1, wins: 1, losses: 4, goals: 8, conceded: 8 };
  assert.ok(compareTally(e, d) < 0, '得失点差0どうしは総ゴールの多いほうが上');
  /* 勝ち点が違えば勝ち点が優先 */
  assert.ok(compareTally({ points: 2 }, { points: 3 }) > 0);
});

test('rankTable: 並べ替え・順位・自分を必ず入れる（4タブ）', () => {
  const date = NOW;
  const mine = addStandingResult(emptyStanding(date), { win: true, sudden: false, goals: 3, conceded: 0 }, date).standing;
  const me = { id: 'me', nickname: 'ME', countryCode: 'JP', ...mine, updatedAt: 10 };
  const peers = [
    { id: 'p1', nickname: 'P1', countryCode: 'BR', total: { points: 4, wins: 2, losses: 0, goals: 6, conceded: 2 }, month: { key: '2026-11', points: 4, wins: 2, losses: 0, goals: 6, conceded: 2 }, week: { key: '2026-11-23', points: 4, wins: 2, losses: 0, goals: 6, conceded: 2 }, updatedAt: 1 },
    { id: 'p2', nickname: 'P2', countryCode: 'ES', total: { points: 3, wins: 1, losses: 1, goals: 2, conceded: 5 }, month: { key: '2026-10', points: 3, wins: 1, losses: 1, goals: 2, conceded: 5 }, week: { key: '2026-10-19', points: 3, wins: 1, losses: 1, goals: 2, conceded: 5 }, updatedAt: 1 },
  ];
  const total = rankTable(peers, me, { tab: 'total', date });
  assert.deepEqual(total.map((row) => row.id), ['p1', 'me', 'p2'], '勝ち点 4 > 3（得失点差）> 3');
  assert.deepEqual(total.map((row) => row.place), [1, 2, 3]);
  assert.equal(total.find((row) => row.isMe).id, 'me');

  const month = rankTable(peers, me, { tab: 'month', date });
  assert.equal(month.some((row) => row.id === 'p2'), false, '先月の記録は月間に出さない');
  assert.deepEqual(month.map((row) => row.id), ['p1', 'me']);

  const week = rankTable(peers, me, { tab: 'week', date });
  assert.deepEqual(week.map((row) => row.id), ['p1', 'me']);

  const rate = rankTable(peers, me, { tab: 'rate', date });
  /* 勝率の順。同じ100%どうしは勝ち点で並ぶ（p1 2勝0敗 > me 1勝0敗） */
  assert.deepEqual(rate.map((row) => [row.id, row.rate]), [['p1', 100], ['me', 100], ['p2', 50]]);
  assert.equal(medalFor(1), '🥇');
  assert.equal(medalFor(3), '🥉');
  assert.equal(medalFor(4), '#4');
});

test('通信の行: 小さい配列に落として送り、同じ形に戻せる', () => {
  const date = NOW;
  const standing = addStandingResult(emptyStanding(date), { win: false, sudden: true, goals: 5, conceded: 6 }, date).standing;
  const row = { id: 's4abc12345', nickname: 'TOMOAKI', countryCode: 'JP', ...standing, updatedAt: 1234567 };
  const wire = toWire(row);
  assert.ok(JSON.stringify(wire).length < 512, `512文字以内: ${JSON.stringify(wire).length}`);
  const back = fromWire(wire, { now: 1234567, date });
  assert.equal(back.id, 's4abc12345');
  assert.equal(back.nickname, 'TOMOAKI');
  assert.equal(back.total.points, 1);
  assert.equal(back.total.conceded, 6);
  assert.equal(back.month.key, '2026-11');
  /* 旧形式（points / wins / losses が直にある行）も読める */
  const legacy = fromWire({ id: 'old', n: 'OLD', c: 'BR', t: [7, 2, 1, 4, 3], u: 1 }, { date });
  assert.equal(legacy.total.points, 7);
  assert.equal(legacy.total.wins, 2);
});

test('シーズン表記（12言語）: 月間・週間・通算・勝率', () => {
  const say = (language, tab) => seasonInfo(tab, { date: NOW, language, t: (key, vars) => tr(language, key, vars) }).label;
  assert.match(say('ja', 'month'), /^2026年11月シーズン · 残り4日$/);
  assert.match(say('ja', 'week'), /^11\/23–11\/29週シーズン · 残り3日$/);
  assert.equal(say('ja', 'total'), '通算シーズン · 全期間');
  assert.equal(say('ja', 'rate'), '通算勝率 · 全期間');
  for (const language of ['en', 'zh-Hans', 'zh-Hant', 'ko', 'es', 'pt', 'fr', 'de', 'it', 'th', 'id']) {
    const label = say(language, 'month');
    assert.ok(label.length > 4 && !label.includes('{'), `${language}: ${label}`);
    assert.notEqual(label, say('ja', 'month'), `${language} は翻訳されている`);
  }
  assert.deepEqual([...TABS], ['total', 'month', 'week', 'rate']);
});

test('キック傾向: 4方向の回数と％（合計0なら0%）', () => {
  let shots = { ...EMPTY_SHOTS };
  shots = addShotDirection(shots, 'TL');
  shots = addShotDirection(shots, 'TL');
  shots = addShotDirection(shots, 'BR');
  shots = addShotDirection(shots, 'OUT'); /* 枠外は数えない */
  const summary = shotSummary(shots);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.rows.map((row) => [row.dir, row.count, row.rate]), [
    ['TL', 2, 67], ['TR', 0, 0], ['BL', 0, 0], ['BR', 1, 33],
  ]);
  assert.equal(shotSummary(EMPTY_SHOTS).rows.every((row) => row.rate === 0), true);
  assert.equal(shotSummary(EMPTY_SHOTS).total, 0);

  const storage = fakeStorage();
  saveShots(storage, shots);
  assert.deepEqual(loadShots(storage), shots);
  storage.setItem('shootout4.shots.v1', '{"TL":-2,"TR":"x"}');
  assert.deepEqual(loadShots(storage), EMPTY_SHOTS, '壊れた値は0へ');
});

test('ランキングの保存: 期間をまたいでも総合が残る（localStorage 経由）', () => {
  const storage = fakeStorage();
  const first = recordStanding(storage, loadStanding(storage, NOW), { winner: 'me', goals: 4, conceded: 3 }, NOW);
  assert.equal(first.total.points, 3);
  assert.equal(first.month.points, 3);
  const saved = loadStanding(storage, NOW);
  assert.equal(saved.total.points, 3);
  const next = recordStanding(storage, saved, { winner: 'me', goals: 5, conceded: 2, sudden: true }, NOW);
  assert.equal(next.total.points, 5);
  assert.equal(next.week.points, 5);
});
