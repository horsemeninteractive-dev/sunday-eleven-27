import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PYRAMID, SECOND_PYRAMID_CONFIG } from '@/domain/competition';
import { ALDERLAND, countyGeography, districtGeography, LABEL_FONT, labelLines } from '@/geography/alderland';
import { bounds, fitPoints, overlapArea, ringPath, type LabelBox, type Point, type Ring } from '@/geography/geometry';
import { NATIONAL_SELECTION, selectAtlasCounty, selectAtlasDistrict } from '@/geography/selection';
import { useGameStore } from '@/state/gameStore';
import { currentMotion } from '@/state/preferences';
import { gameActions } from '../hooks';
import { Button, PageHeader } from '../components/primitives';
import { SceneBackdrop } from '../components/SceneBackdrop';
import './geography.css';

type ViewBox = readonly [number, number, number, number];
const NATIONAL_BOX: ViewBox = [40,25,865,1125];
/** The size a town's name is drawn at on the district map, in screen pixels. The
 * district view is zoomed several times closer than the county one, so the same
 * number in atlas units would be a caption across half the district: the size is
 * converted through the frame, exactly as the district names' is. A phone draws
 * the same district in a third of the pixels, so a district's names are asked for
 * a shade smaller there.
 */
export const TOWN_LABEL_PX = 10.5;
export const TOWN_LABEL_PX_SHORT = 9;
/** A neighbouring district's name, at the district level: its own label size is
 * the county's, and at this zoom that is a word across half the page. */
const NEIGHBOUR_LABEL_PX = 12.5;
/** How long the zoom into a district runs before its world is asked for. The
 * towns are a fact about the seed and have to be built; building them inside the
 * click would freeze the map mid-zoom, so the wait is spent behind the zoom.
 * Matches `useAtlasViewport`'s transition — and a reduced-motion manager, who has
 * no transition to hide behind, waits for nothing.
 */
const ZOOM_MS = 480;

function useAtlasViewport(target: ViewBox) {
  const [viewport, setViewport] = useState<ViewBox>(target);
  const current = useRef(viewport);
  const key = target.join(',');
  useEffect(() => {
    const to = key.split(',').map(Number) as unknown as ViewBox;
    const from = current.current;
    if (currentMotion() === 'reduced') {
      current.current = to; setViewport(to); return;
    }
    let frame = 0;
    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / ZOOM_MS);
      const eased = t * t * (3 - 2 * t);
      const next = from.map((v,i) => v + (to[i]! - v) * eased) as unknown as ViewBox;
      current.current = next; setViewport(next);
      if (t < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    // An animation is frames queued one after another, so a window that is not
    // compositing — a backgrounded tab, a hidden page — can be starved of them and
    // leave the map at the previous frame's scale, with the district's names sized
    // for a frame it never arrived at. The map therefore ends where it was going
    // whether or not its frames ran.
    const arriving = window.setTimeout(() => {
      cancelAnimationFrame(frame);
      current.current = to; setViewport(to);
    }, ZOOM_MS + 400);
    return () => { cancelAnimationFrame(frame); clearTimeout(arriving); };
  }, [key]);
  return viewport.join(' ');
}
function Label({ name, anchor, size, scale = 1, available }: { name:string; anchor:Point; size:number; scale?:number; available:boolean|null }) {
  // A crowded region is drawn at the size the placement pass reserved for it, so
  // the box on the screen is the box the map avoided a collision in.
  size *= scale;
  // County names remain intact; long local names break at authored word groups.
  // The same authored breaks the placement pass measured with, so a name cannot
  // be laid out one way here and reserved a different way on the map.
  const lines = labelLines(name);
  return <text className="atlas__label" x={anchor[0]} y={anchor[1]} fontSize={size} textAnchor="middle" aria-hidden="true">
    {lines.map((line,i) => <tspan key={line} x={anchor[0]} dy={i === 0 ? 0 : size * 1.15}>{line}</tspan>)}
    {/* A town's name is a name and nothing else: it is not a place with football
        of its own, so it wears no availability line. */}
    {available !== null && <tspan className="atlas__availability" x={anchor[0]} dy={size * 1.2} fontSize={size * .72}>{available ? '● AVAILABLE' : 'LOCKED'}</tspan>}
  </text>;
}

