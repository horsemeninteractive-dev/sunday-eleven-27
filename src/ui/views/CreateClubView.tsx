import { useMemo, useState } from 'react';
import { CLUB_STRUCTURE_LABEL, type ClubStructure } from '@/domain/club';
import { compactBadge, type BadgeDevice, type BadgePattern, type BadgeShape } from '@/domain/badge';
import type { GroundSurface } from '@/domain/world';
import type { PyramidId, TownId } from '@/domain/ids';
import { isPlayer } from '@/domain/person';
import type { PositionGroup } from '@/domain/positions';
import {
  CAREER_START_YEAR,
  EARLIEST_FOUNDED_YEAR,
  backingGrant,
  bottomDivisionClubIds,
  CLUB_BACKINGS,
  displacedClubId,
  foundedYearWithin,
  MAX_SQUAD_SIZE,
  MIN_SQUAD_SIZE,
  reputationFromAbility,
  squadCost,
  squadForCustomClub,
  squadStandardOption,
  SQUAD_STANDARDS,
  type ClubBacking,
  type SquadStandard,
} from '@/simulation/gameSetup';
import { abilityBandFor, abilityMean } from '@/simulation/queries';
import { useGameStore } from '@/state/gameStore';
import { gameActions } from '../hooks';
import { moneyWhole } from '../format';
import { BADGE_DEVICES, BADGE_PATTERNS, BADGE_SHAPES } from '../badge';
import { Button, PageHeader, Panel, Stat } from '../components/primitives';
import { ClubBadge } from '../components/Badge';
import { PyramidPicker } from '../components/PyramidPicker';
import { SceneBackdrop } from '../components/SceneBackdrop';
import { draftLadderOptions, ladderChoices, townChoicesFor } from '../worldNav';

const STRUCTURES: ClubStructure[] = ['committee', 'members', 'pub-backed', 'business-backed', 'community', 'chairman-led'];
const SURFACES: GroundSurface[] = ['grass', 'grass (uneven)', '3G', 'cinder'];
const POSITION_GROUPS: PositionGroup[] = ['GK', 'DEF', 'MID', 'FWD'];
const GROUP_LABEL: Record<PositionGroup, string> = {
  GK: 'Goalkeepers',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};
const SQUAD_SIZES = Array.from({ length: MAX_SQUAD_SIZE - MIN_SQUAD_SIZE + 1 }, (_, index) => MIN_SQUAD_SIZE + index);

/**
 * The shortest name the league will register.
 *
 * Named once because it is the enable-state of two buttons, the check behind
 * them and the sentence under the form: four readings of one rule, which is how
 * a screen comes to offer to register a club it will then refuse.
 */
const MIN_CLUB_NAME_LENGTH = 3;

/**
 * The badge, and the three decisions it is made of.
 *
 * Every club in the world wears a badge drawn for it, and so does this one:
 * "as drawn" is a real answer to each of these, and the badge behind it is the
 * one the club would have been given anyway. What the manager changes is the
 * silhouette, the pattern and the symbol — the rest, the name, the year and the
 * two colours of it, comes from what he has already typed above.
 */
type BadgePick<T> = T | 'auto';

const BADGE_SHAPE_LABEL: Record<BadgeShape, string> = {
  shield: 'Shield',
  roundel: 'Roundel',
  oval: 'Oval',
  arch: 'Arch',
  pennant: 'Pennant',
  // The five the generator deals from since the county was five badges between
  // them. Named as a manager would name a badge, not as the path is written: the
  // swallowtail is a banner to anyone looking at it, and the lozenge is a diamond.
  octagon: 'Octagon',
  plaque: 'Plaque',
  swallowtail: 'Banner',
  gable: 'Gable',
  ovalWide: 'Wide oval',
};

const BADGE_PATTERN_LABEL: Record<BadgePattern, string> = {
  plain: 'Plain',
  stripes: 'Stripes',
  pinstripes: 'Pinstripes',
  hoops: 'Hoops',
  halves: 'Halves',
  quarters: 'Quarters',
  sash: 'Sash',
  chevron: 'Chevron',
  bordure: 'Border',
  perFess: 'Split across',
  saltire: 'Saltire',
};

