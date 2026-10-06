import { create } from 'zustand';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, MatchId, PersonId, PlayerId } from '@/domain/ids';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import { settleShortSides } from '@/simulation/forfeit';
import type { GameEvent } from '@/domain/news';
import { isPlayer, personDisplayName } from '@/domain/person';
import type { Tactics } from '@/domain/tactics';
import {
  DEFAULT_PREFERENCES,
  applyMotion,
  clampSpeed,
  loadPreferences,
  savePreferences,
  type Preferences,
} from './preferences';
import { rememberProfile } from './managerProfiles';
import { currentScore, simulateMatchEngine } from '@/simulation/match/matchEngine';
import {
  currentLiveEngine,
  forgetLiveEngine,
  liveEngineEnv,
  liveEngineFor,
  livePlayback,
  liveTimelineFor,
  narrateDrained,
  setAutoManageBenches,
  setLivePlayback,
  syncEnginePossession,
} from './liveEngine';
import { beginSkip, tickPlayback, VIEWING_MODES, type ViewingMode } from '@/presentation/matchPlayback';
import {
  applyWarmUpToFamiliarity,
  fullTimeOutcome,
  fullTimeTalkMoraleDelta,
  fullTimeTalkVerdict,
  teamTalkMoraleDelta,
  teamTalkVerdict,
  warmUpEnergyDelta,
  type FullTimeTalk,
  type TeamTalk,
  type WarmUp,
} from '@/simulation/match/preparation';
import { applyMatchConsequences, matchReportEvent } from '@/simulation/consequences';
import { applyMatchdayFinances } from '@/simulation/finance';
import { collectSubs as collectClubSubs } from '@/simulation/treasurer';
import { resolveAdminEvent } from '@/simulation/secretary';
import { requestChairmanBacking } from '@/simulation/governance';
import { activeDealForClub, seekSponsor as seekClubSponsor } from '@/simulation/sponsorship';
import { ensureUserXi, matchEnvironment } from '@/simulation/matchday';
import { publishEvents } from '@/simulation/news';
import { ensureClubTrained } from '@/simulation/training/session';
import { currentPlan, currentSessionKey, savePlan, sessionDateFor } from '@/simulation/training/plan';
import { describeSessionQuality, type TrainingBlockId, type TrainingLength } from '@/domain/training';
import {
  applyCustomClub,
  generateDraft,
  startGameFromDraft,
  type ClubDesign,
  type WorldDraft,
} from '@/simulation/gameSetup';
import { defaultManagerProfile, type ManagerProfile } from '@/domain/manager';
import {
  continueTime,
  continueTimeSteps,
  currentAttention,
  processDaySteps,
  callLateWithdrawals,
  readyForToday,
  settleSubsFor,
  type DayStep,
} from '@/simulation/day';
import { startNextSeason } from '@/simulation/season';
import { nextFixtureFor } from '@/simulation/schedule';
import { daysBetween } from '@/simulation/calendar';
import { nextMatchday } from '@/simulation/timeline';
import {
  holdOpenSession as runOpenSession,
  lookAtFiveASide as watchFiveASide,
  observeCandidate,
  requestRecommendations as askSquadForNames,
} from '@/simulation/recruitment/discovery';
import { inviteToTrial as inviteCandidate, runTrialSession as runSession } from '@/simulation/recruitment/trials';
import type { CommunicationIntent } from '@/domain/communication';
import { markConversationRead } from '@/simulation/communication/store';
import { openPlayerThread, sendPlayerMessage } from '@/simulation/communication/playerConversation';
import { officeRoleOf, openOfficerThread, sendOrganisationMessage } from '@/simulation/communication/organisationComms';
import { sendFromManager, threadWith } from '@/simulation/communication/system';
// The kit planner is pure decisions about colours — no React, no rendering — so
// the action that changes the club's kit can name the kit it just changed to.
import { clubKit, KIT_OPTION_COUNT } from '@/ui/kit';
import { money } from '@/ui/format';
import { defaultRoleFor } from '@/simulation/match/roles';
import {
  approachCandidate as askCandidate,
  passOnCandidate,
  signCandidate,
} from '@/simulation/recruitment/signing';
import * as persistence from './persistence';

/**
 * Everything the manager is about to look at is ready to be looked at: today's
 * fixtures have a referee, weather and two teams, and his own next fixture has
 * an XI to edit. All of it is idempotent, so it is safe to call on every step
 * of the clock — and after loading a save written before any of it existed.
 */
function readyForManager(state: GameState): void {
  readyForToday(state);
  ensureUserXi(state);
}

/**
 * The single owner of simulation state in the browser.
 *
 * UI components never simulate anything themselves: they call actions here and
 * the actions delegate to the simulation services. The store holds:
 *
 *  - `game`: the serialisable simulation state (the source of truth)
 *  - `draft`: a generated world waiting for the player to choose a club
 *  - `session`: a transient live-match session while a match is being watched
 *
 * Only `game` is ever saved. The draft and the live session are rebuilt.
 */

export type ViewId =
  | 'start'
  | 'profile'
  | 'select-club'
  | 'create-club'
  | 'dashboard'
  | 'manager'
  | 'squad'
  | 'team'
  | 'tactics'
  | 'fixtures'
  | 'league'
  | 'cup'
  | 'finances'
  | 'history'
  | 'club'
  | 'kit'
  | 'world'
  | 'news'
  | 'replay'
  | 'recruitment'
  | 'training'
  | 'inbox'
  | 'staff'
  | 'match';

/** Something the manager can pull up over the top of the current screen. */
export interface ProfileTarget {
  kind: 'player' | 'club';
  id: string;
}

/**
 * A finished match being watched back.
 *
 * Transient, like the live session: only the match's id and where to return
 * when it is over are held, because the replay is read from the record in the
 * game state rather than kept beside it. Nothing about a replay is ever saved.
 */
export interface ReplayTarget {
  matchId: MatchId;
  /** The screen to come back to when the replay is closed. */
  from: ViewId;
}

export interface MatchSession {
  matchId: MatchId;
  live: Match;
  side: 'home' | 'away';
  /**
   * The manager's speed multiplier: higher is less real time per football
   * second. Presentation only — it never changes the football, only how quickly
   * the presentation spends the simulation it has already been given.
   */
  speed: number;
  /**
   * How much of the match the manager wants to see: full, extended, key moments
   * or commentary. Also presentation only.
   */
  viewingMode: ViewingMode;
  paused: boolean;
  /**
   * Where the manager is in the day. The match is an appointment in the
   * calendar, not a separate game mode, so it has its own small set of phases:
   * he arrives, he prepares, he watches, he talks to them at half-time, and he
   * reads the result.
   */
  phase: 'pre-match' | 'in-progress' | 'half-time' | 'full-time';
  revision: number;
  lastMinuteEvents: number;
  /** Said to the players before kick-off; applied when the whistle goes. */
  teamTalk: TeamTalk | null;
  /** Said at half time; applied as they go back out. */
  halfTimeTalk: TeamTalk | null;
  /**
   * Said once it is over, in the dressing room, with the result in it.
   * It lands when he leaves them — see `finishMatchSession` — and it is put
   * against how the team went and how each man himself played.
   */
  fullTimeTalk: FullTimeTalk | null;
  /** Chosen before kick-off; decides what is in their legs at the start. */
  warmUp: WarmUp;
}

/** How the manager is starting: taking over an existing club, or building one. */
export type SetupMode = 'career' | 'create-club';

/**
 * The setup flow: which mode the manager chose and who he says he is.
 *
 * Held outside the game state because it exists only until the career begins —
 * once he is in charge his identity lives on the career itself.
 */
export interface SetupState {
  mode: SetupMode;
  profile: ManagerProfile;
}

/**
 * The dialogs that belong to the game rather than to a screen: settings, the
 * changelog, the credits and the managers already saved. They are named here
 * rather than held locally because the same menu has to open from the main menu
 * and from the header of a running career.
 */
export type DialogId = 'preferences' | 'changelog' | 'credits' | 'profiles';

/**
 * What the game is doing while the manager waits for the rest of the league.
 *
 * A matchday means five or six other clubs being played out by the same engine
 * the manager watches, each long enough that a screen with no explanation of it
 * reads as a freeze. This is that explanation: which match is being worked out,
 * how far through the day it is, and what has come out of it so far.
 */
export interface ProcessingState {
  /** What the game is doing, in the manager's words. */
  headline: string;
  /** The match being worked out, or null between two of them. */
  current: string | null;
  /** Fixtures finished so far, out of `total`. */
  done: number;
  /** The day's other fixtures, which the loop knows before it plays the first. */
  total: number;
  /** Results as they arrive, oldest first. */
  results: string[];
  /** The day the football belongs to, for the heading once it is known. */
  date: ISODate | null;
}

