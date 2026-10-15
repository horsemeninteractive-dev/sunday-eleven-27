/** Atlas units, not latitude/longitude. Rings are implicit-closed, simple, hole-free.
 * Coordinate/area tolerance is 1e-7 units. This is an authored planar atlas, not
 * a GIS boolean engine: partition validation requires identical atomic edges.
 */
export type Point = readonly [number, number];
export type Ring = readonly Point[];
export const GEOMETRY_EPSILON = 1e-7;
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export const samePoint = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < GEOMETRY_EPSILON && Math.abs(a[1] - b[1]) < GEOMETRY_EPSILON;
export function onSegment(p: Point, a: Point, b: Point): boolean {
  return Math.abs(cross(a, b, p)) < GEOMETRY_EPSILON && p[0] >= Math.min(a[0], b[0]) - GEOMETRY_EPSILON && p[0] <= Math.max(a[0], b[0]) + GEOMETRY_EPSILON && p[1] >= Math.min(a[1], b[1]) - GEOMETRY_EPSILON && p[1] <= Math.max(a[1], b[1]) + GEOMETRY_EPSILON;
}
export function signedArea(ring: Ring): number {
  return ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]!; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
}
export function containsPoint(ring: Ring, p: Point, boundary = true): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!, b = ring[i]!;
    if (onSegment(p, a, b)) return boundary;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}
export function validateRing(ring: Ring): void {
  if (ring.length < 3 || ring.some(p => p.length !== 2 || !p.every(Number.isFinite)) || Math.abs(signedArea(ring)) <= GEOMETRY_EPSILON) throw new Error('Invalid or zero-area ring');
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    if (samePoint(a, b)) throw new Error('Zero-length edge');
    const c = ring[(i + 2) % ring.length]!;
    if (onSegment(c, a, b) || onSegment(a, b, c)) throw new Error('Backtracking edge');
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      if (intersects(a, b, ring[j]!, ring[(j + 1) % ring.length]!)) throw new Error('Self-intersecting ring');
    }
  }
}
const clockwise = (ring: Ring): Ring => signedArea(ring) > 0 ? ring : [...ring].reverse();
/** Each authored boundary is written once; both children reuse it in reverse. */
export function splitRing(ring: Ring, route: Ring): readonly [Ring, Ring] {
  if (route.length < 2) throw new Error('Boundary needs two ends');
  let expanded = [...ring];
  for (const end of [route[0]!, route[route.length - 1]!]) {
    if (expanded.some(p => samePoint(p, end))) continue;
    const edge = expanded.findIndex((p, i) => onSegment(end, p, expanded[(i + 1) % expanded.length]!));
    if (edge < 0) throw new Error(`Boundary endpoint outside parent: ${end}`);
    expanded.splice(edge + 1, 0, end);
  }
  const start = expanded.findIndex(p => samePoint(p, route[0]!));
  const end = expanded.findIndex(p => samePoint(p, route[route.length - 1]!));
  if (start === end) throw new Error('Boundary ends coincide');
  const walk = (from: number, to: number): Point[] => {
    const result: Point[] = [];
    for (let i = from; i !== to; i = (i + 1) % expanded.length) result.push(expanded[i]!);
    result.push(expanded[to]!);
    return result;
  };
  const a = clockwise([...walk(start, end), ...route.slice(1, -1).reverse()]);
  const b = clockwise([...walk(end, start), ...route.slice(1, -1)]);
  validatePartition(ring, [a, b]);
  return [a, b];
}
export function bounds(ring: Ring): { x: number; y: number; width: number; height: number } {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
export const ringPath = (ring: Ring) => `M${ring.map(p => p.join(',')).join('L')}Z`;
/** Splits every edge at *all* collinear vertices, detecting T-junctions as well
 * as mismatched subdivisions. Directed interior edges must cancel exactly;
 * remaining edges must equal the parent's perimeter, and areas must agree.
 * With simple clockwise rings contained in the parent, cancellation plus area
 * rules out holes, duplicate interiors, crossings and disconnected slivers.
 */
export function validatePartition(parent: Ring, children: readonly Ring[]): void {
  validateRing(parent);
  children.forEach(validateRing);
  const vertices = [parent, ...children].flat();
  const key = (p: Point) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const edges = (rings: readonly Ring[]) => {
    const tally = new Map<string, number>();
    for (const ring of rings) {
      const oriented = clockwise(ring);
      oriented.forEach((a, i) => {
        const b = oriented[(i + 1) % oriented.length]!;
        const points = vertices.filter(p => onSegment(p, a, b)).sort((p, q) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) - ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])));
        const unique = points.filter((p, n) => n === 0 || !samePoint(p, points[n - 1]!));
        for (let n = 1; n < unique.length; n++) {
          const p = key(unique[n - 1]!), q = key(unique[n]!);
          const edge = p < q ? `${p}|${q}` : `${q}|${p}`;
          tally.set(edge, (tally.get(edge) ?? 0) + (p < q ? 1 : -1));
        }
      });
    }
    return new Map([...tally].filter(([, value]) => value !== 0));
  };
  for (const child of children) {
    for (let i = 0; i < child.length; i++) {
      const a = child[i]!, b = child[(i + 1) % child.length]!;
      if (!containsPoint(parent, a) || !containsPoint(parent, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) throw new Error('Child outside parent');
      // A concave coast can cross a child edge even when both ends are inside.
      for (let j = 0; j < parent.length; j++) {
        const c = parent[j]!, d = parent[(j + 1) % parent.length]!;
        if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) throw new Error('Child crosses parent');
      }
    }
  }
  const expected = edges([parent]), actual = edges(children);
  if (expected.size !== actual.size || [...expected].some(([edge, value]) => actual.get(edge) !== value)) throw new Error('Partition has gaps, overlaps or misaligned boundaries');
  const area = children.reduce((sum, child) => sum + Math.abs(signedArea(child)), 0);
  if (Math.abs(area - Math.abs(signedArea(parent))) > GEOMETRY_EPSILON) throw new Error('Partition area mismatch');
}
/** An interior label hint chosen by the author is preferred. This deterministic
 * scan only supplies a safe label/hit target for districts without a hint. */
