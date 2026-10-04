import { useState } from 'react';
import { CLUB_STRUCTURE_LABEL, type LedgerEntry } from '@/domain/club';
import { financeSummary } from '@/simulation/finance';
import { formatShortDate } from '@/simulation/calendar';
import { matchdaysPlayed } from '@/simulation/timeline';
import { money, moneyShort } from '../format';
import { useGame } from '../hooks';
import { Callout, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { MetricTile, Section, TileGrid } from '../components/hierarchy';
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
        eyebrow="Club"
        title="Finances"
        meta={
          <>
            <span className="small muted">{CLUB_STRUCTURE_LABEL[club.structure]}</span>
            <span className="small muted">{finances.ledger.length} entries · {weeksLeft} weeks left</span>
          </>
        }
      />

      <TileGrid min={185}>
        <MetricTile
          label="Balance"
          value={money(finances.balance)}
          note="Everything in and out"
          tone={finances.balance < 0 ? 'bad' : finances.balance < 120 ? 'warn' : 'ok'}
        />
        <MetricTile label="In" value={money(weeklyIn)} note="Subs and sponsorship" />
        <MetricTile label="Out" value={money(-weeklyOut)} note="Pitch, insurance, training" />
        <MetricTile label="Net" value={money(net)} note="Typical week" tone={net < 0 ? 'bad' : 'ok'} />
      </TileGrid>

      {finances.balance < 0 ? (
        <Callout tone="bad" title="The club is in the red">
          Referees still want paying. A fund-raiser or a smaller squad are the usual answers.
        </Callout>
      ) : finances.balance < 120 ? (
        <Callout tone="warn" title="Not much room for error">
          A pitch hire and a referee will take most of that in a single Sunday.
        </Callout>
      ) : null}

      <Section title="Where it goes">
        <MetricTile
          label="Last entries"
          value={`${money(summary.income)} in`}
          note={`${money(summary.expenditure)} out over ${Math.min(40, finances.ledger.length)} entries`}
        />
      </Section>

      <Section title="The ledger">
      <Panel level="quiet" flush subtitle="Newest first">
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
      </Section>
    </div>
  );
}