export interface GameStore {
  /**
   * Whether the game knows whether there is a career to reopen.
   *
   * False only while the database is still opening and any localStorage careers
   * are still being brought across. The menu waits on it rather than deciding
   * "there is no career" from a database it has not finished reading — which is
   * how a manager ends up looking at an empty save list that fills in a moment
   * later.
   */
  ready: boolean;
  game: GameState | null;
  draft: WorldDraft | null;
  setup: SetupState | null;
  session: MatchSession | null;
  replay: ReplayTarget | null;
  view: ViewId;
  selectedPlayerId: PersonId | null;
  selectedClubId: ClubId | null;
  notice: string | null;
  error: string | null;
  /** The calendar screen: FM's "advance days" planner. */
  plannerOpen: boolean;
  /** A player or club profile pulled up over the current screen. */
  profile: ProfileTarget | null;
  /** A transfer/recruitment negotiation opened from a candidate. */
  negotiationId: PersonId | null;
  /** Which conversation the inbox is showing. Null means the list. */
  openConversationId: string | null;
  /**
   * A part of the current screen to reveal, set by whoever navigated here.
   *
   * It is the whole of the deep-link mechanism: a card names a section id, the
   * shell scrolls to it once the screen has painted, and nothing else has to
   * know that it happened.
   */
  focus: string | null;
  /** Which of the game's own dialogs is open, if any. */
  dialog: DialogId | null;
  /**
   * The game is playing out football the manager is not watching.
   *
   * Non-null only while the clock is being moved across other clubs' fixtures.
   * The modal reads it; nothing else may act on it, and it closes itself.
   */
  processing: ProcessingState | null;
  /**
   * The clock is moving. True from the first day to the last, which is longer
   * than `processing` is non-null: the dialog only appears once there is football
   * to wait for, but a second Continue must be refused either way.
   */
  advancing: boolean;
  /** How the game behaves for the person playing it. Held outside any career. */
  preferences: Preferences;

  // Navigation and selection are presentation-only state.
  /**
   * Go to a screen, optionally to a named part of it.
   *
   * The anchor is the `id` of a section on the destination screen. It exists so
   * a card saying "the treasurer is worried about the money" can land on the
   * treasurer's own words rather than at the top of a screen the manager then
   * has to search. A view that has no such id simply ignores it.
   */
  setView: (view: ViewId, focus?: string | null) => void;
  /**
   * Watch a finished match back from its own record. Does nothing for a fixture
   * with no events to replay.
   */
  openReplay: (matchId: MatchId, from?: ViewId) => void;
  /** Leave the replay and return to the screen it was opened from. */
  closeReplay: () => void;
  openDialog: (dialog: DialogId) => void;
  closeDialog: () => void;
  setPreferences: (patch: Partial<Preferences>) => void;
  resetPreferences: () => void;
  selectPlayer: (playerId: PersonId | null) => void;
  selectClub: (clubId: ClubId | null) => void;
  setNotice: (notice: string | null) => void;
  openPlanner: () => void;
  closePlanner: () => void;
  openProfile: (target: ProfileTarget) => void;
  closeProfile: () => void;
  openNegotiation: (personId: PersonId) => void;
  closeNegotiation: () => void;

  // Communication: opening a thread, reading it, and writing back.
  /** Open a thread. Opening it is what marks it read, not leaving it. */
  openConversation: (conversationId: string) => void;
  /** Back to the list. The thread stays where it was, read. */
  closeConversation: () => void;
  /** Start a thread with somebody if there is not one already. */
  startConversationWith: (personId: PersonId) => void;
  /**
   * Write to a thread with an intent behind it. The words the manager would
   * have typed come from the intent, so nothing here needs a keyboard.
   */
  sendConversationMessage: (conversationId: string, intent: CommunicationIntent) => void;
  /** Open a thread with a player from his profile and go to it. */
  messagePlayer: (personId: PersonId) => void;
  /** Put an intent to a player. Replies, follow-ups and relationships follow. */
  sendPlayerIntent: (personId: PersonId, intent: CommunicationIntent) => void;

  // The calendar: FM's Continue button, day by day.
  continueGame: () => Promise<void>;
  advanceDays: (days: number) => Promise<void>;
  jumpToDate: (date: ISODate) => Promise<void>;

  // Career lifecycle: choose a mode, say who you are, then take or build a club.
  beginSetup: (mode: SetupMode) => void;
  cancelSetup: () => void;
  setManagerProfile: (profile: ManagerProfile) => void;
  createDraft: (seed: string) => void;
  chooseClub: (clubId: ClubId) => void;
  createCustomClub: (design: ClubDesign) => void;
  abandonDraft: () => void;
  saveGame: (slot: string) => Promise<void>;
  loadGame: (slot: string) => Promise<void>;
  listSaves: () => Promise<persistence.SaveSlotInfo[]>;
  quitToMenu: () => Promise<void>;

  // Matchday and the season.
  startUserMatch: () => void;
  /** Leave the dressing room: apply the preparation and start the clock. */
  kickOff: () => void;
  /** Out of the changing room for the second half. */
  resumeSecondHalf: () => void;
  setTeamTalk: (talk: TeamTalk) => void;
  setHalfTimeTalk: (talk: TeamTalk) => void;
  setFullTimeTalk: (talk: FullTimeTalk) => void;
  setWarmUp: (warmUp: WarmUp) => void;
  /** Pre-match selection: swap a starter with a substitute, no sub used. */
  swapSessionPlayers: (outgoingId: PlayerId, incomingId: PlayerId) => void;
  instantResult: () => void;
  tickMatch: () => void;
  /**
   * Move the match's continuous spatial state on by the real time that has
   * passed. The clock is pumped by the match view; this only spends it.
   */
  advanceSpatial: (deltaSeconds: number) => void;
  simulateMatchToEnd: () => void;
  setMatchSpeed: (speed: number) => void;
  setViewingMode: (mode: ViewingMode) => void;
  /** Fast-forward to the next passage the viewing mode would show. */
  skipToNextHighlight: () => void;
  toggleMatchPause: () => void;
  finishMatchSession: () => void;
  makeSubstitution: (outgoingId: PersonId, incomingId: PersonId) => void;
  setMatchTactics: (tactics: Tactics) => void;
  rollOverSeason: () => void;

  // Recruitment: social discovery, trials and registering players.
  askForRecommendations: () => void;
  checkFiveASide: () => void;
  holdOpenSession: () => void;
  runTrialSession: () => void;
  watchCandidate: (personId: PersonId) => void;
  inviteToTrial: (personId: PersonId) => void;
  approachCandidate: (personId: PersonId) => void;
  offerToJoin: (personId: PersonId) => void;
  passOnCandidate: (personId: PersonId, reason?: string) => void;

  // Training: the manager's standing plan for Thursday night.
  runTrainingSession: () => void;
  setTrainingLength: (length: TrainingLength) => void;
  toggleTrainingBlock: (block: TrainingBlockId) => void;
  setTrainingFallbackVenue: (value: boolean) => void;
  resetTrainingPlan: () => void;

  // The treasurer: turning a sub a player owes into money the club actually has.
  /**
   * Record a matchday sub payment. The debt is clamped to what he owes, so this
   * can never book more than the man's real balance — and a second press on an
   * already-settled debt does nothing.
   */
  collectSubs: (playerId: PersonId, amount?: number) => void;

  // Club administration: the secretary's desk.
  /** Close an administrative item the secretary has put in front of the manager. */
  resolveAdmin: (id: string) => void;

  /** Ask the chairman to help the club out of the red. Rare, and once a season. */
  requestBacking: () => void;

  /**
   * Look for a sponsor among the local businesses. Does nothing when the club is
   * already sponsored; otherwise it knocks on the doors the town offers, and
   * the club may still come away with nobody.
   */
  seekSponsor: () => void;

  /** Choose which of this season's kit designs the club runs out in. */
  chooseKit: (option: number) => void;

  // Selection and tactics, saved into the current fixture's lineup.
  updateClubTactics: (tactics: Tactics) => void;
  updateFixtureLineup: (
    updater: (lineup: Match['lineups']['home']) => Match['lineups']['home'],
  ) => void;
}

function clone<T>(value: T): T {
  return structuredClone(value) as T;
}

/**
 * The single sentence that comes back from a Continue.
 *
 * If the clock stopped, say what for. If it ran, say what happened on the way —
 * a quiet Tuesday should read as "nothing happened", not as a blank screen.
 */
function continueNotice(outcome: ReturnType<typeof continueTime>): string {
  const days = outcome.days.length;
  const notes = outcome.notes.slice(-3).join(' ');
  if (outcome.stop) {
    const when = days > 0 ? `${days} day${days === 1 ? '' : 's'} on. ` : '';
    return `${when}${outcome.stop.headline} — ${outcome.stop.detail}${notes ? ` ${notes}` : ''}`;
  }
  if (days === 0) return notes || 'Nothing to do but wait.';
  return notes || `${days} quiet day${days === 1 ? '' : 's'} passed.`;
}