/** The names a device is offered under, where its own name is not enough. */
const DEVICE_LABEL: Partial<Record<BadgeDevice, string>> = {
  ball: 'Football',
  hop: 'Hop cone',
  bolt: 'Lightning bolt',
  keys: 'Crossed keys',
  sheaf: 'Sheaf of corn',
  barrels: 'Barrels',
  chequers: 'Chequers',
  fleece: 'A fleece',
  pickaxe: 'Pick and shovel',
};

function deviceLabel(device: BadgeDevice): string {
  return DEVICE_LABEL[device] ?? device.charAt(0).toUpperCase() + device.slice(1);
}

/**
 * Building a club from nothing.
 *
 * Everything a Sunday League club is to look at, decide here: what it is
 * called, what it wears, where it plays, how it is run and how big a club it
 * says it is. The new club inherits the division place, the fixture list and
 * the committee of the weakest side it displaces, but not its players.
 *
 * Nobody hands a new club a squad, so the manager has to buy one. He never
 * chooses his own standing, either: the world decides that from the players he
 * ends up with. What he chooses is his backing — the pot the league, the
 * committee and whatever sponsor he has found will put up — and that budget has
 * to cover both how many players he signs and how good they are. Whatever is
 * left is in the bank on day one, and the standing is whatever the squad he
 * bought is worth, shown here as he spends it.
 *
 * The squad is decided before he commits, too. It is generated from the seed by
 * the very function the career uses, so the players he is shown here are the
 * players he gets — the preview is not a guess at the football, it is the
 * football, right down to the standing it earns him.
 */