/** One of a district's settlements, as the district map draws it. */
export interface TownMark {
  id: string; name: string;
  /** The town's own place on the map, fitted into the district: a mark that
   * moved to make room for a name would be a town drawn where it is not. */
  dot: Point;
  /** Where its name is drawn: the same column as its dot, walked up or down as
   * far as it had to be to clear the names already there. */
  anchor: Point;
  side: 'left' | 'right';
  /** The room the placement reserved for this name, in atlas units. Carried out
   * so the map's own tests measure what was drawn rather than re-deriving it
   * from the numbers that placed it. */
  box: LabelBox;
}
/** How many label sizes a name may be walked away from its dot to find room, and
 * how big one step is. Both are counts of label sizes rather than atlas units,
 * so a name is moved by the same amount of *its own* height at any zoom. */
export const TOWN_LABEL_TRIES = 10;
export const TOWN_LABEL_STEP = 1.45;
/** How wide one character of a town's name is, in ems, as the browser draws it.
 *
 * A region's name is set in Georgia and measured by the atlas's own `labelBox`;
 * a town's name is set in the UI's sans with the letter-spacing the sheet gives
 * it, which is a wider setting, so it is measured here. The number comes from
 * the page rather than from arithmetic: on drawn district maps these names
 * advance 0.50–0.79 em per character, so a box reserved at the atlas's own 0.56
 * would be narrower than the name drawn in it, and two names could be placed as
 * if they were clear of each other when they are not.
 */
export const TOWN_LABEL_ADVANCE = 0.78;
/** How tall a town's name is drawn, in ems: cap to descender, as the page
 * measures it (1.21 em), with the little slack a name needs to stay clear. */
const TOWN_LABEL_HEIGHT = 1.25;

/** The room a town's name takes, in atlas units. */
export function townLabelBox(name: string, size: number) {
  return { width: name.length * size * TOWN_LABEL_ADVANCE, height: size * TOWN_LABEL_HEIGHT };
}

/**
 * The towns a district map draws: the settlements the region holds, fitted into
 * its shape (see `fitPoints`), each with the room its name needs.
 *
 * The name is put on the side of the mark with more district to spare and then
 * walked up or down past anything already there, nearest its dot first — a knot
 * of settlements with two names on top of each other reads as one town. Laying
 * names down one at a time is order-dependent, so once everybody has a place the
 * pass is swept again: a name a later one crowded out can be the name that
 * moves, and because a sweep only ever moves a name to somewhere it collides
 * less, the sweeps settle. A name that finds no room at all is drawn where it
 * belongs anyway: a crowded corner is better than a town marked in a place it is
 * not.
 */
