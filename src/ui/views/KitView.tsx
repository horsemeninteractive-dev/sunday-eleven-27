import { KIT_COLLAR_LABEL, KIT_PATTERN_LABEL, type KitDesign } from '@/domain/kit';
import { clubKit, clubKitOptions, chosenKitOption, KIT_OPTION_COUNT, sponsorFor } from '../kit';
import { KitSetRow } from '../components/Kit';
import { Button, PageHeader, Pill } from '../components/primitives';
import { gameActions, useGame, useUserClub } from '../hooks';
import { MetricTile, Section, StatusTile, TileGrid } from '../components/hierarchy';

/**
 * The club's kit.
 *
 * Three strips, one kit deal, and — because this is a game about a club you
 * run — the choice of which design the club wears this season. The designs are
 * generated fresh every summer, all in the club's own colours, and the screen
 * shows the chosen one first, the deal as four facts, and the alternatives as
 * one block with a button each.
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
          </>
        }
      />

      <Section
        title="The strip"
        action={<span className="small muted">Design {chosen + 1} of {KIT_OPTION_COUNT}</span>}
      >
        <KitSetRow club={club} kit={kit} size={124} />
      </Section>

      <Section title="Details">
        <TileGrid min={170}>
          <StatusTile
            label="Shirt sponsor"
            status={sponsor ? sponsor.name : 'None'}
            note={`£${club.finances.sponsorIncomePerWeek} a week`}
            tone={sponsor ? 'ok' : 'muted'}
          />
          <MetricTile label="Kit firm" value={kit.maker.name} note={`${kit.season} season`} />
          <MetricTile
            label="Design"
            value={`${chosen + 1} of ${KIT_OPTION_COUNT}`}
            note="Chosen by the manager"
          />
          <MetricTile
            label="Club colours"
            value={
              <span className="row row--tight">
                <span className="kitswatch" style={{ background: club.identity.colours.primary }} aria-hidden="true" />
                <span className="kitswatch" style={{ background: club.identity.colours.secondary }} aria-hidden="true" />
              </span>
            }
            note={`${club.identity.colours.primary} · ${club.identity.colours.secondary}`}
          />
        </TileGrid>
      </Section>

      <Section
        title="This season's designs"
        action={<span className="small muted">{options.length} sent down</span>}
      >
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
      </Section>

      <Section title="Kit bag">
        <TileGrid min={215}>
          <MetricTile label="Home" value={describeStrip(kit.home)} />
          <MetricTile label="Away" value={describeStrip(kit.away)} />
          <MetricTile label="Goalkeeper" value={describeStrip(kit.goalkeeper)} />
        </TileGrid>
      </Section>
    </div>
  );
}

/** "stripes, V-neck" — the way a kit is described in a catalogue. */
function describeStrip(design: KitDesign): string {
  const pattern = design.pattern === 'plain' ? 'a plain shirt' : KIT_PATTERN_LABEL[design.pattern];
  return `${pattern}, ${KIT_COLLAR_LABEL[design.collar]}`;
}
