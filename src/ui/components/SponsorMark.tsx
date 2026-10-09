import {
  boardPath,
  deviceVariantFor,
  insetTransform,
  SPONSOR_CHEST,
  SPONSOR_MARK,
  SPONSOR_NAME_MIN_HEIGHT,
  sponsorChestPlan,
  sponsorPlan,
  type SponsorBrand,
  type SponsorPlan,
} from '../sponsorMark';
import { SPONSOR_TRADE_DEVICES, type SponsorTradeColours } from '../sponsorTrades';

/**
 * A sponsor's logo, drawn.
 *
 * One plan, three drawings. The lockup is the board a business nails up: its
 * board shape in its own colours with the device on it and its name across it —
 * which is what the finances page and the world's list of businesses show. The
 * print is the same logo in one ink, which is what a shirt carries, because a
 * printed kit is one colour whatever the business's sign is painted. The emblem
 * is the board without its name, which is what a list row has room for.
 *
 * All three come out of `sponsorPlan`, so the pub on a manager's finances page
 * and the pub printed across his shirt are recognisably the same logo — which is
 * the whole point of a sponsor's mark, and is the difference between a logo and
 * a decoration.
 *
 * The mark is hidden from screen readers, for the same reason a badge is: the
 * business's name is beside it in every place a sponsor is shown. It is the
 * *drawing* that is being added here, not a second copy of a name the manager is
 * already reading.
 */

/** The box an emblem is drawn in: the logo without its name is square. */
const EMBLEM_BOX = 32;

/** How much of an emblem's box the device fills. */
const EMBLEM_DEVICE = 22;

/**
 * How a patch sits on cloth.
 *
 * A printed sponsor is drawn on its own board rather than in the shirt's ink,
 * because a shirt can be striped, hooped or two-coloured and lettering laid
 * straight onto it disappears into the pattern. The only thing the shirt gives
 * the patch is its edge: a hairline in the shirt's own ink, so a cream board on
 * a white shirt still reads as a board.
 */
export interface SponsorPrint {
  /** The shirt's own ink, drawn as the hairline round the patch. */
  edge?: string;
}

export interface SponsorMarkProps {
  business: SponsorBrand;
}

/** The drawing of the device this business uses out of its trade's family. */
function deviceFor(business: SponsorBrand, plan: { trade: SponsorPlan['trade'] }, colours: SponsorTradeColours) {
  const family = SPONSOR_TRADE_DEVICES[plan.trade];
  const draw = family[deviceVariantFor(business.id, family.length)]!;
  return draw(colours);
}

/**
 * The name, set in the treatment the plan chose.
 *
 * The size is the plan's and the case is the plan's: a sign-writer's caps and a
 * printer's letter-spacing are part of the mark, not a stylesheet's business, so
 * they are attributes here rather than a class.
 */