export function townMarks(
  ring: Ring,
  interior: Point,
  towns: readonly { id: string; name: string; x: number; y: number }[],
  size: number,
): TownMark[] {
  const anchors = fitPoints(ring, towns, { interior });
  const frame = bounds(ring);
  const gap = size * 0.9;
  const step = size * TOWN_LABEL_STEP;
  const marks = towns.map((town, index) => {
    const dot = anchors[index]!;
    const label = townLabelBox(town.name, size);
    // The side with room to spare: a name walked out to the edge of its own
    // district ends up back over the boundary it came from.
    const room = (side: 'left' | 'right') => {
      const from = side === 'right' ? dot[0] + gap : dot[0] - gap - label.width;
      return Math.min(from + label.width, frame.x + frame.width) - Math.max(from, frame.x);
    };
    return {
      id: town.id, name: town.name, dot, width: label.width, height: label.height,
      side: (room('right') >= room('left') ? 'right' : 'left') as 'left' | 'right',
    };
  });
  const rectAt = (mark: (typeof marks)[number], side: 'left' | 'right', centreY: number): LabelBox => {
    const from = side === 'right' ? mark.dot[0] + gap : mark.dot[0] - gap - mark.width;
    return { left: from, right: from + mark.width, top: centreY - mark.height / 2, bottom: centreY + mark.height / 2 };
  };
  // The spots a name is tried in, nearest its dot first, both sides of it at
  // every step out to the last: a name is only ever as far from its town as it
  // had to be, and the other side is asked throughout rather than as a fallback,
  // because where a knot of settlements sits against one boundary, half of them
  // are better named on the inside of it.
  const spotsFor = (mark: (typeof marks)[number]) => {
    const spots: { side: 'left' | 'right'; centreY: number; rect: LabelBox }[] = [];
    const other = mark.side === 'right' ? 'left' as const : 'right' as const;
    for (let tries = 0; tries <= TOWN_LABEL_TRIES; tries++) for (const offset of tries === 0 ? [0] : [tries, -tries]) for (const side of [mark.side, other]) {
      const centreY = mark.dot[1] + offset * step;
      spots.push({ side, centreY, rect: rectAt(mark, side, centreY) });
    }
    return spots;
  };
  /** What this name would take given the rooms already spoken for: the nearest
   * spot that collides with nothing, or, on a map with no room left anywhere,
   * the one it collides with least. */
  const bestSpot = (mark: (typeof marks)[number], taken: readonly LabelBox[]) => {
    let best: ReturnType<typeof spotsFor>[number] | null = null;
    let least = Infinity;
    for (const spot of spotsFor(mark)) {
      const overlap = taken.reduce((sum, rect) => sum + overlapArea(spot.rect, rect), 0);
      if (overlap === 0) return spot;
      if (overlap < least) { least = overlap; best = spot; }
    }
    return best!;
  };
  // A tied y is settled by id, so the same world always draws the same map.
  const order = [...marks].sort((a, b) => a.dot[1] - b.dot[1] || a.id.localeCompare(b.id));
  const chosen = new Map<string, { side: 'left' | 'right'; centreY: number; rect: LabelBox }>();
  // Only the rooms a name has actually been given count as taken: while the first
  // pass is still walking down the district, the names below it have no place yet
  // and cannot block it.
  const takenBy = (id: string) => marks.flatMap(mark => mark.id !== id && chosen.has(mark.id) ? [chosen.get(mark.id)!.rect] : []);
  for (const mark of order) chosen.set(mark.id, bestSpot(mark, takenBy(mark.id)));
  for (let sweep = 0; sweep < 4; sweep++) {
    let moved = false;
    for (const mark of order) {
      const current = chosen.get(mark.id)!;
      const taken = takenBy(mark.id);
      const overlap = (spot: typeof current) => taken.reduce((sum, rect) => sum + overlapArea(spot.rect, rect), 0);
      const better = bestSpot(mark, taken);
      if (overlap(better) < overlap(current)) { chosen.set(mark.id, better); moved = true; }
    }
    if (!moved) break;
  }
  return marks.map(mark => {
    const spot = chosen.get(mark.id)!;
    return { id: mark.id, name: mark.name, dot: mark.dot, anchor: [mark.dot[0], spot.centreY] as Point, side: spot.side, box: spot.rect };
  });
}

/**
 * The frame the atlas is drawn in at a level: the place itself with room around
 * it, so the map is the subject rather than a shape pushed against an edge. The
 * district is framed tighter than the county is — at this level the subject is
 * one district's own ground, and the map should feel like a page turned rather
 * than a smaller version of the page before.
 */
export function atlasFrame(level: 'national' | 'county' | 'district', polygon: Ring | null | undefined): ViewBox {
  if (level === 'national' || !polygon) return NATIONAL_BOX;
  const box = bounds(polygon);
  if (level === 'district') {
    const pad = Math.max(8, Math.min(box.width, box.height) * 0.12);
    return [box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2];
  }
  return [box.x - 18, box.y - 24, box.width + 36, box.height + 48];
}

/**
 * What one screen pixel is worth in atlas units when that frame is drawn into a
 * panel of this size.
 *
 * An SVG fits its viewBox by the shorter of the two ratios and letterboxes the
 * other, so a frame that does not have the panel's own shape is not drawn at the
 * panel's width divided by the frame's. A district's names are asked for in
 * screen pixels — at that zoom an atlas unit is a large piece of ground — so this
 * is the scale they are converted through, and a map measured by the wrong one
 * is a map whose names are drawn half the size they were asked for.
 */