interface StoreHooks {
  set: (partial: Partial<GameStore>) => void;
  get: () => GameStore;
}

/**
 * How long the store waits, after the last change, before writing the career
 * out.
 *
 * Serialising the whole world costs a few milliseconds, and dragging a player
 * around the team sheet fires a change on every drag — so the write waits for
 * the manager to stop, and a burst of edits becomes one save rather than twenty.
 */
const AUTOSAVE_DELAY_MS = 800;

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Keep the career on disk level with the career on screen.
 *
 * A Sunday league season is played in ten-minute bursts between everything
 * else, and needing to remember to save is how a manager loses a month. The
 * write is debounced, not skipped: the last change to the world is always the
 * one that ends up in the file.
 *
 * The debounce is unchanged by the move to IndexedDB, and deliberately so. The
 * cost it exists to avoid is serialising and writing a whole world, and that
 * cost has not gone away — a career is still a large object to clone. What has
 * gone away is the *synchronous* block while it happens, which is why the write
 * being in flight is no longer a reason to fear a burst of them.
 */
export function scheduleAutosave(state: GameState): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void persistence.autosave(state);
  }, AUTOSAVE_DELAY_MS);
}

/**
 * Write a pending autosave now, rather than when the timer comes round.
 *
 * A tab can be closed or put in the background inside the debounce window, so
 * the page tells the store when it is going away instead of trusting the timer
 * to win the race.
 *
 * The write cannot be *awaited* here — the page is on its way out and nothing
 * is going to hold it open for us — so what this guarantees is only that the
 * write has been handed to the database rather than still sitting in a timer
 * that will never fire. That is the honest limit of it, and it is why
 * `pagehide` and `visibilitychange` are the listeners that call this: both are
 * handed to the browser while there is still time for the write to land, whereas
 * `beforeunload` is not reliably given any.
 */
export function flushAutosave(): void {
  if (autosaveTimer === null) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const game = useGameStore.getState().game;
  if (game) void persistence.autosave(game);
}

/**
 * Recruitment actions all look the same: clone the state, do the thing, publish
 * whatever the world has to say about it, and show the manager a sentence.
 */
function recruitmentAction(
  { set, get }: StoreHooks,
  run: (state: GameState) => { events: GameEvent[]; messages: string[] },
): void {
  const game = get().game;
  if (!game) return;
  const state = clone(game);
  const outcome = run(state);
  publishEvents(state, outcome.events);
  set({ game: state, notice: outcome.messages.join(' ') || null, error: null });
}

/**
 * Start the football for a watched match.
 *
 * The engine is created here and held beside the session (see `liveEngine`),
 * because it is not serialisable. The manager's own bench is left to him, so the
 * AI only makes his changes if he skips to the whistle. Starting a match is the
 * whistle: nothing has been played until this runs.
 */
function startLiveEngine(game: GameState, live: Match): void {
  const env = matchEnvironment(game, live, { autoManageAllBenches: false });
  const engine = liveEngineFor(live, env);
  live.status = 'in-progress';
  live.half = 1;
  live.played = false;
  syncEnginePossession(live, engine);
}

/**
 * Advance the live football by the real time the match view has spent.
 *
 * This is the whole of the clock: the engine takes real seconds and plays the
 * fixed steps they are worth, so a frame rate cannot change a result. The events
 * it produced are drained into the commentary, the possession clock is mirrored
 * onto the match for the statistics, and the store is told whenever the football
 * actually said something, so the bar can redraw without the pitch re-rendering
 * sixty times a second.
 */
function advanceLiveEngine(game: GameState, live: Match, deltaSeconds: number, maxCatchUpSeconds = 1): boolean {
  const env = liveEngineEnv() ?? matchEnvironment(game, live, { autoManageAllBenches: false });
  const engine = liveEngineFor(live, env);
  const toldBefore = live.commentary?.length ?? 0;
  const events = engine.advance(deltaSeconds, maxCatchUpSeconds);
  narrateDrained(live, env, events);
  syncEnginePossession(live, engine);
  return (live.commentary?.length ?? 0) !== toldBefore;
}

/**
 * The store starts empty and unready, and `bootStore` fills it in.
 *
 * The career to open with used to be read as the store was built, because
 * localStorage answers instantly. IndexedDB does not, and pretending otherwise
 * would mean either showing a menu that says "no careers" for a few milliseconds
 * before the real one appears, or blocking the first paint on a database.
 *
 * So the store is built with nothing in it and a `ready` flag that is false, and
 * the page calls `bootStore` before it renders anything that could depend on
 * there being no career. `ready` stays false until that has happened, which is
 * what the menu waits on.
 */
/**
 * How long the processing modal stays up when the work turns out to be quick.
 *
 * A flash of a dialog that appears and vanishes inside a blink is worse than no
 * dialog at all: it reads as a glitch rather than as an explanation.
 */
const MINIMUM_PROCESSING_MS = 700;

