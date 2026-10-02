import { create } from 'zustand';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, MatchId, PersonId, PlayerId } from '@/domain/ids';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import type { GameEvent } from '@/domain/news';
import { isPlayer } from '@/domain/person';
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
import { advanceMinute, beginMatch, currentScore, simulateToCompletion } from '@/simulation/match/engine';
import { advanceSpatial } from '@/simulation/match/spatial';
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
import { ensureUserXi, matchEnvironment } from '@/simulation/matchday';
import { publishEvents } from '@/simulation/news';
import { ensureClubTrained } from '@/simulation/training/session';
import { currentPlan, currentSessionKey, savePlan } from '@/simulation/training/plan';
import { describeSessionQuality, type TrainingBlockId, type TrainingLength } from '@/domain/training';
import {
  applyCustomClub,
  generateDraft,
  startGameFromDraft,
  type ClubDesign,
  type WorldDraft,
} from '@/simulation/gameSetup';
import { defaultManagerProfile, type ManagerProfile } from '@/domain/manager';
import { continueTime, currentAttention, processDay, callLateWithdrawals, readyForToday } from '@/simulation/day';
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
// The kit planner is pure decisions about colours — no React, no rendering — so
// the action that changes the club's kit can name the kit it just changed to.
import { clubKit, KIT_OPTION_COUNT } from '@/ui/kit';
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
  | 'kit'
  | 'world'
  | 'news'
  | 'recruitment'
  | 'training'
  | 'match';

/** Something the manager can pull up over the top of the current screen. */
export interface ProfileTarget {
  kind: 'player' | 'club';
  id: string;
}

export interface MatchSession {
  matchId: MatchId;
  live: Match;
  side: 'home' | 'away';
  /** 1x, 2x or 4x minutes per second. */
  speed: number;
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

export interface GameStore {
  game: GameState | null;
  draft: WorldDraft | null;
  setup: SetupState | null;
  session: MatchSession | null;
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
  /** Which of the game's own dialogs is open, if any. */
  dialog: DialogId | null;
  /** How the game behaves for the person playing it. Held outside any career. */
  preferences: Preferences;

  // Navigation and selection are presentation-only state.
  setView: (view: ViewId) => void;
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

  // The calendar: FM's Continue button, day by day.
  continueGame: () => void;
  advanceDays: (days: number) => void;
  jumpToDate: (date: ISODate) => void;

  // Career lifecycle: choose a mode, say who you are, then take or build a club.
  beginSetup: (mode: SetupMode) => void;
  cancelSetup: () => void;
  setManagerProfile: (profile: ManagerProfile) => void;
  createDraft: (seed: string) => void;
  chooseClub: (clubId: ClubId) => void;
  createCustomClub: (design: ClubDesign) => void;
  abandonDraft: () => void;
  saveGame: (slot: string) => void;
  loadGame: (slot: string) => void;
  listSaves: () => persistence.SaveSlotInfo[];
  quitToMenu: () => void;

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
 */
export function scheduleAutosave(state: GameState): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    persistence.autosave(state);
  }, AUTOSAVE_DELAY_MS);
}

/**
 * Write a pending autosave now, rather than when the timer comes round.
 *
 * A tab can be closed or put in the background inside the debounce window, so
 * the page tells the store when it is going away instead of trusting the timer
 * to win the race.
 */