export function unitsPerPixel(frame: ViewBox, panel: { width: number; height: number }) {
  return Math.max(frame[2] / Math.max(1, panel.width), frame[3] / Math.max(1, panel.height));
}

export function GeographySelectView() {
  const setup = useGameStore(state => state.setup);
  const draft = useGameStore(state => state.draft);
  const [selection, setSelection] = useState(NATIONAL_SELECTION);
  const [submitting, setSubmitting] = useState(false);
  const [reading, setReading] = useState(false);
  const submission = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const [panel, setPanel] = useState({ width: 700, height: 520 });
  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setPanel({ width: box.width, height: box.height });
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const county = selection.countyId ? countyGeography(selection.countyId) : undefined;
  const district = county && selection.districtId ? districtGeography(county.id, selection.districtId) : undefined;
  const level = district ? 'district' : county ? 'county' : 'national';
  const target = atlasFrame(level, district?.polygon ?? county?.polygon);
  const viewBox = useAtlasViewport(target);
  // The placement is solved at the largest size any view draws
  // (`LABEL_FONT`), which is the narrow-screen one: the wide layout is then
  // strictly easier, so a phone cannot reintroduce a collision.
  const labelSize = county ? LABEL_FONT.district : panel.width < 500 ? LABEL_FONT.national : 17;
  useEffect(() => {
    if (county) svg.current?.querySelector<SVGPathElement>('[data-available="true"][data-district]')?.focus();
  }, [county]);
  // The settlements the district holds — a fact about the seed, so the world has
  // to have been built. Until it has, the district's map is its own outline and
  // its features: the page is drawn, the towns are still being read.
  const regionTowns = useMemo(() => {
    if (!draft || !district) return [];
    return draft.world.townIds
      .map(id => draft.world.towns[id])
      .filter((town): town is NonNullable<typeof town> => Boolean(town) && town.regionId === district.id)
      .sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));
  }, [draft, district?.id]);
  // A district page is zoomed several times closer than the county one, so every
  // size at this level is asked for in screen pixels and converted through the
  // frame and the panel it is drawn into: the same numbers in atlas units would
  // be captions across the district.
  const unitsPerPx = unitsPerPixel(target, panel);
  const short = panel.width < 500;
  const townSize = district ? (short ? TOWN_LABEL_PX_SHORT : TOWN_LABEL_PX) * unitsPerPx : 0;
  const neighbourSize = district ? (short ? 11 : NEIGHBOUR_LABEL_PX) * unitsPerPx : 0;
  const marks = useMemo(() => {
    if (!district || regionTowns.length === 0) return [];
    return townMarks(district.polygon, district.label, regionTowns, townSize);
  }, [district?.id, regionTowns, townSize]);
  if (!setup) return null;
  const config = district?.football?.pyramidId ? DEFAULT_PYRAMID : SECOND_PYRAMID_CONFIG;
  const up = () => {
    if (submitting) return;
    if (district) setSelection(state => (state.countyId ? selectAtlasCounty(state, state.countyId) : NATIONAL_SELECTION));
    else if (county) setSelection(NATIONAL_SELECTION);
    requestAnimationFrame(() => svg.current?.querySelector<SVGPathElement>('[data-available="true"]')?.focus());
  };
  // Opening a district moves the map first and asks for its world after, so the
  // zoom is what the manager watches rather than a button waiting on a seed.
  const openDistrict = (id: string) => {
    if (!county || submitting) return;
    setSelection(state => selectAtlasDistrict(state, id));
    setReading(true);
    window.setTimeout(() => {
      gameActions().previewDistrict(county.id, id);
      setReading(false);
    }, currentMotion() === 'reduced' ? 0 : ZOOM_MS);
  };
  const confirm = () => {
    if (!county || !district?.football || submission.current) return;
    submission.current = true; setSubmitting(true);
    // Paint the loading state before the existing synchronous generator runs.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ok = gameActions().confirmGeography(county.id, district.id);
      if (!ok) { submission.current = false; setSubmitting(false); }
    }));
  };
  const title = district ? district.name : county ? county.name : 'Find your local game';
  const masthead = level === 'district' ? `${county!.name.toUpperCase()} · DISTRICT ATLAS` : level === 'county' ? 'LOCAL FOOTBALL DISTRICTS' : 'ALDERLAND · COUNTY ATLAS';
  const mapLabel = level === 'district' ? `${district!.name}, its towns and features` : level === 'county' ? `${county!.name}, six districts` : 'Alderland, eighteen counties';
  return <div className={`geography-select geography-select--${level}`}>
    {/* The same ground every pre-game screen stands on: this is the third step
        of one flow, not a screen of its own. */}
    <SceneBackdrop />
    <PageHeader eyebrow="New career · Alderland" title={title}
      subtitle={level === 'district'
        ? 'Step 2 of 3 · This district and the towns inside it. Choose another on the map, or confirm below.'
        : 'Step 2 of 3 · A country of eighteen counties. Your football starts in one district.'}
      actions={<Button variant="ghost" disabled={submitting} onClick={() => gameActions().setView('profile')}>Back to profile</Button>} />
    <div className="atlas-layout">
      <section className="atlas" aria-label={level === 'district' ? 'District atlas' : level === 'county' ? 'County district atlas' : 'National county atlas'}>
        <div className="atlas__masthead"><span>{masthead}</span>
          {level === 'national' ? <span className="atlas__north">N ↑</span>
            : <button className="atlas__back" type="button" onClick={up} disabled={submitting}>{level === 'district' ? '← All districts' : '← National map'}</button>}
        </div>
        <svg ref={svg} className="atlas__map" viewBox={viewBox} role="group" aria-label={mapLabel}
          onKeyDown={event => { if (event.key === 'Escape' && level !== 'national' && !submitting) up(); }}>
          <defs><clipPath id="atlas-land"><path d={ringPath(ALDERLAND.outline)} /></clipPath></defs>
          <path className="atlas__coast-shadow" d={ringPath(ALDERLAND.outline)} />
          {ALDERLAND.counties.map(region => <path key={region.id} d={ringPath(region.polygon)}
            className={`atlas__region${region.availability === 'available' ? ' atlas__region--available' : ''}${county ? ' atlas__region--context' : ''}`}
            role={county ? undefined : 'button'} tabIndex={county || submitting ? -1 : 0}
            aria-hidden={county ? true : undefined}
            aria-label={county ? undefined : `${region.name}, ${region.availability === 'available' ? 'available' : 'locked'}`}
            aria-disabled={county ? undefined : submitting || region.availability === 'locked'} data-available={region.availability === 'available'}
            data-county={region.id}
            onClick={() => { if (!county && !submitting) setSelection(state => selectAtlasCounty(state, region.id)); }}
            onKeyDown={event => { if (!county && !submitting && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelection(state => selectAtlasCounty(state,region.id)); } }} />)}
          {county?.districts.map(region => <path key={region.id} d={ringPath(region.polygon)} role="button" tabIndex={submitting ? -1 : 0}
            aria-label={`${region.name}, ${region.availability === 'available' ? 'available' : 'locked'}`} aria-disabled={submitting || region.availability === 'locked'}
            aria-pressed={district?.id === region.id} data-district={region.id} data-available={region.availability === 'available'}
            className={`atlas__region atlas__district${region.availability === 'available' ? ' atlas__region--available' : ''}${district?.id === region.id ? ' atlas__region--selected' : ''}`}
            onClick={() => openDistrict(region.id)}
            onKeyDown={event => { if (!submitting && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDistrict(region.id); } }} />)}
          <g clipPath="url(#atlas-land)" className="atlas__features" aria-hidden="true">
            {ALDERLAND.features.map(feature => <polyline key={feature.id} points={feature.points.map(p => p.join(',')).join(' ')} className={`atlas__${feature.kind}`} />)}
          </g>
          <path className="atlas__coast" d={ringPath(district?.polygon ?? county?.polygon ?? ALDERLAND.outline)} />
          {/* The district's own settlements, drawn over its ground: the places a
              club in this district can come from, which is what the map is for. */}
          {level === 'district' && <g className="atlas__towns">
            {marks.map(mark => <g key={mark.id} className="atlas__town" data-town={mark.id}>
              <circle className="atlas__town-dot" cx={mark.dot[0]} cy={mark.dot[1]} r={Math.max(0.6, townSize * 0.62)} />
              {/* The name is drawn from the room the placement reserved for it, so
                  the box the map measured a collision against is the box it draws. */}
              <text className="atlas__town-name" x={mark.side === 'right' ? mark.box.left : mark.box.right} y={mark.anchor[1]}
                fontSize={townSize} textAnchor={mark.side === 'right' ? 'start' : 'end'} dominantBaseline="middle">{mark.name}</text>
            </g>)}
          </g>}
          {level === 'national' && ALDERLAND.counties.map(region => <Label key={region.id} name={region.name} anchor={region.label} size={labelSize} scale={region.labelScale} available={region.availability === 'available'} />)}
          {level === 'county' && county!.districts.map(region => <Label key={region.id} name={region.name} anchor={region.label} size={labelSize} scale={region.labelScale} available={region.availability === 'available'} />)}
          {/* At district level the neighbours are named and not read: the one whose
              page this is already has its name in the heading. */}
          {level === 'district' && county!.districts.filter(region => region.id !== district!.id).map(region =>
            <g key={region.id} className="atlas__neighbour"><Label name={region.name} anchor={region.label} size={neighbourSize} available={null} /></g>)}
          {level === 'national' && <g className="atlas__sea-labels" aria-hidden="true"><text x="165" y="445" transform="rotate(-78 165 445)">WESTERN SOUND</text><text x="760" y="230" transform="rotate(65 760 230)">MARCH SEA</text><text x="580" y="1115">BELLAMERE CHANNEL</text></g>}
        </svg>
        <div className="atlas__legend">
          <span><i /> Available football</span><span><i className="atlas__key--locked" /> Mapped · locked</span>
          {level === 'district' && <span><i className="atlas__key--town" /> Towns</span>}
          <span>Tab + Enter to explore · Esc to zoom out</span>
        </div>
      </section>
      <aside className="atlas-info" aria-label="Your football district">
        <p className="eyebrow">{level === 'national' ? 'The country' : level === 'county' ? 'The county' : 'The district'}</p>
        <h2>{title}</h2>
        <p>{county?.character ?? 'From the western fells to the Calder estuary, market towns and river valleys give each county its own local game.'}</p>
        <p className="atlas-info__status" role="status" aria-live="polite">{reading ? 'Reading your seed’s towns…' : selection.message}</p>
        {district && level === 'district' && regionTowns.length > 0 && <p className="small muted atlas-info__towns">
          <strong>{regionTowns.length} towns</strong> · {regionTowns.map(town => town.name).join(' · ')}
        </p>}
        {district && <><p>{district.football?.pyramidId ? 'The founding pyramid' : 'One of the county’s six districts'} · {config.tiers} divisions · {config.clubsPerTier} clubs per division.</p>
          <p className="small muted">All six districts meet in the Alderfordshire County Cup. Each keeps its own League Cup and Plate. The district's name is the map's, and the towns, clubs and people inside it are your seed's.</p></>}
        {level === 'national' && <p className="small muted">Alderfordshire is available now. Seventeen counties remain locked; mapping a place does not open its football.</p>}
        {level === 'county' && <p className="small muted">All six districts of Alderfordshire play football: pick the one your career starts in.</p>}
        <Button variant="primary" disabled={!district?.football || submitting} onClick={confirm}>{submitting ? 'Building your football world…' : district ? `Continue in ${district.name}` : 'Choose a district on the map'}</Button>
        <p className="small muted">{setup.profile.firstName} {setup.profile.surname} · {setup.mode === 'create-club' ? 'Create a club' : 'Take over a club'}</p>
      </aside>
    </div>
  </div>;
}