/** A frame the browser can actually paint before the next fixture is simulated. */
function paintFrame(): Promise<void> {
  return new Promise((resolve) => {
    // The store is also driven from tests, where there is no frame to wait for.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

/**
 * Move the clock, showing the football as it is played out.
 *
 * The stepping loop is the one the synchronous button drains; the only
 * difference is that this one stands between fixtures long enough for the bar
 * to move, and reports each result as it lands. Every way of moving the clock
 * that crosses somebody else's football comes through here, so the wait is
 * explained wherever the manager caused it.
 */
async function runWithProgress<T>(
  state: GameState,
  steps: Generator<DayStep, T, void>,
  commit: (outcome: T) => void,
  headline = 'Playing out the rest of the league',
): Promise<void> {
  const store = useGameStore;
  // The career this play-out was started from. Held so the result is only handed
  // over if it is still the one on screen: the work spans several frames, and a
  // manager who quit to the menu in the middle of it must not find a month of
  // football written over the career he has just loaded.
  const startedFrom = store.getState().game;
  let shownAt: number | null = null;
  store.setState({ plannerOpen: false, advancing: true });

  let next = steps.next();
  while (!next.done) {
    const step: DayStep = next.value;
    const now = store.getState().processing;
    if (step.kind === 'fixture') {
      // The dialog goes up when there is football to wait for, not when the clock
      // was moved. A Tuesday with nothing on it must not produce a progress bar
      // for a wait that never happened.
      if (!now) {
        shownAt = Date.now();
        store.setState({
          processing: {
            headline,
            current: `${step.home} v ${step.away}`,
            done: step.done,
            total: step.total,
            results: [],
            date: step.date,
          },
        });
      } else {
        store.setState({
          processing: { ...now, current: `${step.home} v ${step.away}`, done: step.done, total: step.total, date: step.date },
        });
      }
    } else if (now) {
      // Null here means the dialog was never opened, or that another career has
      // been loaded over the top: either way there is nothing left to draw.
      store.setState({ processing: { ...now, current: null, done: step.done, total: step.total, results: [...now.results, step.line] } });
    }
    // Paint before the next engine run, or the manager watches a frozen screen
    // for a second and then everything happens at once.
    await paintFrame();
    next = steps.next();
  }

  readyForManager(state);
  // Only ever hold the finished dialog open if it was ever opened.
  if (shownAt !== null) {
    const remaining = MINIMUM_PROCESSING_MS - (Date.now() - shownAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  if (store.getState().game === startedFrom) {
    // Time passing can put a message in a conversation the manager is sitting
    // in — a reply he was promised, arriving on the day it was due.
    markOpenThreadRead(state, store.getState().openConversationId);
    commit(next.value);
  }
  store.setState({ processing: null, advancing: false });
}

/**
 * A thread the manager is reading is read.
 *
 * Opening a thread clears its count, but opening it is not the only way the
 * count moves: his own message and the answer it draws are appended to the very
 * thread he is looking at, and a promised reply can land on a later day while he
 * is still sitting in it. The count would then sit on the conversation in front
 * of him, and the only thing the manager can do about it is open the thread he is
 * already in — which is the one thing opening it again cannot fix.
 *
 * So everything that can put a message into a conversation ends through here:
 * whatever is in the open thread has been seen. A thread that is not open is
 * left alone, badge and all.
 */
function markOpenThreadRead(state: GameState, openConversationId: string | null): void {
  if (openConversationId) markConversationRead(state, openConversationId);
}

/**
 * The calendar planner's own day loop, paused the same way.
 *
 * Advancing days by hand crosses exactly the same football as Continue does, so
 * it gets the same explanation rather than a different silence.
 */
function* advanceDaysSteps(state: GameState, days: number): Generator<DayStep, string[], void> {
  const notes: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const stop = currentAttention(state);
    if (stop && stop.kind !== 'flagged') break;
    const day = yield* processDaySteps(state, state.date, { resolveUserMatch: false });
    notes.push(...day.notes);
    if (day.seasonFinished) break;
  }
  return notes;
}

/** Running the calendar to a chosen date, paused the same way. */
function* jumpToDateSteps(state: GameState, days: number): Generator<DayStep, string[], void> {
  const notes: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const stop = currentAttention(state);
    if (stop && stop.kind !== 'flagged') break;
    const day = yield* processDaySteps(state, state.date, { resolveUserMatch: false });
    notes.push(...day.notes);
    if (day.seasonFinished) break;
  }
  return notes;
}

export const useGameStore = create<GameStore>((set, get) => ({
  ready: false,
  game: null,
  draft: null,
  setup: null,
  session: null,
  replay: null,
  view: 'start',
  selectedPlayerId: null,
  selectedClubId: null,
  notice: null,
  error: null,
  plannerOpen: false,
  profile: null,
  negotiationId: null,
  openConversationId: null,
  focus: null,
  dialog: null,
  processing: null,
  advancing: false,
  preferences: loadPreferences(),

  setView: (view, focus = null) =>
    set({
      view,
      focus,
      replay: null,
      profile: null,
      negotiationId: null,
      // Leaving the inbox altogether drops the open thread, so coming back to
      // Messages shows the list rather than re-reading a thread already read.
      ...(view === 'inbox' ? {} : { openConversationId: null }),
      plannerOpen: false,
      dialog: null,
    }),

  openReplay: (matchId, from) => {
    const game = get().game;
    const match = game?.matches[matchId];
    if (!match || match.events.length === 0) return;
    const previous = get().view;
    set({
      replay: { matchId, from: from ?? (previous === 'replay' ? 'fixtures' : previous) },
      view: 'replay',
      profile: null,
      negotiationId: null,
      plannerOpen: false,
      dialog: null,
    });
  },

  closeReplay: () => {
    const target = get().replay;
    set({ replay: null, view: target?.from ?? 'dashboard' });
  },
  openDialog: (dialog) => set({ dialog, profile: null, negotiationId: null, plannerOpen: false }),
  closeDialog: () => set({ dialog: null }),

  /**
   * A setting is written down and put into effect in the same breath, because a
   * preference that only takes hold after a reload is not a preference.
   */
  setPreferences: (patch) => {
    const next = { ...get().preferences, ...patch };
    savePreferences(next);
    applyMotion(next.motion);
    set({ preferences: next });
  },

  resetPreferences: () => {
    savePreferences(DEFAULT_PREFERENCES);
    applyMotion(DEFAULT_PREFERENCES.motion);
    set({ preferences: { ...DEFAULT_PREFERENCES } });
  },
  selectPlayer: (playerId) => set({ selectedPlayerId: playerId }),
  selectClub: (clubId) => set({ selectedClubId: clubId }),
  setNotice: (notice) => set({ notice }),
  openPlanner: () => set({ plannerOpen: true }),
  closePlanner: () => set({ plannerOpen: false }),
  openProfile: (profile) => set({ profile }),
  closeProfile: () => set({ profile: null }),
  openNegotiation: (personId) => set({ negotiationId: personId }),
  closeNegotiation: () => set({ negotiationId: null }),

  /**
   * Open a thread, and read it.
   *
   * Reading happens on open rather than on leave, because a message the manager
   * has actually looked at has been read whether or not he went back to the
   * list — a phone that only clears its badge when you swipe away is a phone
   * that lies to you about your own post.
   */
  openConversation: (conversationId) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    markConversationRead(state, conversationId);
    set({ game: state, openConversationId: conversationId, error: null });
  },

  closeConversation: () => set({ openConversationId: null }),

  startConversationWith: (personId) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    // A thread he has to write first, or a man who has never written to him
    // is not a conversation: it is a contact. Either way the manager is taken
    // to it, and an empty one says so rather than looking like a broken screen.
    // Somebody who runs the club gets their own kind of thread — the chairman a
    // board thread, the treasurer and secretary a club one, the football staff a
    // staff one — so the inbox shows the office and offers the questions that
    // person can answer.
    const officerThreadId = officeRoleOf(state, personId) ? openOfficerThread(state, personId) : null;
    if (officerThreadId) markConversationRead(state, officerThreadId);
    const conversation = officerThreadId ? state.communication!.conversations[officerThreadId]! : threadWith(state, personId);
    set({
      game: state,
      view: 'inbox',
      openConversationId: conversation.id,
      error: null,
    });
  },

  sendConversationMessage: (conversationId, intent) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const conversation = state.communication?.conversations[conversationId];
    if (!conversation) return;
    // Whoever else is in the thread is who the message is for; a one-to-one has
    // exactly one, and a group broadcast goes to all of them.
    const targetId = conversation.participantIds.find((id) => id !== 'user_manager') ?? null;
    // A one-to-one with a player goes through the player path, so the answer is
    // read from his record and the relationship moves. Everything else — the
    // committee, a group, a trialist — is a generic message.
    if (targetId && conversation.type === 'player' && state.people[targetId]?.kind === 'player') {
      const sent = sendPlayerMessage(state, targetId, intent);
      if (!sent) return;
      markOpenThreadRead(state, get().openConversationId);
      set({
        game: state,
        error: null,
        notice: sent.followUp ? `${state.people[targetId]!.firstName} will let you know.` : null,
      });
      return;
    }
    // Somebody who runs the club answers from the system they own — the ledger,
    // the secretary's desk, the chairman's expectations, the physio's report —
    // so their thread goes through the organisation bridge rather than the
    // generic path.
    if (targetId && officeRoleOf(state, targetId)) {
      const sent = sendOrganisationMessage(state, targetId, intent);
      if (!sent) return;
      markOpenThreadRead(state, get().openConversationId);
      set({ game: state, error: null });
      return;
    }
    const person = targetId ? state.people[targetId] : undefined;
    const result = sendFromManager(state, {
      conversationId,
      intent,
      targetId,
      context: person
        ? { name: person.firstName, topic: person.surname }
        : { topic: conversation.title },
    });
    if (!result.message) return;
    markOpenThreadRead(state, get().openConversationId);
    set({ game: state, error: null });
  },

  /**
   * Open a thread with a player from his profile.
   *
   * Reopening a profile to find out what he said is the whole point of opening
   * it, so this goes to the thread rather than leaving the manager to look for
   * it — and closing the profile first means the thread is what he is looking at
   * when the overlay goes.
   */
  messagePlayer: (personId) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const conversationId = openPlayerThread(state, personId);
    if (!conversationId) return;
    markConversationRead(state, conversationId);
    set({ game: state, view: 'inbox', openConversationId: conversationId, error: null, profile: null });
  },

  sendPlayerIntent: (personId, intent) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const conversationId =
      state.communication?.conversations[openPlayerThread(state, personId) ?? '']?.id ??
      openPlayerThread(state, personId);
    if (!conversationId) return;
    const sent = sendPlayerMessage(state, personId, intent);
    if (!sent) return;
    // The reply has arrived unread — unless the manager happens to be sitting in
    // this thread already, in which case the answer is in front of him and a
    // badge would be asking him to open the thread he is reading.
    markOpenThreadRead(state, get().openConversationId);
    set({
      game: state,
      error: null,
      notice: sent.followUp
        ? `${state.people[personId]?.firstName ?? 'He'} will let you know.`
        : null,
    });
  },

  /**
   * The Continue button.
   *
   * Days are simulated, one at a time, until something needs the manager. The
   * clock stops *before* a day worth looking at is simulated — so he sees
   * "Training tonight" standing on Thursday — and refuses to move at all when
   * there is something he cannot let slide, like an unplayed match.
   */
  continueGame: async () => {
    const game = get().game;
    // A second press while the clock is still moving would run a second copy of
    // the same day, and the two would fight over one state.
    if (!game || get().advancing) return;
    const state = clone(game);
    // Moving the clock across a matchday means running the match engine once per
    // other club, which is seconds of work. It is done a fixture at a time, and
    // the progress dialog opens only if a fixture is actually reached: a
    // Tuesday with nothing on it must not produce a bar for a wait that never
    // happened.
    await runWithProgress(state, continueTimeSteps(state), (outcome) => {
      // The view is left alone: working out where the manager should be looking
      // is the command bar's job, and yanking him into a screen is how players
      // lose track of what just happened.
      set({ game: state, error: null, notice: continueNotice(outcome) });
    });
  },

  /**
   * One day at a time.
   *
   * A day that cannot pass — an unplayed fixture, the end of the season — is
   * surfaced rather than skipped, because the whole point of stopping the clock
   * is that the manager does not lose a game he forgot to play.
   */
  advanceDays: async (days) => {
    const game = get().game;
    if (!game || get().advancing) return;
    const state = clone(game);
    const blocked = currentAttention(state);
    if (blocked && blocked.kind !== 'flagged') {
      set({ game: state, error: null, notice: `${blocked.headline} — ${blocked.detail}` });
      return;
    }
    const wanted = Math.max(1, Math.min(30, Math.round(days)));
    await runWithProgress(
      state,
      advanceDaysSteps(state, wanted),
      (notes) => set({ game: state, error: null, notice: notes.join(' ') || null }),
      'Moving the calendar',
    );
  },

  /** Run the calendar forward to a date, stopping for anything that matters. */
  jumpToDate: async (date) => {
    const game = get().game;
    if (!game || get().advancing) return;
    if (date <= game.date) {
      set({ error: 'That day has already been and gone.' });
      return;
    }
    const state = clone(game);
    const days = daysBetween(state.date, date);
    if (days > 120) {
      set({ error: 'That is more than four months away — pick something closer.' });
      return;
    }
    await runWithProgress(
      state,
      jumpToDateSteps(state, days),
      (notes) => set({ game: state, error: null, notice: notes.join(' ') || `Calendar moved to ${date}.` }),
      'Moving the calendar',
    );
  },

  beginSetup: (mode) => {
    set({
      setup: { mode, profile: defaultManagerProfile() },
      view: 'profile',
      error: null,
      notice: null,
    });
  },

  cancelSetup: () => set({ draft: null, setup: null, view: 'start', error: null }),

  setManagerProfile: (profile) => {
    const setup = get().setup;
    set({ setup: { mode: setup?.mode ?? 'career', profile }, error: null });
  },

  createDraft: (seed) => {
    const draft = generateDraft({ seed, startYear: 2026 });
    const mode = get().setup?.mode ?? 'career';
    // Building a club means designing it before it exists, so it goes to the
    // designer; taking one over goes straight to the list.
    set({ draft, view: mode === 'create-club' ? 'create-club' : 'select-club', error: null });
  },

  chooseClub: (clubId) => {
    const draft = get().draft;
    if (!draft) return;
    const profile = get().setup?.profile;
    const state = startGameFromDraft(draft, {
      ...{ seed: draft.seed, startYear: draft.startYear },
      clubId,
      saveName: `${draft.clubs[clubId]?.identity.name ?? 'Club'} — ${draft.seed}`,
      manager: profile,
    });
    // Once he is in charge of a club, the manager he wrote is worth keeping:
    // the next career should not ask him for his birthday again.
    if (profile) rememberProfile(profile);
    set({
      game: state,
      draft: null,
      setup: null,
      view: 'dashboard',
      error: null,
      notice: null,
      profile: null,
      negotiationId: null,
      plannerOpen: false,
    });
  },

  createCustomClub: (design) => {
    const draft = get().draft;
    if (!draft) return;
    const clubId = applyCustomClub(draft, design);
    const profile = get().setup?.profile;
    const state = startGameFromDraft(draft, {
      seed: draft.seed,
      startYear: draft.startYear,
      clubId,
      saveName: `${draft.clubs[clubId]?.identity.name ?? design.name} — ${draft.seed}`,
      manager: profile,
    });
    if (profile) rememberProfile(profile);
    set({
      game: state,
      draft: null,
      setup: null,
      view: 'dashboard',
      error: null,
      notice: `${design.name.trim()} are up and running.`,
      profile: null,
      negotiationId: null,
      plannerOpen: false,
    });
  },

  // Backing out of club selection returns to the setup step, not the menu: the
  // manager has already said who he is and does not want to say it again.
  abandonDraft: () => set({ draft: null, view: get().setup ? 'profile' : 'start' }),

  saveGame: async (slot) => {
    const game = get().game;
    if (!game) return;
    const info = await persistence.saveGame(game, slot);
    if (!info) {
      set({ error: 'The browser would not store that save — its storage is full or blocked.' });
      return;
    }
    set({ notice: `Saved to slot "${slot}" (${info.clubName}).` });
  },

  loadGame: async (slot) => {
    const result = await persistence.loadGame(slot);
    if (!result.state) {
      set({ error: result.error });
      return;
    }
    // Loading a save makes it the career the game is playing, so it is the one
    // the next reload should come back to — until something else is played.
    await persistence.setResumeSlot(slot);
    // A save written before today's fixtures were prepared would otherwise
    // resume with two empty teams; this fills them in from the same seed.
    readyForManager(result.state);
    // A loaded save is never mid-match: the session is dropped and the engine
    // state inside the match object is authoritative.
    forgetLiveEngine();
    set({
      game: result.state,
      session: null,
      replay: null,
      view: 'dashboard',
      profile: null,
      negotiationId: null,
      plannerOpen: false,
      error: null,
      notice: `Loaded ${result.state.saveName}.`,
    });
  },

  listSaves: () => persistence.listSaveSlots(),

  quitToMenu: async () => {
    // Quitting forgets where to resume, so the menu stays reachable — but the
    // autosave is left on disk, so quitting never costs the manager a career.
    await persistence.setResumeSlot(null);
    forgetLiveEngine();
    set({
      game: null,
      session: null,
      replay: null,
      setup: null,
      view: 'start',
      selectedPlayerId: null,
      notice: null,
      profile: null,
      negotiationId: null,
      plannerOpen: false,
      dialog: null,
    });
  },

  startUserMatch: () => {
    const game = get().game;
    if (!game) return;
    // A new afternoon: whatever engine was playing the last one is forgotten.
    forgetLiveEngine();
    const state = clone(game);
    // Nobody kicks off against a side that has not been picked.
    readyForManager(state);
    const matchday = nextMatchday(state);
    const match = nextFixtureFor(state, state.userClubId, state.date);
    if (!match) {
      set({ error: 'No fixture to play.' });
      return;
    }

    // Thursday comes before Sunday: whatever the squad did in training this
    // week is already in their legs and in their heads when the whistle goes.
    // A friendly is not a league week, so it does not consume the week's session.
    //
    // Only once that Thursday has actually been and gone, though. A cup tie
    // falls *before* the week's session, and running it here would bank the
    // session — and mark the Thursday as trained — before the evening it is
    // supposed to happen.
    if (isCompetitiveMatch(state, match) && sessionDateFor(state, matchday) <= state.date) {
      ensureClubTrained(state, state.userClubId, matchday);
    }
    // The phone calls come just before you leave for the ground.
    const lateCalls = callLateWithdrawals(state, match, state.date);
    if (lateCalls.length > 0) publishEvents(state, lateCalls);

    // A side that cannot field seven has no game to play. Choosing to play with
    // fewer than that abandons the fixture: the opposition is awarded the win
    // and the manager is handed straight back to the week, rather than into a
    // match he cannot field a team for.
    const forfeit = settleShortSides(state, match);
    if (forfeit) {
      publishEvents(state, forfeit.events);
      state.lastMatchId = match.id;
      state.pendingMatchId = null;
      readyForManager(state);
      set({ game: state, session: null, notice: forfeit.note, error: null });
      return;
    }

    const working = clone(match);
    const side: 'home' | 'away' = working.homeClubId === state.userClubId ? 'home' : 'away';
    state.pendingMatchId = working.id;

    // The match opens in the dressing room, not on the pitch: the manager gets
    // the fixture, the opposition, a team talk and a warm-up first, and kicks
    // off when he is ready. Nothing here has started the clock — the match in
    // the calendar is still `scheduled` until he says so.
    set({
      game: state,
      session: {
        matchId: working.id,
        live: working,
        side,
        // The speed the manager asked for, not the speed the match happens to
        // open at. The controls still change it mid-match.
        speed: clampSpeed(get().preferences.defaultMatchSpeed),
        // The manager watches the whole match until he says otherwise; the
        // controls change it mid-afternoon, exactly as they change the speed.
        viewingMode: 'full',
        paused: true,
        phase: 'pre-match',
        revision: 0,
        lastMinuteEvents: 0,
        teamTalk: null,
        halfTimeTalk: null,
        fullTimeTalk: null,
        warmUp: 'normal',
      },
      view: 'match',
      error: null,
    });
  },

  kickOff: () => {
    const session = get().session;
    const game = get().game;
    if (!session || !game || session.phase !== 'pre-match') return;
    const live = session.live;

    // The talk lands on the men who are playing, and is either taken or not.
    const deltas: number[] = [];
    if (session.teamTalk) {
      for (const slot of live.lineups[session.side].starting) {
        const player = game.people[slot.playerId];
        if (!isPlayer(player)) continue;
        const delta = teamTalkMoraleDelta(session.teamTalk, player);
        deltas.push(delta);
        player.morale = Math.max(0, Math.min(100, player.morale + delta));
      }
    }

    // The warm-up is what is in their legs when the whistle goes, and the
    // tactical rehearsal leaves a little of the shape behind for good.
    const energy = warmUpEnergyDelta(session.warmUp);
    for (const slot of live.lineups[session.side].starting) {
      const player = game.people[slot.playerId];
      if (isPlayer(player)) applyWarmUpToFamiliarity(session.warmUp, player);
    }

    // The whistle: the engine is built, the performances are created, and the
    // warm-up is put into their legs before the first step is played. The engine
    // carries stamina on its own player nodes, so the warm-up has to reach both
    // the record and the legs the movement rules read.
    startLiveEngine(game, live);
    const engine = currentLiveEngine();
    for (const slot of live.lineups[session.side].starting) {
      const performance = live.performances[slot.playerId];
      if (!performance) continue;
      performance.energy = Math.max(5, Math.min(100, performance.energy + energy));
      const node = engine?.getState().players.find((player) => player.playerId === slot.playerId);
      if (node) node.stamina = performance.energy;
    }

    const line = session.teamTalk ? teamTalkVerdict(session.teamTalk, deltas) : null;
    set({
      game,
      session: { ...session, live, phase: 'in-progress', paused: false, revision: session.revision + 1 },
      error: null,
      notice: line,
    });
  },

  resumeSecondHalf: () => {
    const session = get().session;
    const game = get().game;
    if (!session || !game || session.phase !== 'half-time') return;

    // The engine is stopped in the interval; this is the whistle that starts the
    // second half. The presentation resumes from the same second, so the clock
    // does not jump the fifteen minutes nobody watched. That second is the
    // engine's own — 45:00 plus the first half's added time — not 45:00: the
    // clock never rewinds across the interval, only the displayed minute does.
    const engine = currentLiveEngine();
    engine?.startSecondHalf();
    setLivePlayback({ cursor: engine?.getState().clock ?? 45 * 60, skipping: false });

    // Fifteen minutes is enough time to change the message as well as the team.
    let line: string | null = null;
    if (session.halfTimeTalk) {
      const deltas: number[] = [];
      for (const slot of session.live.lineups[session.side].starting) {
        const player = game.people[slot.playerId];
        if (!isPlayer(player)) continue;
        const delta = teamTalkMoraleDelta(session.halfTimeTalk, player);
        deltas.push(delta);
        player.morale = Math.max(0, Math.min(100, player.morale + delta));
      }
      line = teamTalkVerdict(session.halfTimeTalk, deltas);
    }

    set({
      game,
      session: { ...session, phase: 'in-progress', paused: false, revision: session.revision + 1 },
      notice: line,
    });
  },

  setTeamTalk: (talk) => {
    const session = get().session;
    if (!session || session.phase !== 'pre-match') return;
    set({ session: { ...session, teamTalk: talk, revision: session.revision + 1 } });
  },

  setHalfTimeTalk: (talk) => {
    const session = get().session;
    if (!session || session.phase !== 'half-time') return;
    set({ session: { ...session, halfTimeTalk: talk, revision: session.revision + 1 } });
  },

  setFullTimeTalk: (talk) => {
    const session = get().session;
    if (!session || session.phase !== 'full-time') return;
    set({ session: { ...session, fullTimeTalk: talk, revision: session.revision + 1 } });
  },

  setWarmUp: (warmUp) => {
    const session = get().session;
    if (!session || session.phase !== 'pre-match') return;
    set({ session: { ...session, warmUp, revision: session.revision + 1 } });
  },

  swapSessionPlayers: (outgoingId, incomingId) => {
    const session = get().session;
    const game = get().game;
    if (!session || !game || session.phase !== 'pre-match') return;
    const lineup = session.live.lineups[session.side];
    const startIndex = lineup.starting.findIndex((slot) => slot.playerId === outgoingId);
    const benchIndex = lineup.bench.findIndex((slot) => slot.playerId === incomingId);
    if (startIndex < 0 || benchIndex < 0) return;
    const incoming = game.people[incomingId];
    if (!isPlayer(incoming)) return;
    const outgoingSlot = lineup.starting[startIndex]!;
    const benchSlot = lineup.bench[benchIndex]!;
    lineup.starting[startIndex] = {
      playerId: incomingId,
      position: outgoingSlot.position,
      role: defaultRoleFor(outgoingSlot.position),
      outOfPosition: (incoming.positionalFamiliarity[outgoingSlot.position] ?? 0) < 12,
    };
    lineup.bench[benchIndex] = { playerId: outgoingId, position: benchSlot.position, role: benchSlot.role };
    set({ session: { ...session, live: session.live, revision: session.revision + 1 } });
  },

  instantResult: () => {
    const game = get().game;
    if (!game) return;
    const match = nextFixtureFor(game, game.userClubId, game.date);
    if (!match) {
      set({ error: 'No fixture to simulate.' });
      return;
    }
    const state = clone(game);
    readyForManager(state);
    const matchday = nextMatchday(state);
    if (isCompetitiveMatch(state, match) && sessionDateFor(state, matchday) <= state.date) {
      ensureClubTrained(state, state.userClubId, matchday);
    }
    // Even handed to somebody else, a side with fewer than seven players cannot
    // take the field: the fixture is forfeited rather than simulated.
    const forfeit = settleShortSides(state, match);
    if (forfeit) {
      publishEvents(state, forfeit.events);
      state.lastMatchId = match.id;
      state.pendingMatchId = null;
      readyForManager(state);
      set({ game: state, session: null, replay: null, view: 'dashboard', notice: forfeit.note });
      return;
    }

    const working = state.matches[match.id]!;
    forgetLiveEngine();
    const env = matchEnvironment(state, working, { autoManageAllBenches: true });
    const instant = simulateMatchEngine(working, env);
    narrateDrained(working, env, instant.drain());
    syncEnginePossession(working, instant);
    const events = [...applyMatchConsequences(state, working).events, matchReportEvent(state, working)];
    applyMatchdayFinances(state, working);
    settleSubsFor(state, working);
    state.lastMatchId = working.id;
    state.pendingMatchId = null;
    publishEvents(state, events);
    readyForManager(state);
    set({ game: state, session: null, replay: null, view: 'dashboard' });
  },

  advanceSpatial: (deltaSeconds) => {
    const session = get().session;
    const game = get().game;
    if (!session || !game) return;
    if (session.phase !== 'in-progress' || session.paused) return;
    const live = session.live;
    const engine = currentLiveEngine();
    if (!engine) return;

    // The presentation decides how much football this frame is worth. The
    // cursor moves through simulation seconds at whatever rate the passage it
    // is inside deserves — fast through ordinary play, slow through a chance —
    // and the engine is then asked to have played exactly that far. Nothing
    // about the football changes with the viewing mode or the speed: the same
    // steps are played, only spent at a different rate on screen. Because the
    // engine never leads the picture by more than the moment a skip is still
    // spending, the clock, the score and the commentary all describe the second
    // the manager is looking at rather than one that has not been shown yet.
    const playback = livePlayback() ?? { cursor: engine.getState().clock, skipping: false };
    const tick = tickPlayback(playback, session.viewingMode, session.speed, liveTimelineFor(live), deltaSeconds);
    const played = engine.getState().clock;
    const need = tick.cursor - played;
    const spoke = need > 0 ? advanceLiveEngine(game, live, need, Math.max(1, need)) : false;
    setLivePlayback({ cursor: tick.cursor, skipping: tick.skipping });
    // The skip ending is itself worth telling the screen about: the control says
    // "skipping" while it runs, and a skip that lands on a quiet passage would
    // otherwise leave the word up until the football next said something.
    const skipEnded = playback.skipping && !tick.skipping;

    // Half time and full time are the engine's own phases; the store turns them
    // into the afternoon's shape (the clock stopping, the card coming up) rather
    // than the engine knowing anything about a manager's screen.
    if (engine.finished) {
      commitFinishedMatch(set, get, live);
      return;
    }
    if (engine.getState().phase === 'half-time') {
      // The interval stops the clock, so the presentation stops with it: the
      // cursor is pinned to the whistle rather than running on into nothing.
      setLivePlayback({ cursor: engine.getState().clock, skipping: false });
      set({
        session: { ...session, live, phase: 'half-time', paused: true, revision: session.revision + 1 },
      });
      return;
    }

    if (spoke || skipEnded) set({ session: { ...session, live, revision: session.revision + 1 } });
  },

  tickMatch: () => tickMatch(set, get),

  simulateMatchToEnd: () => {
    const session = get().session;
    const game = get().game;
    if (!session || !game) return;
    const live = session.live;
    const engine = currentLiveEngine();
    if (live.status === 'finished' || engine?.finished) {
      commitFinishedMatch(set, get, live);
      return;
    }
    // When the manager skips ahead the bench is managed for them: somebody has
    // to make the changes while they are in the tea hut. The engine plays the
    // rest out at full speed — the fixed-step guarantee is unchanged, because
    // the steps are the same steps whatever pace they are taken at.
    setAutoManageBenches(true);
    const env = liveEngineEnv() ?? matchEnvironment(game, live, { autoManageAllBenches: true });
    const played = engine ?? liveEngineFor(live, env);
    played.runToCompletion();
    narrateDrained(live, env, played.drain());
    syncEnginePossession(live, played);
    // The whole match has been played out, so the presentation has seen all of
    // it: the cursor goes to the final whistle with the engine.
    setLivePlayback({ cursor: played.getState().clock, skipping: false });
    commitFinishedMatch(set, get, live);
  },

  setMatchSpeed: (speed) => {
    const session = get().session;
    if (!session) return;
    set({ session: { ...session, speed, paused: false, revision: session.revision + 1 } });
  },

  setViewingMode: (mode) => {
    const session = get().session;
    if (!session || !VIEWING_MODES.includes(mode)) return;
    // Presentation only: the football does not change, only how much of it is
    // watched from here on. A fast-forward in progress is abandoned so the new
    // mode takes effect now rather than when the old one's skip runs out.
    const playback = livePlayback();
    if (playback) setLivePlayback({ cursor: playback.cursor, skipping: false });
    set({ session: { ...session, viewingMode: mode, revision: session.revision + 1 } });
  },

  skipToNextHighlight: () => {
    const session = get().session;
    if (!session || session.phase !== 'in-progress') return;
    const engine = currentLiveEngine();
    if (!engine) return;
    // Fast-forward the *presentation*, not the simulation: the cursor runs to
    // the next passage this mode would show and stops there. The football is
    // played at the pace the cursor spends it, so nothing is skipped in the
    // record — only in what has been watched.
    const playback = livePlayback() ?? { cursor: engine.getState().clock, skipping: false };
    setLivePlayback(beginSkip(playback));
    set({ session: { ...session, paused: false, revision: session.revision + 1 } });
  },

  toggleMatchPause: () => {
    const session = get().session;
    if (!session) return;
    set({ session: { ...session, paused: !session.paused, revision: session.revision + 1 } });
  },

  finishMatchSession: () => {
    const session = get().session;
    const game = get().game;
    if (!session || !game) {
      set({ session: null });
      return;
    }

    // The last word goes to the whole matchday squad, substitutes included,
    // and it lands differently on each of them: the man who knows he played
    // well and the man who knows he did not hear the same sentence differently.
    const talk = session.fullTimeTalk ?? 'nothing';
    const outcome = fullTimeOutcome(currentScore(session.live), session.side);
    const lineup = session.live.lineups[session.side];
    const deltas: number[] = [];
    for (const slot of [...lineup.starting, ...lineup.bench]) {
      const player = game.people[slot.playerId];
      if (!isPlayer(player)) continue;
      const rating = session.live.performances[slot.playerId]?.rating ?? null;
      const delta = fullTimeTalkMoraleDelta(talk, player, { ...outcome, rating });
      deltas.push(delta);
      player.morale = Math.max(0, Math.min(100, player.morale + delta));
    }

    set({
      game,
      session: null,
      view: 'dashboard',
      notice: session.fullTimeTalk ? fullTimeTalkVerdict(talk, deltas, outcome.result) : null,
    });
  },

  makeSubstitution: (outgoingId, incomingId) => {
    const session = get().session;
    const game = get().game;
    if (!session || !game) return;
    const live = session.live;
    const side = session.side;
    // Before kick-off, changing the XI is selection, not substitution — that is
    // swapSessionPlayers, and it does not spend one of the three.
    if (session.phase === 'pre-match') return;
    if (live.substitutions[side] >= 3) {
      set({ error: 'No substitutions left.' });
      return;
    }

    // The change is the engine's to make: it swaps the man on the pitch, keeps
    // his slot, writes the substitution event and the new performance. The store
    // only carries the message back to the screen.
    const engine = currentLiveEngine();
    const env = liveEngineEnv();
    if (!engine || !env) return;
    const made = engine.substitute(side, outgoingId, incomingId);
    if (!made) {
      set({ error: 'That change could not be made.' });
      return;
    }
    narrateDrained(live, env, engine.drain());
    set({ session: { ...session, live, revision: session.revision + 1 }, error: null });
  },

  setMatchTactics: (tactics) => {
    const session = get().session;
    if (!session) return;
    const live = session.live;
    live.lineups[session.side].tactics = tactics;
    live.lineups[session.side].formation = tactics.formation;
    // The shape is the engine's to play: it re-reads the formation and moves the
    // slot anchors, and the men walk to the new shape under the ordinary rules.
    currentLiveEngine()?.refreshFormation(session.side);
    set({ session: { ...session, live, revision: session.revision + 1 } });
  },

  rollOverSeason: () => {
    const game = get().game;
    if (!game) return;
    forgetLiveEngine();
    const state = clone(game);
    const events = startNextSeason(state);
    publishEvents(state, events);
    // A new season is a new set of shirts: the designs are drawn from the seed
    // and the season label, so the kit changes here without anything being
    // stored for it. The manager gets told, because it is the first thing
    // anybody notices about a club in August.
    const kit = clubKit(state, state.userClubId);
    const kitLine = kit
      ? ` ${kit.maker.name} have sent the new kit down${kit.sponsor ? ` — ${kit.sponsor.name} across the chest.` : ', blank-chested again.'}`
      : '';
    set({
      game: state,
      session: null,
      view: 'dashboard',
      notice: `${state.season.label} pre-season begins.${kitLine}`,
    });
  },

  askForRecommendations: () =>
    recruitmentAction({ set, get }, (state) => {
      const result = askSquadForNames(state);
      return { events: result.events, messages: result.messages };
    }),

  checkFiveASide: () =>
    recruitmentAction({ set, get }, (state) => {
      const result = watchFiveASide(state);
      return { events: result.events, messages: result.messages };
    }),

  holdOpenSession: () =>
    recruitmentAction({ set, get }, (state) => {
      const result = runOpenSession(state);
      return { events: result.events, messages: result.messages };
    }),

  runTrialSession: () =>
    recruitmentAction({ set, get }, (state) => {
      const result = runSession(state);
      return { events: result.events, messages: result.messages };
    }),

  watchCandidate: (personId) =>
    recruitmentAction({ set, get }, (state) => {
      const result = observeCandidate(state, personId);
      return { events: result.events, messages: result.messages };
    }),

  inviteToTrial: (personId) =>
    recruitmentAction({ set, get }, (state) => {
      const result = inviteCandidate(state, personId);
      return { events: result.events, messages: [result.message] };
    }),

  approachCandidate: (personId) =>
    recruitmentAction({ set, get }, (state) => {
      const result = askCandidate(state, personId);
      return { events: result.events, messages: [result.message] };
    }),

  offerToJoin: (personId) =>
    recruitmentAction({ set, get }, (state) => {
      const result = signCandidate(state, personId);
      return { events: result.events, messages: [result.message] };
    }),

  passOnCandidate: (personId, reason) =>
    recruitmentAction({ set, get }, (state) => {
      passOnCandidate(state, personId, reason);
      return { events: [], messages: ['Noted. He comes off the list.'] };
    }),

  runTrainingSession: () => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    // The week's session, keyed the way the calendar keys it — a league
    // matchday in the season, a negative pre-season week before it. Using the
    // next matchday instead would collapse every pre-season Thursday onto
    // matchday one, so the second week reads as already done.
    const matchday = currentSessionKey(state);
    // Run it when the manager is ready: the report is then in front of him
    // before he picks the team. Left alone, it runs itself before kick-off.
    const outcome = ensureClubTrained(state, state.userClubId, matchday);
    publishEvents(state, outcome.events);
    const session = outcome.session;
    set({
      game: state,
      error: null,
      notice: !session
        ? 'That session has already been run this week.'
        : session.cancelled
          ? session.summary
          : `Training: ${session.attended} turned up. ${describeSessionQuality(session.quality).label}.`,
    });
  },

  setTrainingLength: (length) =>
    trainingPlanAction({ set, get }, (plan) => {
      plan.length = length;
    }),

  toggleTrainingBlock: (block) =>
    trainingPlanAction({ set, get }, (plan) => {
      const index = plan.blocks.indexOf(block);
      if (index >= 0) plan.blocks.splice(index, 1);
      else plan.blocks.push(block);
    }),

  setTrainingFallbackVenue: (value) =>
    trainingPlanAction({ set, get }, (plan) => {
      plan.fallbackVenue = value;
    }),

  resetTrainingPlan: () =>
    trainingPlanAction({ set, get }, (plan) => {
      plan.length = 'normal';
      plan.blocks = ['warm-up', 'possession', 'tactical', 'teamwork'];
      plan.fallbackVenue = false;
    }),

  resolveAdmin: (id) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const managerId = state.clubs[state.userClubId]?.managerId ?? null;
    const event = resolveAdminEvent(state, id, state.date, managerId);
    if (!event) return;
    set({ game: state, error: null, notice: `Filed: ${event.title}.` });
  },

  requestBacking: () => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const result = requestChairmanBacking(state, state.userClubId);
    const notice =
      result.reason === 'granted'
        ? `The chairman has put ${money(result.amount)} into the club.`
        : result.reason === 'no-need'
          ? 'The club is not in the red — there is nothing to ask for.'
          : result.reason === 'already-asked'
            ? 'You have already been to the chairman this season.'
            : result.reason === 'no-chairman'
              ? 'There is nobody in the chair to ask.'
              : 'The chairman turned you down.';
    set({ game: state, error: null, notice });
  },

  seekSponsor: () => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    if (activeDealForClub(state, state.userClubId)) {
      set({ notice: 'The club already has a sponsor.' });
      return;
    }
    const result = seekClubSponsor(state, state.userClubId);
    const notice =
      result.outcome === 'accepted' && result.deal
        ? `${result.businessName} agree to sponsor the club — ${money(result.deal.instalment)} ${
            result.deal.terms.frequency === 'weekly' ? 'a week' : 'a month'
          }.`
        : result.outcome === 'no-business'
          ? 'There is nobody local left to ask.'
          : 'Nobody local would take it on this time.';
    set({ game: state, error: null, notice });
  },

  collectSubs: (playerId, amount) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const result = collectClubSubs(state, state.userClubId, playerId, state.date, amount);
    if (result.collected <= 0) {
      set({ notice: 'There is nothing to collect from him.' });
      return;
    }
    const person = state.people[playerId];
    const name = person ? personDisplayName(person) : 'the player';
    set({
      game: state,
      error: null,
      notice:
        result.owedAfter > 0
          ? `Took ${money(result.collected)} in subs from ${name}. ${money(result.owedAfter)} still owed.`
          : `Took ${money(result.collected)} in subs from ${name}. He is up to date.`,
    });
  },

  chooseKit: (option) => {
    const game = get().game;
    if (!game) return;
    if (!Number.isInteger(option) || option < 0 || option >= KIT_OPTION_COUNT) return;
    const state = clone(game);
    const club = state.clubs[state.userClubId];
    if (!club) return;
    // "Already chosen" means *for this season*, not "the same design as before".
    // Bailing out on an unchanged design would mean a manager who confirms the
    // first shirt — which is what an unset club is already wearing — never
    // settles anything, and the kit prompt sat on the dashboard for ever.
    const alreadySettled = club.kitSeason === state.season.label;
    if (alreadySettled && (club.kitChoice ?? 0) === option) return;
    club.kitChoice = option;
    // Recorded so the kit screen can stop offering itself once the manager has
    // chosen, and start again at the next pre-season without anything having to
    // reset it.
    club.kitSeason = state.season.label;
    const kit = clubKit(state, club.id);
    set({
      game: state,
      notice: kit
        ? `The ${kit.season} kit is in: ${kit.maker.name} shirts, ${kit.sponsor ? `${kit.sponsor.name} across the chest.` : 'no shirt sponsor this season.'}`
        : 'That kit is not on offer.',
    });
  },

  updateClubTactics: (tactics) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const club = state.clubs[state.userClubId]!;
    club.tactics = tactics;
    const match = nextFixtureFor(state, state.userClubId, state.date);
    if (match && !match.played) {
      const side = match.homeClubId === state.userClubId ? 'home' : 'away';
      match.lineups[side].tactics = { ...tactics };
      match.lineups[side].formation = tactics.formation;
    }
    set({ game: state });
  },

  updateFixtureLineup: (updater) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const match = nextFixtureFor(state, state.userClubId, state.date);
    if (!match || match.played) return;
    const side = match.homeClubId === state.userClubId ? 'home' : 'away';
    match.lineups[side] = updater(match.lineups[side]);
    set({ game: state });
  },
}));