export function interiorAnchor(ring: Ring): Point {
  const box = bounds(ring);
  let best: Point | undefined, clearance = -1;
  for (let y = 1; y < 30; y++) for (let x = 1; x < 30; x++) {
    const p: Point = [box.x + box.width * x / 30, box.y + box.height * y / 30];
    if (!containsPoint(ring, p, false)) continue;
    let distance = Infinity;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      distance = Math.min(distance, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    });
    if (distance > clearance) { best = p; clearance = distance; }
  }
  if (!best) throw new Error('No interior label point');
  return best;
}

/**
 * Adaptive label placement.
 *
 *
 * Authored anchors are the author's first choice, not a promise: the national
 * map has eighteen names to fit and the county views six, and two labels chosen
 * independently can still land on each other. This places them in authored order
 * — each one taking the best of a bounded set of nudges rather than its exact
 * middle — so a collision is resolved by moving a name *within its own region*
 * instead of by shrinking the map until the geography cannot be read.
 *
 * `width`/`height` are the label's own box, measured in atlas units by the
 * caller from the same font sizes and line breaks the map draws with, and
 * `topOffset` is how far above the anchor the box starts — so the box here is
 * the box on the screen, and this pass and the renderer cannot disagree about
 * where a label is. A candidate is preferred when its whole box is inside the
 * region, penalised by the overlap it leaves and by how far it has moved, and
 * the search is deterministic: the same atlas always places the same labels.
 */
/**
 * A label as the map draws it: `width` and `height` are the whole blocked-out
 * area including the line that says whether a region is available, and
 * `nameHeight` is the part that must sit inside the region — the name itself.
 * The sub-line is allowed to approach a boundary because it is a caption on the
 * name rather than the name; the name may not, which is the rule the placement
 * solves and the atlas tests.
 */
export interface LabelItem { polygon: Ring; anchor: Point; width: number; height: number; nameHeight: number; topOffset: number }
/** Where a label ends up, and at what size: a crowded region can be given a
 * smaller name rather than an illegible one. */
