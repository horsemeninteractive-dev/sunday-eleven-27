import { useState } from 'react';
import { CLUB_STRUCTURE_LABEL, type LedgerEntry } from '@/domain/club';
import { financeSummary } from '@/simulation/finance';
import { formatShortDate } from '@/simulation/calendar';
import { matchdaysPlayed } from '@/simulation/timeline';
import { money, moneyShort } from '../format';
import { useGame } from '../hooks';
import { Callout, PageHeader, Panel, Pill, SortTh, Stat } from '../components/primitives';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

type LedgerSortKey = 'date' | 'description' | 'category' | 'amount' | 'balance';

const CATEGORY_LABEL: Record<string, string> = {
  subs: 'Player subs',
  sponsorship: 'Sponsorship',
  matchday: 'Matchday income',
  fundraising: 'Fundraising',
  'pitch-hire': 'Pitch hire',
  referee: 'Referee fees',
  'league-fee': 'League fees',
  insurance: 'Insurance',
  equipment: 'Kit and equipment',
  fines: 'League fines',
  other: 'Other and travel',
};

const LEDGER_SORT: SortAccessors<LedgerEntry, LedgerSortKey> = {
  date: (entry) => entry.date,
  description: (entry) => entry.description,
  category: (entry) => CATEGORY_LABEL[entry.category] ?? entry.category,
  amount: (entry) => entry.amount,
  balance: (entry) => entry.balanceAfter,
};

/**
 * Finances.
 *
 * A treasurer's book, not accounting software. The balance is the first thing
 * on the screen, a warning appears when it matters, and the ledger is there to
 * answer "where did that go?" rather than to be studied.
 */
export function FinancesView() {
  const game = useGame();
  const [sort, setSort] = useState<SortState<LedgerSortKey>>(UNSORTED);
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const finances = club.finances;
  const summary = financeSummary(club);
  const ledger = finances.ledger.slice().reverse().slice(0, 60);
  const rows = applySort(ledger, sort, LEDGER_SORT);
  const weeklyIn = club.squadIds.length * finances.subscriptionPerPlayer + finances.sponsorIncomePerWeek;
  const weeklyOut = finances.weeklyGroundCost + finances.insurancePerWeek + finances.trainingCostPerWeek;
  const net = weeklyIn - weeklyOut;
  const weeksLeft = game.season.calendar.length - matchdaysPlayed(game);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club admin"
        title="Finances"
        subtitle={`${CLUB_STRUCTURE_LABEL[club.structure]} · the treasurer keeps a book, not a spreadsheet`}
        meta={
          <span className="small muted">
            {finances.ledger.length} entries on record · roughly {weeksLeft} weeks left this season
          </span>
        }
      />

      <Panel
        level="primary"
        title="Where the club stands"
        tone={finances.balance < 0 ? 'danger' : 'default'}
      >
        <div className="stat-grid stat-grid--wide">
          <Stat label="Balance" value={money(finances.balance)} hint="Everything that comes in and goes out" />
          <Stat label="Typical weekly in" value={money(weeklyIn)} hint="Subs and sponsorship instalments" />
          <Stat label="Typical weekly out" value={money(-weeklyOut)} hint="Pitch hire, insurance and training" />
          <Stat
            label="Week to week"
            value={money(net)}
            hint="Before matchdays, referees and fines"
            tone={net < 0 ? 'bad' : 'ok'}
          />
          <Stat label="Player subs" value={`£${finances.subscriptionPerPlayer}`} hint={`${club.squadIds.length} registered players per week`} />
          <Stat
            label="Sponsorship"
            value={`£${finances.sponsorIncomePerWeek}`}
            hint={club.sponsorIds.length ? 'Local businesses' : 'No sponsor attached'}
          />
        </div>

        {finances.balance < 0 ? (
          <Callout tone="bad" title="The club is in the red">
            Referees still want paying and the league does not accept goodwill. A fund-raiser or a smaller squad are the
            usual answers.
          </Callout>
        ) : finances.balance < 120 ? (
          <Callout tone="warn" title="Not much room for error">
            A pitch hire and a referee will take most of that in a single Sunday.
          </Callout>
        ) : null}

        <p className="muted small">
          Over the last {Math.min(40, finances.ledger.length)} entries: {money(summary.income)} in,{' '}
          {money(summary.expenditure)} out.
        </p>
      </Panel>

      <Panel level="quiet" title="The ledger" subtitle="Newest first">
        {ledger.length === 0 && <p className="empty">No money has moved yet.</p>}
        <div className="table-wrapper">
          <table className="table table--stack">
            <thead>
              <tr>
                <SortTh label="Date" sortKey="date" sort={sort} onSort={setSort} />
                <SortTh label="Description" sortKey="description" sort={sort} onSort={setSort} />
                <SortTh label="Category" sortKey="category" sort={sort} onSort={setSort} />
                <SortTh label="Amount" sortKey="amount" sort={sort} onSort={setSort} />
                <SortTh label="Balance" sortKey="balance" sort={sort} onSort={setSort} className="col--opt" />
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td className="muted small" data-label="Date">
                    {formatShortDate(entry.date)}
                  </td>
                  <td data-label="What">{entry.description}</td>
                  <td data-label="Category">
                    <Pill tone="muted">{CATEGORY_LABEL[entry.category] ?? entry.category}</Pill>
                  </td>
                  <td className={entry.amount < 0 ? 'tone tone--bad num' : 'tone tone--ok num'} data-label="Amount">
                    {entry.amount > 0 ? '+' : ''}
                    {money(entry.amount)}
                  </td>
                  <td className="muted num col--opt" data-label="After">
                    {moneyShort(entry.balanceAfter)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