/**
 * The autosave follows the store rather than living inside every action.
 *
 * A new `game` object *is* a change to the simulation — each action replaces it
 * wholesale, while presentation state is set alongside it — so watching the
 * store here means a new action cannot forget to save, and redrawing a team
 * sheet cannot trigger one.
 */
useGameStore.subscribe((state, previous) => {
  if (state.game && state.game !== previous.game) scheduleAutosave(state.game);
});

/**
 * Open the storage, bring any old careers across, and find the one to reopen.
 *
 * Everything that happens before the game can be shown happens here, in order,
 * and the store is not marked `ready` until all of it has:
 *
 *   1. open the database, and import any localStorage careers into it — so a
 *      manager who has been playing for months finds his season waiting rather
 *      than being told he has none;
 *   2. read the resume mark and the career it names.
 *
 * Only then does the store decide what the first screen is. Deciding earlier is
 * the one mistake that would be visible: a menu that said "nothing saved yet"
 * for the length of a database read, with the manager's actual career appearing
 * underneath it a moment later.
 *
 * Failure is not fatal at any point. A browser with no database, a full disk, a
 * refused write — none of them stop the game opening; they cost it the ability
 * to remember, which is announced rather than thrown. This resolves either way
 * so the page is never left waiting on a promise that rejected.
 */