export interface LabelPlacement { anchor: Point; scale: number }
export interface LabelBox { left: number; right: number; top: number; bottom: number }
/** Nudges tried, as fractions of the label's own longest side: the exact anchor
 * first, then a fine grid around it, then a coarse one for a region with room.
 * Deterministic and bounded — 49 candidates per label, in authored order. */
const SHIFTS = [0, -0.25, 0.25, -0.5, 0.5, -0.9, 0.9] as const;
function boxFor(item: LabelItem, anchor: Point): LabelBox {
  // The name block, not the whole caption: see `LabelItem.nameHeight`.
  return { left: anchor[0] - item.width / 2, right: anchor[0] + item.width / 2, top: anchor[1] + item.topOffset, bottom: anchor[1] + item.topOffset + item.nameHeight };
}
/**
 * How good a placement is, as one number that only ever decides between
 * placements rather than weighing them against each other: two labels on top of
 * one another is the worst outcome, a name outside its own region the next, a
 * small name the next, and a long nudge the least bad. `scale` is negated so a
 * larger label ranks lower, which is how "keep the type size" is expressed.
 */
function rank(a: { overlap: number; outside: number; move: number; scale: number }): number {
  return a.overlap * 1e6 + a.outside * 1e4 + (1 - a.scale) * 100 + a.move;
}
/** The area two label boxes share: what the map means by a collision. */
export const overlapArea = (a: LabelBox, b: LabelBox): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/** How much of the label box is outwith its region, sampled at corners and middle. */
function outsideScore(ring: Ring, box: LabelBox): number {
  const xs = [box.left, (box.left + box.right) / 2, box.right];
  const ys = [box.top, (box.top + box.bottom) / 2, box.bottom];
  let outside = 0;
  // Strictly inside, matching the atlas's own test: a label sitting exactly on a
  // boundary is a label half outside its region, not a label at the edge.
  for (const x of xs) for (const y of ys) if (!containsPoint(ring, [x, y], false)) outside += 1;
  return outside;
}
/** The anchors to draw with: each inside its region and clear of the others. */
export function placeLabels(items: readonly LabelItem[], scales: readonly number[] = [1, 0.86, 0.74]): LabelPlacement[] {
  const placed: { anchor: Point; scale: number; box: LabelBox }[] = [];
  for (const item of items) {
    const radius = Math.max(item.width, item.height, 8);
    const search = (scale: number) => {
      const sized: LabelItem = { ...item, width: item.width * scale, height: item.height * scale, nameHeight: item.nameHeight * scale, topOffset: item.topOffset * scale };
      let best: { anchor: Point; box: LabelBox; overlap: number; outside: number; move: number } | null = null;
      for (const dx of SHIFTS) for (const dy of SHIFTS) {
        const anchor: Point = [item.anchor[0] + dx * radius, item.anchor[1] + dy * radius];
        // Only anchors strictly inside their own region are eligible, so a name
        // is never moved out of the place it belongs to to avoid another.
        if (!containsPoint(item.polygon, anchor, false)) continue;
        const box = boxFor(sized, anchor);
        const candidate = {
          anchor,
          box,
          overlap: placed.reduce((sum, other) => sum + overlapArea(box, other.box), 0),
          outside: outsideScore(item.polygon, box),
          move: Math.abs(dx) + Math.abs(dy),
        };
        if (!best || rank({ ...candidate, scale }) < rank({ ...best, scale })) best = candidate;
      }
      return best;
    };
    // Every size is tried, and the winner is the one that is not on top of
    // another label, then not spilling out of its own region, then the largest,
    // then the closest to the anchor the atlas asked for. A smaller name is
    // therefore taken only when it buys legibility, never as a tie-break.
    let chosen: ReturnType<typeof search> = null;
    let chosenScale = scales[0]!;
    for (const scale of scales) {
      const attempt = search(scale);
      if (!attempt) continue;
      if (!chosen || rank({ ...attempt, scale }) < rank({ ...chosen, scale: chosenScale })) {
        chosen = attempt;
        chosenScale = scale;
      }
    }
    // A region too tight for any nudge keeps the anchor it was given, which the
    // caller has already chosen to be inside it.
    const anchor = chosen?.anchor ?? item.anchor;
    placed.push({ anchor, scale: chosen ? chosenScale : 1, box: chosen?.box ?? boxFor(item, item.anchor) });
  }
  return placed.map(({ anchor, scale }) => ({ anchor, scale }));
}
/** Total remaining overlap between placed labels, for the atlas's own tests. */
export function labelOverlap(items: readonly LabelItem[], anchors: readonly Point[]): number {
  const boxes = items.map((item, index) => boxFor(item, anchors[index]!));
  let total = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) total += overlapArea(boxes[i]!, boxes[j]!);
  return total;
}
/** How much of the placed labels sits outside its own region, for the same tests. */
export function labelOutside(items: readonly LabelItem[], anchors: readonly Point[]): number {
  return items.reduce((sum, item, index) => sum + outsideScore(item.polygon, boxFor(item, anchors[index]!)), 0);
}

