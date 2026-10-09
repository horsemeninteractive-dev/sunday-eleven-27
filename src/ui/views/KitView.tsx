import { KIT_COLLAR_LABEL, KIT_PATTERN_LABEL, type KitDesign } from '@/domain/kit';
import { weeklySponsorshipIncome } from '@/simulation/sponsorship';
import { clubKit, clubKitOptions, chosenKitOption, KIT_OPTION_COUNT, sponsorFor } from '../kit';
import { KitSetRow } from '../components/Kit';
import { SponsorMark } from '../components/SponsorMark';
import { sponsorBrand } from '../sponsorMark';
import { Button, PageHeader, Pill } from '../components/primitives';
import { gameActions, useGame, useUserClub } from '../hooks';
import { MetricTile, Section, StatusTile, TileGrid } from '../components/hierarchy';

/**
 * The club's kit.
 *
 * Three strips, one kit deal, and — because this is a game about a club you
 * run — the choice of which design the club wears this season. The designs are
 * generated fresh every summer, all in the club's own colours.
 *
 * The screen is that one choice drawn twice: the kit the club will wear in the
 * left hand column, and the three it could have worn down the right, each with
 * the button that changes it. Deciding means holding the alternatives next to
 * the answer, which a chosen kit at the top of a single column could not do — by
 * the time the designs were on screen the thing they were being compared with
 * had scrolled away. What is left over, the maker, the sponsor and the colours,
 * is behind the door at the foot, because none of it is a decision.
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
  // The sponsor as a mark, where it is a business with a trade to draw.
  const sponsorMark = sponsor ? sponsorBrand(sponsor) : null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        actions={
          <Button variant="ghost" onClick={() => gameActions().setView('dashboard')}>
            Back to the club
          </Button>
        }
        title="The kit"
        subtitle={
          <span className="row row--tight">
            {sponsorMark && <SponsorMark business={sponsorMark} height={20} />}
            <span>{`${kit.season} · ${kit.maker.name}${sponsor ? ` · ${sponsor.name}` : ' · no shirt sponsor'}`}</span>
          </span>
        }
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

      {/* The decision, twice over: the kit the club wears on the left, the three
          designs it could have worn on the right. Which of the two sits beside
          the other is a wide screen's business, so it is the stylesheet's job and
          not this one's — on a phone the same two boxes stack. */}
      <div className="kitscreen">
        <div className="kitscreen__chosen">
          <Section title="The strip" action={<Pill tone="ok">what we wear</Pill>}>
            <KitSetRow club={club} kit={kit} size={168} />
          </Section>

          {/* The facts that are not a decision, under the kit they are facts
              about. They were behind a door at the foot of the page; on a screen
              whose left hand column would otherwise end a hundred pixels above the
              right, they are also what that column's height is paid for with.

              The design number is deliberately not one of them — it is in the
              header and on the pill — and neither are the three strip
              descriptions, which say in pixels what the captions under the shirts
              above already say in words. Those stay behind their door. */}
          <Section title="The kit deal">
            {/* The sponsor's own board, where there is a sponsor to draw one
                for: on a screen about what the club wears, the mark is the
                thing the manager recognises on his own shirt. */}
            {sponsorMark && (
              <div className="row row--wrap">
                <SponsorMark business={sponsorMark} height={56} />
              </div>
            )}
            <TileGrid min={150}>
              <StatusTile
                label="Shirt sponsor"
                status={sponsor ? sponsor.name : 'None'}
                note={sponsor ? `£${weeklySponsorshipIncome(game, club.id)} a week` : 'No deal'}
                tone={sponsor ? 'ok' : 'muted'}
              />
              <MetricTile label="Kit firm" value={kit.maker.name} note={`${kit.season} season`} />
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
        </div>

        <div className="kitscreen__options">
          <Section
            title="This season's designs"
            action={<span className="small muted">{options.length} sent down</span>}
          >
            <div className="kitoptions kitoptions--stack">
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
        </div>
      </div>

      <details className="more"><summary>Strip descriptions</summary><Section>
        <TileGrid min={215}>
          <MetricTile label="Home" value={describeStrip(kit.home)} />
          <MetricTile label="Away" value={describeStrip(kit.away)} />
          <MetricTile label="Goalkeeper" value={describeStrip(kit.goalkeeper)} />
        </TileGrid>
      </Section></details>
    </div>
  );
}

/** "stripes, V-neck" — the way a kit is described in a catalogue. */
function describeStrip(design: KitDesign): string {
  const pattern = design.pattern === 'plain' ? 'a plain shirt' : KIT_PATTERN_LABEL[design.pattern];
  return `${pattern}, ${KIT_COLLAR_LABEL[design.collar]}`;
}