export async function bootStore(): Promise<void> {
  let resumed: GameState | null = null;
  try {
    await persistence.initialise();
    resumed = await persistence.resumeCareer();
  } catch (error) {
    console.warn('Starting without a stored career.', error);
  }
  useGameStore.setState({
    ready: true,
    game: resumed,
    // The manager is put back on his own dashboard: a reload should not cost him
    // his place. No career — or a mark left pointing at one that has since gone
    // — leaves the menu in charge, which is where a new one starts.
    view: resumed ? 'dashboard' : 'start',
  });
}

/**
 * Planning Thursday night is a small change to a small part of the state: the
 * club's standing routine. Editing it never runs the session — that happens
 * when the week is committed, so the manager can change his mind all week.
 */
function trainingPlanAction(
  { set, get }: StoreHooks,
  edit: (plan: ReturnType<typeof currentPlan>) => void,
): void {
  const game = get().game;
  if (!game) return;
  const state = clone(game);
  const plan = currentPlan(state, state.userClubId);
  edit(plan);
  savePlan(state, plan);
  set({ game: state, error: null });
}

/**
 * Advance the watched match by a second of football.
 *
 * Pulled out of the store action so the clock pump and the tests can call it
 * directly. The engine plays the football; this is only the shape of the
 * afternoon around it — stopping at the interval, stopping at the whistle — and
 * telling the screen when either has happened.
 */
