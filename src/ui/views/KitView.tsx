import { KIT_COLLAR_LABEL, KIT_PATTERN_LABEL, type KitDesign } from '@/domain/kit';
import { clubKit, clubKitOptions, chosenKitOption, KIT_OPTION_COUNT, sponsorFor } from '../kit';
import { KitSetRow } from '../components/Kit';
import { Button, PageHeader, Panel, Pill, Stat } from '../components/primitives';
import { gameActions, useGame, useUserClub } from '../hooks';

/**
 * The club's kit.
 *
 * Three strips, one kit deal, and — because this is a game about a club you
 * run — the choice of which design the club wears this season. The designs are
 * generated fresh every summer, all in the club's own colours, and all the
 * manager has to do is pick the one he wants the lads to run out in.
 *
 * The screen only ever shows the *club's* kit: everybody else's is on their
 * profile, where it belongs.
 */
export function KitView() {
  const game = useGame();
  const club = useUserClub();
  if (!game || !club) return null;

  const kit = clubKit(game, club.id);
  const options = clubKitOptions(game, club.id);
  if (!kit) return null;

  const chosen = chosenKitOption(club);
  const sponsor = sponsorFor(game, club);
  const business = sponsor?.businessId ? game.world.businesses[sponsor.businessId] : undefined;
  const businessTown = business ? game.world.towns[business.townId]?.name : undefined;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title="The kit"
        subtitle={`${kit.season} · ${kit.maker.name}${sponsor ? ` · ${sponsor.name}` : ' · no shirt sponsor'}`}
        meta={
          <>
            <span className="small muted">
              Design {chosen + 1} of {KIT_OPTION_COUNT}
            </span>
            <span className="row row--tight">
              <span className="small muted">Club colours</span>
              <span className="kitswatch" style={{ background: club.identity.colours.primary }} aria-hidden="true" />
              <span className="kitswatch" style={{ background: club.identity.colours.secondary }} aria-hidden="true" />
            </span>
            {business && (
              <span className="small muted">
                Backed by {business.name} of {businessTown ?? 'the town'}
              </span>
            )}
          </>
        }
      />

      <Panel
        title="What we run out in"
        subtitle={`Chosen by the manager · design ${chosen + 1}`}
        level="primary"
      >
        <KitSetRow club={club} kit={kit} size={124} />
        <p className="muted small">
          {kit.sponsor
            ? `${kit.sponsor.name} across the chest, ${kit.maker.name} on the right breast, and the crest over the heart.`
            : `Nobody's name across the chest this season — ${kit.maker.name} make the shirts and that is all.`}
        </p>
      </Panel>

      <Panel title="This season's designs" subtitle="Three sets were sent down. The club wears one of them.">
        <div className="kitoptions">
          {options.map((option, index) => (
            <div className={`kitoption${index === chosen ? ' kitoption--chosen' : ''}`} key={option.option}>
              <div className="kitoption__head">
                <strong>Design {index + 1}</strong>
                {index === chosen ? (
                  <Pill tone="ok">what we wear</Pill>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => gameActions().chooseKit(index)}
                    title={`Wear design ${index + 1} this season`}
                  >
                    Wear this one
                  </Button>
                )}
              </div>
              <KitSetRow club={club} kit={option} size={62} />
            </div>
          ))}
        </div>
        <p className="muted small">
          A new set is drawn up every summer, when the kit deal comes round again. The colours never change — they are the
          club's — but the shirts do.
        </p>
      </Panel>

      <div className="split split--sidebar">
        <Panel title="The deal" level="default">
          <div className="stat-grid stat-grid--wide">
            <Stat label="Kit firm" value={kit.maker.name} hint="Shirts, shorts and socks" />
            <Stat label="Season" value={kit.season} hint="New designs every summer" />
            <Stat
              label="Shirt sponsor"
              value={sponsor ? sponsor.name : 'None'}
              hint={sponsor ? `£${club.finances.sponsorIncomePerWeek}/week` : 'An empty chest'}
            />
            <Stat label="Design" value={`${chosen + 1} of ${KIT_OPTION_COUNT}`} hint="Pick another above" />
          </div>
        </Panel>

        <Panel title="Kit bag" level="quiet" subtitle="What is in the cupboard">
          <ul className="bullets">
            <li>Home: {describeStrip(kit.home)} — the club's own colours, as always.</li>
            <li>Away: {describeStrip(kit.away)} — for when we clash.</li>
            <li>
              Goalkeeper: {describeStrip(kit.goalkeeper)}. Keeper shirts are always somebody else's problem to match.
            </li>
          </ul>
          <p className="muted small">
            {sponsor
              ? `The name on the chest is the club's, not the manager's: it comes with the deal and it goes across all three strips.`
              : 'No shirt sponsor this season, which is common enough at this level — and it means a blank chest on all three strips.'}
          </p>
        </Panel>
      </div>
    </div>
  );
}

/** "stripes, V-neck" — the way a kit is described in a catalogue. */
function describeStrip(design: KitDesign): string {
  const pattern = design.pattern === 'plain' ? 'a plain shirt' : KIT_PATTERN_LABEL[design.pattern];
  return `${pattern}, ${KIT_COLLAR_LABEL[design.collar]}`;
}