function SponsorName({ plan, fill, halo }: { plan: SponsorPlan; fill: string; halo?: string }) {
  return (
    <text
      textAnchor="middle"
      fontFamily={plan.type.family}
      fontSize={plan.nameSize}
      fontWeight={plan.type.weight}
      letterSpacing={plan.type.tracking * plan.nameSize}
      fill={fill}
      {...(halo
        ? { stroke: halo, strokeWidth: plan.nameSize * 0.16, strokeLinejoin: 'round' as const, paintOrder: 'stroke' }
        : {})}
    >
      {plan.displayLines.map((line, index) => (
        <tspan key={line} x={plan.nameX} y={plan.nameBaselines[index]}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * The logo as a board, in its own coordinate space and nothing else.
 *
 * Split out from the `<svg>` wrapper because the same drawing is printed on a
 * shirt, where the coordinate space belongs to the shirt and a nested `<svg>`
 * would take a viewport of its own.
 */
export function SponsorBoardArt({ business }: SponsorMarkProps) {
  const plan = sponsorPlan(business);
  const { width, height } = SPONSOR_MARK;
  const board = boardPath(plan.shape, width, height);
  return (
    <>
      <path d={board} fill={plan.field} />
      {/* The keyline every painted board has, pulled in off the edge. */}
      <path
        d={board}
        fill="none"
        stroke={plan.accent}
        strokeWidth={1.1}
        opacity={0.7}
        transform={insetTransform(width, height)}
      />
      {/* The block a `panel` layout knocks its device out of. */}
      {plan.panel && (
        <path d={panelPath(plan.panel.x, plan.panel.y, plan.panel.size)} fill={plan.accent} />
      )}
      {plan.device && (
        <g
          transform={`translate(${plan.device.x - plan.device.size / 2} ${plan.device.y - plan.device.size / 2}) scale(${
            plan.device.size / 32
          })`}
        >
          {/* Inside a panel the device is knocked out of the block, so it is the
              board's own colour and its cut-outs are the device's. */}
          {plan.panel
            ? deviceFor(business, plan, { ink: plan.field, field: plan.accent })
            : deviceFor(business, plan, { ink: plan.accent, field: plan.field })}
        </g>
      )}
      {plan.rule && (
        <path
          d={`M${plan.rule.x1} ${plan.rule.y} H${plan.rule.x2}`}
          stroke={plan.accent}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      )}
      <SponsorName plan={plan} fill={plan.ink} />
    </>
  );
}

/**
 * The logo printed on cloth: the same board, the same layout, one ink.
 *
 * A shirt's chest carries whatever the sponsor prints on it, and a printed
 * sponsor is monochrome — the business's own colours are on its sign, not on
 * somebody's kit. So the board's edge becomes a light keyline in the print's ink
 * and everything inside it is either ink or the cloth. That keyline is what
 * stops the print reading as a line of text with a symbol beside it, which is
 * exactly what the marks used to look like on a shirt.
 */
export function SponsorPrintArt({ business, print }: SponsorMarkProps & { print?: SponsorPrint }) {
  const plan = sponsorChestPlan(business);
  const { width, height } = SPONSOR_CHEST;
  const board = boardPath(plan.shape, width, height);
  return (
    <>
      {/* The patch: the business's own board, filled with the business's own
          colour, printed where the shirt is. It is not an outline, because the
          lettering laid on bare cloth is unreadable over a stripe — a shirt's
          sponsor is printed on its own board on a real shirt, and now here. */}
      <path d={board} fill={plan.field} />
      {print?.edge && <path d={board} fill="none" stroke={print.edge} strokeWidth={0.9} />}
      <path
        d={board}
        fill="none"
        stroke={plan.accent}
        strokeWidth={0.9}
        opacity={0.75}
        transform={insetTransform(width, height)}
      />
      {plan.device && (
        <g
          transform={`translate(${plan.device.x - plan.device.size / 2} ${plan.device.y - plan.device.size / 2}) scale(${
            plan.device.size / 32
          })`}
        >
          {deviceFor(business, { trade: plan.trade }, { ink: plan.accent, field: plan.field })}
        </g>
      )}
      <text
        textAnchor="middle"
        fontFamily={plan.type.family}
        fontSize={plan.nameSize}
        fontWeight={plan.type.weight}
        letterSpacing={plan.type.tracking * plan.nameSize}
        fill={plan.ink}
      >
        {plan.displayLines.map((line, index) => (
          <tspan key={line} x={plan.nameX} y={plan.nameBaselines[index]}>
            {line}
          </tspan>
        ))}
      </text>
    </>
  );
}

/** The device alone, on the board, for the room a list row has. */
export function SponsorEmblemArt({ business }: SponsorMarkProps) {
  const plan = sponsorPlan(business);
  const board = boardPath(plan.shape, EMBLEM_BOX, EMBLEM_BOX);
  return (
    <>
      <path d={board} fill={plan.field} />
      <path
        d={board}
        fill="none"
        stroke={plan.accent}
        strokeWidth={0.8}
        opacity={0.7}
        transform={insetTransform(EMBLEM_BOX, EMBLEM_BOX)}
      />
      <g
        transform={`translate(${EMBLEM_BOX / 2 - EMBLEM_DEVICE / 2} ${
          EMBLEM_BOX / 2 - EMBLEM_DEVICE / 2
        }) scale(${EMBLEM_DEVICE / 32})`}
      >
        {deviceFor(business, plan, { ink: plan.accent, field: plan.field })}
      </g>
    </>
  );
}

/** The rounded square a `panel` layout sets its device in. */
function panelPath(x: number, y: number, size: number): string {
  const r = size * 0.14;
  return (
    `M${x + r} ${y} H${x + size - r} A${r} ${r} 0 0 1 ${x + size} ${y + r} V${y + size - r} ` +
    `A${r} ${r} 0 0 1 ${x + size - r} ${y + size} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + size - r} ` +
    `V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
  );
}

/**
 * A logo at whatever height the surface gives it, in the shape that fits.
 *
 * The height is the whole interface: give it the room a lockup needs and the
 * business's name is on it, give it a line and it draws the board and its trade
 * instead.
 */
export function SponsorMark({
  business,
  height = 40,
  layout,
}: SponsorMarkProps & { height?: number; layout?: 'board' | 'emblem' }) {
  const wantEmblem = layout === 'emblem' || (layout === undefined && height < SPONSOR_NAME_MIN_HEIGHT);
  if (wantEmblem) {
    return (
      <svg
        className="sponsormark"
        viewBox={`0 0 ${EMBLEM_BOX} ${EMBLEM_BOX}`}
        width={height}
        height={height}
        aria-hidden="true"
        focusable="false"
      >
        <SponsorEmblemArt business={business} />
      </svg>
    );
  }
  const scale = height / SPONSOR_MARK.height;
  return (
    <svg
      className="sponsormark"
      viewBox={`0 0 ${SPONSOR_MARK.width} ${SPONSOR_MARK.height}`}
      width={Math.round(SPONSOR_MARK.width * scale)}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      <SponsorBoardArt business={business} />
    </svg>
  );
}