function tickMatch(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
): void {
  const session = get().session;
  const game = get().game;
  if (!session || !game) return;
  if (session.phase !== 'in-progress') return;
  if (session.paused) return;

  const live = session.live;
  // A tick is a minute of football, the unit the world has always been advanced
  // in; the engine plays the steps that minute is worth.
  const spoke = advanceLiveEngine(game, live, 60, 60);
  const engine = currentLiveEngine();
  if (!engine) return;
  // A minute of football at a time, with the presentation taken with it: this
  // is the coarse clock used by callers that do not run a frame loop.
  setLivePlayback({ cursor: engine.getState().clock, skipping: false });

  if (engine.finished) {
    commitFinishedMatch(set, get, live);
    return;
  }
  // The half-time whistle stops the clock: fifteen minutes in the changing
  // room is the manager's, and the match waits for him.
  if (engine.getState().phase === 'half-time') {
    set({
      session: { ...session, live, phase: 'half-time', paused: true, revision: session.revision + 1 },
    });
    return;
  }
  if (spoke) set({ session: { ...session, live, revision: session.revision + 1 } });
}

/** Commit a finished match back into the durable game state and apply consequences. */
function commitFinishedMatch(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
  live: Match,
): void {
  const session = get().session;
  const game = get().game;
  if (!session || !game) return;

  const state = clone(game);
  state.matches[live.id] = clone(live);
  const committed = state.matches[live.id]!;
  const events = [...applyMatchConsequences(state, committed).events, matchReportEvent(state, committed)];
  applyMatchdayFinances(state, committed);
  settleSubsFor(state, committed);
  state.lastMatchId = committed.id;
  state.pendingMatchId = null;
  publishEvents(state, events);
  // That is one matchday put to bed, so the next fixture becomes the one the
  // manager is looking at — and wants a team for.
  readyForManager(state);

  set({
    game: state,
    session: { ...session, live: committed, phase: 'full-time', paused: true, revision: session.revision + 1 },
  });
}