export function CreateClubView() {
  const draft = useGameStore((state) => state.draft);
  const geography = useGameStore((state) => state.setup?.geography);

  /**
   * The ladder the club is being built in, which is the whole of the choice it makes.
   *
   * A club built by hand joins the foot of a ladder — the rule the game has always
   * had, and one that does not change because the county now has six of them. What
   * the manager chooses is *which* ladder: the county's own football, or any one of
   * the five districts beside it.
   */
  const ladders = useMemo(() => (draft ? draftLadderOptions(draft).filter(ladder => !geography || ladder.id === geography.pyramidId) : []), [draft, geography]);
  const [ladderId, setLadderId] = useState<PyramidId | null>(null);
  const ladder = ladders.find((entry) => entry.id === ladderId) ?? ladders[0];

  // The division the new club is registered in: the bottom of the ladder he chose.
  const entryDivision = ladder?.divisions[ladder.divisions.length - 1];

  /**
   * The towns he can build in: the region the ladder draws its clubs from.
   *
   * A district club plays in the district, so the towns offered follow the ladder
   * — and the town he had already picked follows it too, because a club whose
   * address is inside one region's football while it plays in another's is not
   * something the world has.
   */
  const towns = useMemo(() => (draft && ladder ? townChoicesFor(draft, ladder.id) : []), [draft, ladder]);

  // The club whose place in the division the new one takes: the weakest side in
  // the bottom division of the ladder he chose, whose registration and committee
  // come across but whose players do not.
  const replaced = useMemo(
    () => (draft && ladder ? draft.clubs[displacedClubId(draft, ladder.id)] ?? null : null),
    [draft, ladder],
  );

  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [nickname, setNickname] = useState('');
  const [motto, setMotto] = useState('');
  const [foundedYear, setFoundedYear] = useState(2010);
  const [primary, setPrimary] = useState('#1f6feb');
  const [secondary, setSecondary] = useState('#ffffff');
  const [badgeShape, setBadgeShape] = useState<BadgePick<BadgeShape>>('auto');
  const [badgePattern, setBadgePattern] = useState<BadgePick<BadgePattern>>('auto');
  const [badgeDevice, setBadgeDevice] = useState<BadgePick<BadgeDevice>>('auto');
  const [structure, setStructure] = useState<ClubStructure>('pub-backed');
  // What the club can put up, and what it does with the money that buys.
  const [backing, setBacking] = useState<ClubBacking>('modest');
  const [standard, setStandard] = useState<SquadStandard>('mid-table');
  const [squadSize, setSquadSize] = useState(18);
  const [townId, setTownId] = useState<TownId>(() => towns[0]?.id ?? '');
  const [groundName, setGroundName] = useState('');
  const [capacity, setCapacity] = useState(500);
  const [surface, setSurface] = useState<GroundSurface>('grass');
  const [error, setError] = useState<string | null>(null);

  const backingOption = CLUB_BACKINGS.find((option) => option.id === backing) ?? CLUB_BACKINGS[1]!;
  const standardOption = squadStandardOption(standard);
  const budget = backingGrant(backing);
  const spend = squadCost(standard, squadSize);
  const left = budget - spend;
  const affordable = spend <= budget;

  // The town actually on the screen: the pick falls back to the first of the
  // ladder's own towns when the manager moves ladder, rather than reporting a
  // town in another region's football.
  const town = towns.find((candidate) => candidate.id === townId) ?? towns[0];

  // What the manager is about to be given, worked out exactly as the career
  // will work it out — same seed, same shopping list, same squad, same ladder.
  const projection = useMemo(() => {
    if (!draft || !ladder) return null;
    const players = squadForCustomClub(draft, {
      squadStandard: standard,
      squadSize,
      townId: town?.id ?? '',
      pyramidId: ladder.id,
    });
    const byGroup: Record<PositionGroup, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    let ageTotal = 0;
    let abilityTotal = 0;
    let youngest = 99;
    let oldest = 0;
    for (const player of players) {
      byGroup[player.positionGroup] += 1;
      ageTotal += player.age;
      abilityTotal += abilityMean(player);
      youngest = Math.min(youngest, player.age);
      oldest = Math.max(oldest, player.age);
    }
    const ability = players.length > 0 ? abilityTotal / players.length : 0;

    // Where that squad would sit in the division. Every club already in it is
    // measured the same way, and the new side is dropped in among them — which
    // is the only honest answer to "how good will this actually be?", because
    // good is a relative word down the park. The division is the one the club is
    // actually joining: the bottom of the ladder he chose, not the county's top
    // division and not another district's.
    const replacedId = displacedClubId(draft, ladder.id);
    const rivals = bottomDivisionClubIds(draft, ladder.id)
      .filter((clubId) => clubId !== replacedId)
      .map((clubId) => {
        const squad = draft.clubs[clubId]!.squadIds
          .map((id) => draft.people[id])
          .filter(isPlayer);
        if (squad.length === 0) return 0;
        return squad.reduce((sum, player) => sum + abilityMean(player), 0) / squad.length;
      });

    return {
      size: players.length,
      byGroup,
      ability,
      averageAge: players.length > 0 ? Math.round((ageTotal / players.length) * 10) / 10 : 0,
      youngest,
      oldest,
      // 1 is the strongest squad in the division.
      rank: rivals.filter((rivalAbility) => rivalAbility > ability).length + 1,
      division: rivals.length + 1,
    };
  }, [draft, ladder, standard, squadSize, town]);

  // Only what he actually decided is kept, so anything he left as "as drawn"
  // is drawn by the generator exactly as it would be for any other club.
  const badge = useMemo(
    () =>
      compactBadge({
        shape: badgeShape === 'auto' ? undefined : badgeShape,
        pattern: badgePattern === 'auto' ? undefined : badgePattern,
        device: badgeDevice === 'auto' ? undefined : badgeDevice,
      }),
    [badgeShape, badgePattern, badgeDevice],
  );

  // The standing the club will actually start with. Nobody chooses it: it is
  // read off the players the budget bought, exactly as the career will read it
  // when it builds them, so the club cannot be called a favourite with a squad
  // that ranks bottom.
  const standing = reputationFromAbility(projection?.ability ?? 0);
  const standingBand = projection ? abilityBandFor(projection.ability) : 'Solid';

  if (!draft || !replaced || !ladder || !entryDivision) return null;

  const named = name.trim().length >= MIN_CLUB_NAME_LENGTH;
  const canRegister = affordable && named && Boolean(town);

  const submit = () => {
    if (!named) {
      setError(`A club needs a name of at least ${MIN_CLUB_NAME_LENGTH} characters.`);
      return;
    }
    if (!town) {
      setError('Choose the town the club plays in.');
      return;
    }
    if (!affordable) {
      setError(`That squad costs ${moneyWhole(spend)} and the club has ${moneyWhole(budget)}.`);
      return;
    }
    gameActions().createCustomClub({
      name,
      shortName,
      nickname,
      motto,
      foundedYear: declaredFoundedYear,
      primary,
      secondary,
      structure,
      backing,
      squadStandard: standard,
      squadSize,
      townId: town.id,
      pyramidId: ladder.id,
      groundName,
      capacity,
      surface,
      badge,
    });
  };

  const colours = { primary, secondary };
  // The year the club will actually be founded in, read through the world's own
  // rule rather than taken from the box: a year too old or too new is adjusted by
  // the career when it builds the club, and the drawing the manager is looking at
  // has to be the same answer, or the preview is a promise the club breaks.
  const declaredFoundedYear = foundedYearWithin(foundedYear, CAREER_START_YEAR);
  // The badge is drawn from a club, so the design is shown as the club it would
  // become: the same shape the game will give it the moment it exists.
  const previewClub = {
    ...replaced,
    identity: { ...replaced.identity, name: name.trim() || replaced.identity.name, shortName, nickname, motto, foundedYear: declaredFoundedYear, colours },
    badge,
  };

  // Deal a badge at random, from the same vocabulary the generator draws on.
  const shuffleBadge = () => {
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
    setBadgeShape(pick(BADGE_SHAPES));
    setBadgePattern(pick(BADGE_PATTERNS));
    setBadgeDevice(pick(BADGE_DEVICES));
  };

  return (
    <div className="create-club">
      <SceneBackdrop />
      <PageHeader
        eyebrow="New club · step 2 of 2"
        title="Design your club"
        photo="/photos/create-club-crest.webp"
        subtitle={`${ladder.name} · seed “${draft.seed}”. Your club joins ${entryDivision.name}, taking the place of ${replaced.identity.name}.`}
        actions={
          <><Button variant="ghost" onClick={() => gameActions().abandonDraft()}>Back</Button><Button variant="primary" onClick={submit} disabled={!canRegister}>Register {name.trim() || 'your club'}</Button></>
        }
      />

      {/* Which ladder the club is built in. A new club has always entered at the
          foot of the county's ladder, and every district of the county is the same
          rule: between them they are five sixths of the world's clubs. */}
      <Panel title="Where your club starts" subtitle={`New clubs join the foot of a ladder — ${entryDivision.name}`}>
        <PyramidPicker
          label="Leagues"
          choices={ladderChoices(ladders, null)}
          selected={ladder.id}
          onSelect={setLadderId}
        />
        <p className="muted small">
          {ladder.name} · {ladder.region} · {ladder.clubCount} clubs. Registering takes{' '}
          {replaced.identity.name}&rsquo;s place at the bottom of it.
        </p>
      </Panel>

      <div className="create-club__grid">
        <div className="create-club__column">
        <Panel title="Identity" subtitle="Name, colours and the club's character">
          <div className="create-club__preview">
            <ClubBadge club={previewClub} size={64} />
            <div>
              <strong>{name.trim() || 'Your club name'}</strong>
              <div className="muted small">{nickname.trim() || shortName.trim() || 'Nickname'}</div>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Club name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Woolpack Wanderers" />
            </label>
            <label className="field">
              <span className="field__label">Short name</span>
              <input className="input" value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="used in tables and news" />
            </label>
            <label className="field">
              <span className="field__label">Nickname</span>
              <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. The Pack" />
            </label>
            <label className="field">
              <span className="field__label">Founded</span>
              <input
                className="input"
                type="number"
                min={EARLIEST_FOUNDED_YEAR}
                max={CAREER_START_YEAR}
                value={foundedYear}
                onChange={(e) => setFoundedYear(Number(e.target.value))}
              />
            </label>
            <label className="field field--wide">
              <span className="field__label">Motto</span>
              <input className="input" value={motto} onChange={(e) => setMotto(e.target.value)} placeholder="one line, the sort that goes on the clubhouse wall" />
            </label>
          </div>
          <div className="create-club__colours">
            <label className="field">
              <span className="field__label">Primary colour</span>
              <input className="input input--colour" type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Secondary colour</span>
              <input className="input input--colour" type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} />
            </label>
          </div>
        </Panel>

        <Panel title="Ground and running" subtitle="Your home in the local game">
          <label className="field">
            <span className="field__label">Town</span>
            <select className="input" value={town?.id ?? ''} onChange={(e) => setTownId(e.target.value)}>
              {towns.map((town) => (
                <option key={town.id} value={town.id}>
                  {town.name} ({town.population.toLocaleString('en-GB')})
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Ground name</span>
              <input className="input" value={groundName} onChange={(e) => setGroundName(e.target.value)} placeholder="e.g. The Rec" />
            </label>
            <label className="field">
              <span className="field__label">Capacity</span>
              <input className="input" type="number" min={50} max={20000} step={50} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
            </label>
            <label className="field">
              <span className="field__label">Surface</span>
              <select className="input" value={surface} onChange={(e) => setSurface(e.target.value as GroundSurface)}>
                {SURFACES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--wide">
              <span className="field__label">How it is run</span>
              <select className="input" value={structure} onChange={(e) => setStructure(e.target.value as ClubStructure)}>
                {STRUCTURES.map((option) => (
                  <option key={option} value={option}>
                    {CLUB_STRUCTURE_LABEL[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Panel>

        </div>
        <div className="create-club__column">
        <Panel
          className="create-club__badge-panel"
          title="Badge"
          subtitle="What goes on the shirts, the letterhead and the corner of the league table"
        >
          <div className="create-club__badge">
            <div className="create-club__badge-art">
              <ClubBadge club={previewClub} size={104} />
              <span className="muted small">As it will be drawn</span>
            </div>
            <div className="create-club__badge-picks">
              <label className="field">
                <span className="field__label">Shape</span>
                <select
                  className="input"
                  value={badgeShape}
                  onChange={(e) => setBadgeShape(e.target.value as BadgePick<BadgeShape>)}
                >
                  <option value="auto">As drawn for {name.trim() || 'the club'}</option>
                  {BADGE_SHAPES.map((option) => (
                    <option key={option} value={option}>
                      {BADGE_SHAPE_LABEL[option]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Pattern</span>
                <select
                  className="input"
                  value={badgePattern}
                  onChange={(e) => setBadgePattern(e.target.value as BadgePick<BadgePattern>)}
                >
                  <option value="auto">As drawn for {name.trim() || 'the club'}</option>
                  {BADGE_PATTERNS.map((option) => (
                    <option key={option} value={option}>
                      {BADGE_PATTERN_LABEL[option]}
                    </option>
                  ))}
                </select>
                <span className="field__hint">
                  Drawn in the second colour, so a club wearing one colour stays plain
                </span>
              </label>
              <label className="field">
                <span className="field__label">Symbol</span>
                <select
                  className="input"
                  value={badgeDevice}
                  onChange={(e) => setBadgeDevice(e.target.value as BadgePick<BadgeDevice>)}
                >
                  <option value="auto">As drawn for {name.trim() || 'the club'}</option>
                  {BADGE_DEVICES.map((option) => (
                    <option key={option} value={option}>
                      {deviceLabel(option)}
                    </option>
                  ))}
                </select>
                <span className="field__hint">
                  Left alone, the club takes the symbol its name asks for — a Hart a stag, the Dockers an anchor
                </span>
              </label>
            </div>
          </div>
          <div className="row">
            <Button variant="ghost" onClick={shuffleBadge}>
              Deal a badge at random
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setBadgeShape('auto');
                setBadgePattern('auto');
                setBadgeDevice('auto');
              }}
              disabled={!badge}
            >
              Let the club choose
            </Button>
          </div>
        </Panel>

        <Panel
          className="create-club__squad"
          title="Squad and budget"
          subtitle="What the club can put up, and the players it buys with it"
        >
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Backing</span>
              <select
                className="input"
                value={backing}
                onChange={(e) => setBacking(e.target.value as ClubBacking)}
              >
                {CLUB_BACKINGS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} · {moneyWhole(option.grant)}
                  </option>
                ))}
              </select>
              <span className="field__hint">{backingOption.blurb}</span>
            </label>
            <label className="field">
              <span className="field__label">Standard of player</span>
              <select
                className="input"
                value={standard}
                onChange={(e) => setStandard(e.target.value as SquadStandard)}
              >
                {SQUAD_STANDARDS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} · {moneyWhole(option.feePerPlayer)} a player
                  </option>
                ))}
              </select>
              <span className="field__hint">{standardOption.blurb}</span>
            </label>
            <label className="field">
              <span className="field__label">Players to sign</span>
              <select className="input" value={squadSize} onChange={(e) => setSquadSize(Number(e.target.value))}>
                {SQUAD_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} players
                  </option>
                ))}
              </select>
              <span className="field__hint">
                {MIN_SQUAD_SIZE}–{MAX_SQUAD_SIZE}, and every one of them has to be paid for
              </span>
            </label>
          </div>

          <div className="budget">
            <span className="budget__label">Budget</span>
            <span className="budget__value">{moneyWhole(budget)}</span>
            <span className="budget__label">Spent</span>
            <span className="budget__value">{moneyWhole(spend)}</span>
            <span className="budget__label">Left in the bank</span>
            <span className={`budget__value${left < 0 ? ' tone tone--bad' : ''}`}>{moneyWhole(left)}</span>
          </div>
          <div className={`budget__bar${left < 0 ? ' budget__bar--over' : ''}`}>
            <span style={{ width: `${Math.min(100, budget > 0 ? (spend / budget) * 100 : 100)}%` }} />
          </div>

          {projection && (
            <>
              <div className="stat-grid stat-grid--wide">
                <Stat label="Squad size" value={projection.size} />
                <Stat
                  label="Average age"
                  value={projection.averageAge}
                  hint={`${projection.youngest}–${projection.oldest} years old`}
                />
                <Stat
                  label="Starting reputation"
                  value={standing}
                  hint={`${standingBand} squad · out of 100`}
                />
                <Stat
                  label="Squad rank"
                  value={`${projection.rank} of ${projection.division}`}
                  hint="Where that squad would sit in the division on ability"
                />
                {POSITION_GROUPS.map((group) => (
                  <Stat key={group} label={GROUP_LABEL[group]} value={projection.byGroup[group]} />
                ))}
              </div>
              <div className="squad-preview__bar">
                {POSITION_GROUPS.map((group) => (
                  <span
                    key={group}
                    className={`squad-preview__seg squad-preview__seg--${group.toLowerCase()}`}
                    style={{ flex: projection.byGroup[group] }}
                    title={`${GROUP_LABEL[group]}: ${projection.byGroup[group]}`}
                  />
                ))}
              </div>
              <p className="muted small">
                Registering takes {replaced.identity.name}&rsquo;s place in the division and these players come in to
                fill it &mdash; you inherit their league place, not their dressing room. Whatever is left of the
                budget is in the bank on day one, and the standing is read off this squad rather than asked for:
                a side built on journeymen is a makeweight whatever the club had to spend.
              </p>
            </>
          )}
        </Panel>
        </div>
      </div>

      <div className="create-club__submit">
        <Button variant="primary" onClick={submit} disabled={!canRegister}>
          Take charge of {name.trim() || 'your club'}
        </Button>
        {!affordable && (
          <p className="tone tone--bad small">
            That squad costs {moneyWhole(spend)} and the club has {moneyWhole(budget)}. Sign fewer players, or a
            cheaper standard.
          </p>
        )}
        {!named && (
          <p className="small muted">
            Give the club a name of at least {MIN_CLUB_NAME_LENGTH} characters to register.
          </p>
        )}
        {affordable && error && <p className="tone tone--bad small" role="alert">{error}</p>}
      </div>
    </div>
  );
}