/**
 * A region's own settlements, fitted inside its atlas shape.
 *
 * The atlas is authored in atlas units; the world lays its towns out on a map of
 * its own (`Town.x`/`Town.y`, 0..100). They are two drawings of the same country
 * rather than one survey, so a district's towns are fitted into the district's
 * shape: which settlements the district holds, and how they sit relative to each
 * other, is what the map says, and it says it without stretching them — one
 * scale for both axes, centred, with a margin so a dot is never on the boundary
 * it belongs to.
 *
 * A box fitted into a shape is not inside the shape when the shape has a bay in
 * it, so a point told where the region's interior is (`interior`, an anchor
 * already known to be inside it — see `interiorAnchor`) is walked in to meet it.
 * One settlement out of step is moved back onto its own ground rather than drawn
 * in the region next door, which is the one thing this map must not say.
 */
export function fitPoints(
  ring: Ring,
  points: readonly { x: number; y: number }[],
  { inset = 0.14, interior }: { inset?: number; interior?: Point } = {},
): Point[] {
  if (points.length === 0) return [];
  const box = bounds(ring);
  const pad = Math.min(box.width, box.height) * inset;
  const left = box.x + pad, right = box.x + box.width - pad;
  const top = box.y + pad, bottom = box.y + box.height - pad;
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const spanX = maxX - minX, spanY = maxY - minY;
  const scale = Math.min(spanX > 0 ? (right - left) / spanX : Infinity, spanY > 0 ? (bottom - top) / spanY : Infinity);
  const size = Number.isFinite(scale) ? scale : 1;
  const originX = left + Math.max(0, (right - left - spanX * size)) / 2;
  const originY = top + Math.max(0, (bottom - top - spanY * size)) / 2;
  return points.map((point) => {
    let fitted: Point = [originX + (point.x - minX) * size, originY + (point.y - minY) * size];
    if (!interior) return fitted;
    // Halving the way towards a point known to be inside lands inside in a
    // handful of steps for any shape this atlas holds, and moves the mark as
    // little as it can.
    for (let step = 0; step < 8 && !containsPoint(ring, fitted, false); step++) {
      fitted = [fitted[0] + (interior[0] - fitted[0]) / 2, fitted[1] + (interior[1] - fitted[1]) / 2];
    }
    return fitted;
  });
}

export interface BoundaryCut { parent: string; children: readonly [string, string]; route: Ring }
export function authoredPartition(outline: Ring, cuts: readonly BoundaryCut[]): Record<string, Ring> {
  const pieces: Record<string, Ring> = { land: outline };
  for (const cut of cuts) {
    const parent = pieces[cut.parent];
    if (!parent) throw new Error(`Missing boundary parent ${cut.parent}`);
    let split: readonly [Ring, Ring];
    try { split = splitRing(parent, cut.route); }
    catch (error) { throw new Error(`${cut.parent} → ${cut.children.join('/')}: ${error instanceof Error ? error.message : String(error)}`); }
    delete pieces[cut.parent];
    cut.children.forEach((id, i) => { if (pieces[id]) throw new Error(`Duplicate piece ${id}`); pieces[id] = split[i]!; });
  }
  validatePartition(outline, Object.values(pieces));
  return pieces;
}
