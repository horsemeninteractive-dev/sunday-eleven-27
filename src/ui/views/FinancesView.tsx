import { useState } from 'react';
import { CLUB_STRUCTURE_LABEL, type LedgerEntry } from '@/domain/club';
import { competenceLabel } from '@/domain/staff';
import { formatShortDate } from '@/simulation/calendar';
import {
  seasonOutlook,
  treasurerSummary,
  type FinancialConcern,
  type OutstandingSub,
} from '@/simulation/treasurer';
import { renewalText, sponsorshipSummary, weeklySponsorshipIncome } from '@/simulation/sponsorship';
import { obligationsTotal, upcomingObligations } from '@/simulation/obligations';
import { money, moneyShort } from '../format';
import { gameActions, useGame } from '../hooks';
import { Button, Callout, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { FocalFact, MetricTile, Section, TileGrid } from '../components/hierarchy';
import { PersonLine } from '../components/PersonIdentity';
import { useRememberedSort } from '../rememberedSort';
import { applySort, type SortAccessors } from '../tableSort';

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
 * One man's outstanding matchday money, with the treasurer's hand on it.
 *
 * The amount defaults to everything he owes, so taking the whole sub is one
 * press; typing a smaller figure leaves the rest on his record as a part payment.
 * Either way the money is only booked when it is actually taken.
 *
 * He is drawn rather than named, because this is a list of the club's own men and
 * chasing one of them is a conversation: the treasurer's book is the one place in
 * the game where a face is the difference between a name and a man you have to
 * go and find.
 */
function OutstandingSubRow({ row }: { row: OutstandingSub }) {
  const [entry, setEntry] = useState(String(row.owed));
  const parsed = Number(entry);
  const valid = entry.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= row.owed;
  const amount = valid ? parsed : 0;
  const full = amount >= row.owed;

  return (
    <li>
      <div className="row row--wrap">
        <PersonLine personId={row.personId} />
        <Pill tone="warn">{money(row.owed)} owed</Pill>
        {row.matches > 1 && (
          <span className="muted small">
            {row.matches} match{row.matches === 1 ? '' : 'es'}
          </span>
        )}
        {row.oldestDate && <span className="muted small">since {formatShortDate(row.oldestDate)}</span>}
        <label className="muted small">
          Take £
          <input
            className="input input--small"
            type="number"
            min={0}
            max={row.owed}
            step={0.5}
            value={entry}
            aria-label={`Payment from ${row.name}`}
            aria-invalid={!valid}
            onChange={(event) => setEntry(event.target.value)}
          />
        </label>
        <Button size="sm" disabled={!valid} variant={full ? 'primary' : 'default'} onClick={() => gameActions().collectSubs(row.personId, amount)}>
          {full ? 'Collect in full' : 'Take part payment'}
        </Button>
      </div>
    </li>
  );
}

function concernTone(concern: FinancialConcern): 'warn' | 'bad' | 'info' {
  if (concern.tone === 'bad') return 'bad';
  if (concern.tone === 'warn') return 'warn';
  return 'info';
}

/**
 * Finances.
 *
 * A treasurer's book, not accounting software. The balance is the first thing on
 * the screen, the treasurer is named as the man accountable for it, and the money
 * a player still owes is kept visibly apart from the money the club actually has.
 * The ledger is there to answer "where did that go?" rather than to be studied.
 */
export function FinancesView() {
  const game = useGame();
  const [sort, setSort] = useRememberedSort('finances', game?.saveId ?? null, LEDGER_SORT);
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const finances = club.finances;
  const treasurer = treasurerSummary(game);
  const sponsorship = sponsorshipSummary(game, club.id);
  const obligations = upcomingObligations(game, club.id, { weeks: 6, limit: 5 });
  const ledger = finances.ledger.slice().reverse().slice(0, 60);
  const rows = applySort(ledger, sort, LEDGER_SORT);
  // Subs are a matchday liability now, so the recurring weekly income is the
  // sponsor alone — read from the club's actual agreement, not a stored figure,
  // and averaged to a week, since a monthly deal pays on the 28th.
  const weeklyIn = weeklySponsorshipIncome(game, club.id);
  const weeklyOut = finances.weeklyGroundCost + finances.insurancePerWeek + finances.trainingCostPerWeek;
  // Where that week takes the balance, and over how many weeks — the treasurer's
  // own read, so the projection and the tiles above it are the same arithmetic.
  const outlook = seasonOutlook(game, club.id);
  const net = outlook.weeklyNet;
  const weeksLeft = outlook.weeksLeft;
  const responsibility = treasurer.responsibility;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title="Finances"
        subtitle={`${club.identity.shortName}'s treasurer's book · money held, money due and the weeks ahead`}
        meta={
          <>
            <span className="small muted">{CLUB_STRUCTURE_LABEL[club.structure]}</span>
            <span className="small muted">
              {finances.ledger.length} entries · {weeksLeft} weeks left
            </span>
          </>
        }
      />

      <Callout tone="info" title={responsibility.role === 'treasurer' ? 'Treasurer' : 'Who holds the book'}>
        {responsibility.role === 'none' ? (
          <>Nobody is keeping the club's books. You are on your own with the money.</>
        ) : (
          <>
            <strong>{responsibility.name}</strong>
            {responsibility.role === 'treasurer'
              ? ' keeps the club’s books'
              : ' is both manager and treasurer, so the book is his'}
            {responsibility.competence > 0 && <> · {competenceLabel(responsibility.competence)} with money</>}
            {!responsibility.available && ' · away this week'}.
          </>
        )}
      </Callout>

      {/* The balance is what this screen is about, so it is drawn as the one fact
          rather than as the first of three tiles: at display size, on the rule
          under the screen's name, with the two facts that look forward still
          beside and below it as the secondary reading they are. */}
      <FocalFact
        label="In the bank"
        value={money(treasurer.balance)}
        note="Everything in and out"
        tone={treasurer.balance < 0 ? 'bad' : treasurer.balance < 120 ? 'warn' : 'ok'}
      />
      <TileGrid min={185}>
        <MetricTile
          label="Heading for"
          value={money(outlook.projected)}
          note={
            outlook.seasonEnd
              ? `By ${formatShortDate(outlook.seasonEnd)}, if the week repeats`
              : 'The season has run out'
          }
          tone={outlook.projected < 0 ? 'bad' : outlook.projected < 120 ? 'warn' : 'ok'}
        />
        <MetricTile
          label="Owed to us"
          value={money(treasurer.outstandingTotal)}
          note={`Matchday subs · ${treasurer.outstanding.length} outstanding`}
          tone={treasurer.outstandingTotal > 0 ? 'warn' : 'ok'}
        />
      </TileGrid>
      <details className="more"><summary>A typical week · income, outgoings and net</summary><TileGrid min={185}>
        <MetricTile
          label="In"
          value={money(weeklyIn)}
          note={sponsorship.deal ? `${sponsorship.sponsorName} · ${sponsorship.payDay}` : 'No sponsor (subs are per match)'}
        />
        <MetricTile label="Out" value={money(-weeklyOut)} note="Pitch, insurance, training" />
        <MetricTile label="Net" value={money(net)} note="Typical week" tone={net < 0 ? 'bad' : 'ok'} />
      </TileGrid></details>

      {/*
        What is wrong and what is coming, together, because they are the same
        question at a Sunday club. The section is always drawn even when both
        halves are empty, so a card that sends the manager here for "the
        treasurer is worried about the money" always lands on something.
      */}
      <Section
        title="The outlook"
        id="money-outlook"
        action={<span className="small muted">Next six weeks</span>}
      >
        {treasurer.concerns.map((concern, index) => (
          <Callout key={index} tone={concernTone(concern)}>
            {concern.amount !== undefined ? (
              <>
                {concern.text} <strong>{money(concern.amount)}</strong>.
              </>
            ) : (
              concern.text
            )}
          </Callout>
        ))}

        {obligations.length === 0 ? (
          <p className="empty">Nothing due in the next six weeks beyond the usual week.</p>
        ) : (
          <>
            <ul className="tight-list">
              {obligations.map((obligation) => (
                <li key={obligation.id}>
                  <div className="row row--wrap">
                    <span className="muted small">{formatShortDate(obligation.date)}</span>
                    <strong>{obligation.label}</strong>
                    <Pill tone="muted">{money(obligation.amount)}</Pill>
                  </div>
                  <div className="muted small">{obligation.detail}</div>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {money(obligationsTotal(obligations))} of known commitments in the next six weeks. Pitch hire,
              insurance and the hall come round every week; referees come with the fixture.
            </p>
          </>
        )}
      </Section>

      <Section title="Money owed to the club" id="money-owed">
        <p className="muted small">
          Subs a player has been charged but has not paid. Owed money is not income — it only reaches the
          balance when it is handed over and recorded here.
        </p>
        {treasurer.outstanding.length === 0 ? (
          <p className="empty">Everyone is up to date on their matchday subs.</p>
        ) : (
          <ul className="tight-list">
            {treasurer.outstanding.map((row) => (
              <OutstandingSubRow key={row.personId} row={row} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Sponsorship" id="sponsorship">
        {sponsorship.deal ? (
          <>
            <div className="row row--wrap">
              <strong>{sponsorship.sponsorName}</strong>
              <Pill tone={sponsorship.standing === 'active' ? 'ok' : sponsorship.standing === 'renewal-due' ? 'warn' : 'bad'}>
                {sponsorship.standing === 'active'
                  ? 'Active'
                  : sponsorship.standing === 'renewal-due'
                    ? 'Renewal due'
                    : 'In trouble'}
              </Pill>
              {sponsorship.sponsorKindLabel && (
                <span className="muted small">
                  {sponsorship.sponsorKindLabel}
                  {sponsorship.sponsorTownName ? `, ${sponsorship.sponsorTownName}` : ''}
                </span>
              )}
            </div>
            <TileGrid min={150}>
              <MetricTile label="Income" value={money(sponsorship.instalment)} note={sponsorship.payDay} />
              <MetricTile label="Renewal" value={renewalText(game, sponsorship)} note="When the term runs out" />
              <MetricTile label="Fit" value={`${Math.round(sponsorship.fit)}`} note="How the club suits them" />
            </TileGrid>
            <p className="muted small">
              Paid {sponsorship.paidCount} time{sponsorship.paidCount === 1 ? '' : 's'}
              {sponsorship.missedCount > 0 ? ` · ${sponsorship.missedCount} missed` : ''}. The agreement decides when
              money is due — there is no other sponsorship schedule.
            </p>
            {sponsorship.issue && (
              <Callout tone={sponsorship.standing === 'lapsed' ? 'bad' : 'warn'}>{sponsorship.issue}</Callout>
            )}
          </>
        ) : (
          <>
            <p className="empty">No sponsor at the moment. The books are leaner without one.</p>
            <div className="row row--wrap">
              <Button size="sm" variant="primary" onClick={() => gameActions().seekSponsor()}>
                Look for a sponsor
              </Button>
            </div>
            {sponsorship.candidates.length > 0 && (
              <ul className="tight-list">
                {sponsorship.candidates.slice(0, 4).map((candidate) => (
                  <li key={candidate.businessId}>
                    <div className="row row--wrap">
                      <strong>{candidate.name}</strong>
                      <Pill tone="muted">{candidate.kindLabel}</Pill>
                      <span className="muted small">
                        {candidate.townName} · fit {Math.round(candidate.fit)} ·{' '}
                        {candidate.frequency === 'weekly' ? 'pays weekly' : 'pays monthly'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title="Where it goes">
        <MetricTile
          label="Last entries"
          value={`${money(treasurer.income)} in`}
          note={`${money(treasurer.expenditure)} out over ${Math.min(40, finances.ledger.length)} entries`}
        />
      </Section>

      <details className="more"><summary>The ledger · {finances.ledger.length} entries</summary><Section>
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
      </Section></details>
    </div>
  );
}