export function flushAutosave(): void {
  if (autosaveTimer === null) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const game = useGameStore.getState().game;
  if (game) persistence.autosave(game);
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
 * The match environment, kept between frames.
 *
 * The spatial loop asks for this sixty times a second, and rebuilding it every
 * time would be a pile of closures a second for no reason. It is rebuilt only
 * when the game or the live match it points at is replaced.
 */
let spatialEnv: { game: GameState; live: Match; env: ReturnType<typeof matchEnvironment> } | null = null;

function advanceSpatialFor(game: GameState, live: Match, deltaSeconds: number): void {
  if (!spatialEnv || spatialEnv.game !== game || spatialEnv.live !== live) {
    spatialEnv = { game, live, env: matchEnvironment(game, live, { autoManageAllBenches: false }) };
  }
  advanceSpatial(live, spatialEnv.env, deltaSeconds);
}

/**
 * The career to open with, read once as the store is built.
 *
 * The manager is put back on his own dashboard: a reload should not cost him
 * his place. `null` — no career, or a mark left pointing at a save that has
 * since gone — leaves the menu in charge, which is where a new one starts.
 */
const resumedCareer = persistence.resumeCareer();

export const useGameStore = create<GameStore>((set, get) => ({
  game: resumedCareer,
  draft: null,
  setup: null,
  session: null,
  view: resumedCareer ? 'dashboard' : 'start',
  selectedPlayerId: null,
  selectedClubId: null,
  notice: null,
  error: null,
  plannerOpen: false,
  profile: null,
  negotiationId: null,
  dialog: null,
  preferences: loadPreferences(),

  setView: (view) => set({ view, profile: null, negotiationId: null, plannerOpen: false, dialog: null }),
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
   * The Continue button.
   *
   * Days are simulated, one at a time, until something needs the manager. The
   * clock stops *before* a day worth looking at is simulated — so he sees
   * "Training tonight" standing on Thursday — and refuses to move at all when
   * there is something he cannot let slide, like an unplayed match.
   */
  continueGame: () => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const outcome = continueTime(state);
    // The clock stops on the day things happen, so today's own fixtures have to
    // be made ready here rather than being left until a day that never comes.
    readyForManager(state);
    // The view is left alone: working out where the manager should be looking is
    // the command bar's job, and yanking him into a screen is how players lose
    // track of what just happened.
    set({ game: state, error: null, plannerOpen: false, notice: continueNotice(outcome) });
  },

  /**
   * One day at a time.
   *
   * A day that cannot pass — an unplayed fixture, the end of the season — is
   * surfaced rather than skipped, because the whole point of stopping the clock
   * is that the manager does not lose a game he forgot to play.
   */
  advanceDays: (days) => {
    const game = get().game;
    if (!game) return;
    const state = clone(game);
    const blocked = currentAttention(state);
    if (blocked && blocked.kind !== 'flagged') {
      set({ game: state, error: null, notice: `${blocked.headline} — ${blocked.detail}` });
      return;
    }
    const notes: string[] = [];
    const wanted = Math.max(1, Math.min(30, Math.round(days)));
    for (let i = 0; i < wanted; i += 1) {
      const stop = currentAttention(state);
      if (stop && stop.kind !== 'flagged') break;
      const day = processDay(state, state.date, { resolveUserMatch: false });
      notes.push(...day.notes);
      if (day.seasonFinished) break;
    }
    readyForManager(state);
    set({ game: state, error: null, notice: notes.join(' ') || null });
  },

  /** Run the calendar forward to a date, stopping for anything that matters. */
  jumpToDate: (date) => {
    const game = get().game;
    if (!game) return;
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
    const notes: string[] = [];
    for (let i = 0; i < days; i += 1) {
      const stop = currentAttention(state);
      if (stop && stop.kind !== 'flagged') break;
      const day = processDay(state, state.date, { resolveUserMatch: false });
      notes.push(...day.notes);
      if (day.seasonFinished) break;
    }
    readyForManager(state);
    set({ game: state, error: null, notice: notes.join(' ') || `Calendar moved to ${date}.` });
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

  saveGame: (slot) => {
    const game = get().game;
    if (!game) return;
    const info = persistence.saveGame(game, slot);
    if (!info) {
      set({ error: 'The browser would not store that save — local storage is full or blocked.' });
      return;
    }
    set({ notice: `Saved to slot "${slot}" (${info.clubName}).` });
  },

  loadGame: (slot) => {
    const result = persistence.loadGame(slot);
    if (!result.state) {
      set({ error: result.error });
      return;
    }
    // Loading a save makes it the career the game is playing, so it is the one
    // the next reload should come back to — until something else is played.
    persistence.setResumeSlot(slot);
    // A save written before today's fixtures were prepared would otherwise
    // resume with two empty teams; this fills them in from the same seed.
    readyForManager(result.state);
    // A loaded save is never mid-match: the session is dropped and the engine
    // state inside the match object is authoritative.
    set({
      game: result.state,
      session: null,
      view: 'dashboard',
      profile: null,
      negotiationId: null,
      plannerOpen: false,
      error: null,
      notice: `Loaded ${result.state.saveName}.`,
    });
  },

  listSaves: () => persistence.listSaveSlots(),

  quitToMenu: () => {
    // Quitting forgets where to resume, so the menu stays reachable — but the
    // autosave is left on disk, so quitting never costs the manager a career.
    persistence.setResumeSlot(null);
    set({
      game: null,
      session: null,
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
    if (isCompetitiveMatch(state, match)) ensureClubTrained(state, state.userClubId, matchday);
    // The phone calls come just before you leave for the ground.
    const lateCalls = callLateWithdrawals(state, match, state.date);
    if (lateCalls.length > 0) publishEvents(state, lateCalls);
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

    const env = matchEnvironment(game, live, { autoManageAllBenches: false });
    beginMatch(live, env);
    for (const slot of live.lineups[session.side].starting) {
      const performance = live.performances[slot.playerId];
      if (performance) performance.energy = Math.max(5, Math.min(100, performance.energy + energy));
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
      outOfPosition: (incoming.positionalFamiliarity[outgoingSlot.position] ?? 0) < 12,
    };
    lineup.bench[benchIndex] = { playerId: outgoingId, position: benchSlot.position };
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
    if (isCompetitiveMatch(state, match)) ensureClubTrained(state, state.userClubId, matchday);
    const working = state.matches[match.id]!;
    const env = matchEnvironment(state, working, { autoManageAllBenches: true });
    simulateToCompletion(working, env);
    const events = [...applyMatchConsequences(state, working).events, matchReportEvent(state, working)];
    applyMatchdayFinances(state, working);
    state.lastMatchId = working.id;
    state.pendingMatchId = null;
    publishEvents(state, events);
    readyForManager(state);
    set({ game: state, session: null, view: 'dashboard' });
  },

  advanceSpatial: (deltaSeconds) => {
    const session = get().session;
    const game = get().game;
    if (!session || !game) return;
    if (session.phase !== 'in-progress' || session.paused) return;
    const live = session.live;
    if (!live.spatial) return;
    // The environment is the same one the engine has been using, so a player's
    // pace and the state of his legs come from where they already live.
    advanceSpatialFor(game, live, deltaSeconds);
  },

  tickMatch: () => {
    const session = get().session;
    const game = get().game;
    if (!session || !game) return;
    if (session.phase !== 'in-progress') return;
    if (session.paused) return;

    const live = session.live;
    const env = matchEnvironment(game, live, { autoManageAllBenches: false });
    const result = advanceMinute(live, env);

    if (result.finished) {
      commitFinishedMatch(set, get, live);
      return;
    }
    // The half-time whistle stops the clock: fifteen minutes in the changing
    // room is the manager's, and the match waits for him.
    if (result.halfTime) {
      set({
        session: { ...session, live, phase: 'half-time', paused: true, revision: session.revision + 1, lastMinuteEvents: result.events.length },
      });
      return;
    }
    set({
      session: { ...session, live, revision: session.revision + 1, lastMinuteEvents: result.events.length },
    });
  },

  simulateMatchToEnd: () => {
    const session = get().session;
    const game = get().game;
    if (!session || !game) return;
    const live = session.live;
    if (live.status === 'finished') {
      commitFinishedMatch(set, get, live);
      return;
    }
    // When the manager skips ahead the bench is managed for them: somebody has
    // to make the changes while they are in the tea hut.
    simulateToCompletion(live, matchEnvironment(game, live, { autoManageAllBenches: true }));
    commitFinishedMatch(set, get, live);
  },

  setMatchSpeed: (speed) => {
    const session = get().session;
    if (!session) return;
    set({ session: { ...session, speed, paused: false, revision: session.revision + 1 } });
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
    const lineup = live.lineups[side];
    if (live.substitutions[side] >= 3) {
      set({ error: 'No substitutions left.' });
      return;
    }
    const slotIndex = lineup.starting.findIndex((slot) => slot.playerId === outgoingId);
    const benchIndex = lineup.bench.findIndex((slot) => slot.playerId === incomingId);
    if (slotIndex < 0 || benchIndex < 0) return;

    const outgoingPlayer = game.people[outgoingId];
    const incomingPlayer = game.people[incomingId];
    if (!isPlayer(outgoingPlayer) || !isPlayer(incomingPlayer)) return;

    const slot = lineup.starting[slotIndex]!;
    const outgoingPerf = live.performances[outgoingId];
    if (outgoingPerf) outgoingPerf.wentOffMinute = live.minute;

    lineup.bench.splice(benchIndex, 1);
    lineup.starting[slotIndex] = {
      playerId: incomingId,
      position: slot.position,
      outOfPosition: (incomingPlayer.positionalFamiliarity[slot.position] ?? 0) < 12,
    };
    live.performances[incomingId] = {
      playerId: incomingId,
      clubId: lineup.clubId,
      started: false,
      minutesPlayed: 0,
      positionPlayed: slot.position,
      goals: 0,
      assists: 0,
      shots: 0,
      shotsOnTarget: 0,
      passes: 0,
      passesCompleted: 0,
      tackles: 0,
      interceptions: 0,
      saves: 0,
      fouls: 0,
      yellowCards: 0,
      redCards: 0,
      rating: 6,
      cameOnMinute: live.minute,
      wentOffMinute: null,
      energy: incomingPlayer.fitness,
      injuryDetail: null,
      sentOff: false,
    };
    live.substitutions[side] += 1;
    live.events.push({
      id: `${live.id}_sub${live.events.length + 1}`,
      minute: live.minute,
      type: 'substitution',
      clubId: lineup.clubId,
      playerId: incomingId,
      secondaryPlayerId: outgoingId,
      text: `${incomingPlayer.firstName.charAt(0)}. ${incomingPlayer.surname} replaces ${outgoingPlayer.firstName.charAt(0)}. ${outgoingPlayer.surname}.`,
      x: 0.5,
      y: 0.5,
      scoreAfter: { home: 0, away: 0 },
      importance: 2,
    });

    set({ session: { ...session, live, revision: session.revision + 1 } });
  },

  setMatchTactics: (tactics) => {
    const session = get().session;
    if (!session) return;
    const live = session.live;
    live.lineups[session.side].tactics = tactics;
    live.lineups[session.side].formation = tactics.formation;
    set({ session: { ...session, live, revision: session.revision + 1 } });
  },

  rollOverSeason: () => {
    const game = get().game;
    if (!game) return;
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

  chooseKit: (option) => {
    const game = get().game;
    if (!game) return;
    if (!Number.isInteger(option) || option < 0 || option >= KIT_OPTION_COUNT) return;
    const state = clone(game);
    const club = state.clubs[state.userClubId];
    if (!club || (club.kitChoice ?? 0) === option) return;
    club.kitChoice = option;
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
