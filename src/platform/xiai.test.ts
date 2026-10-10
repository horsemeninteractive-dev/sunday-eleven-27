import { describe, expect, it } from 'vitest';
import { answerFor, HELP, HELP_FACT_ID, KNOWLEDGE, terms, UNKNOWN } from './xiai';

/**
 * XIAI answers questions in the community server from this knowledge base, so
 * these tests are the two things that could go wrong with it: the facts
 * themselves (a duplicate id, an answer too long for a Discord message, a trigger
 * nobody would ever type) and the matcher (a real question landing on the wrong
 * answer, or on no answer at all when it should land on one).
 *
 * Every question below is one somebody would plausibly type in the server, and
 * the expectation is the id of the fact that should answer it.
 */

/** A question, and the id of the fact that has to answer it. */
const QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  ['what is this game', 'what-is-it'],
  // The first question the bot was ever asked in the server, and its first miss.
  ['what is se27', 'what-is-it'],
  ['what does se27 mean', 'what-is-it'],
  ['where do i download it', 'where-to-play'],
  ['how much does it cost', 'price'],
  ['does it cost anything', 'price'],
  ['is it on steam', 'price'],
  ['how long is a season', 'season-structure'],
  ['how do promotions work', 'promotion'],
  ['can i get relegated', 'promotion'],
  ['what are the cups', 'cups'],
  ['how does the cup work', 'cups'],
  ['where are my saves kept', 'saves-where'],
  ['how do i back up my save', 'saves-where'],
  ['how do i move my career to another device', 'move-a-career'],
  ['what is a seed', 'determinism'],
  ['does the world keep going while i am away', 'world-continues'],
  ['why are other matches fast', 'match-modes'],
  ['can i watch a match again', 'replay'],
  ['what can i manage', 'what-you-manage'],
  ['can i play on my phone', 'phone'],
  ['where is the installer', 'desktop'],
  ['do you support controllers', 'controllers'],
  ['are these real clubs', 'real-clubs'],
  ['is there multiplayer', 'multiplayer'],
  ['what version am i on', 'version'],
  ['my game crashed', 'bug'],
  ['where do i report a bug', 'bug'],
  ['where do i suggest something', 'ideas'],
  ['how do i become a playtester', 'playtesting'],
  ['help', 'help'],
];

describe('the knowledge base', () => {
  it('names every fact once, and every fact has something to say', () => {
    const ids = KNOWLEDGE.map((fact) => fact.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const fact of KNOWLEDGE) {
      expect(fact.title.length).toBeGreaterThan(0);
      expect(fact.body.length).toBeGreaterThan(40);
      expect(fact.triggers.length).toBeGreaterThan(0);
      // Where it came from, because an answer that cannot be traced cannot be
      // corrected — which is the whole difference between this and a model
      // making something up in the same tone of voice.
      expect(fact.source.length).toBeGreaterThan(5);
    }
  });

  it('has enough answers to be worth asking, and not so many that they rot', () => {
    expect(KNOWLEDGE.length).toBeGreaterThanOrEqual(20);
    expect(KNOWLEDGE.length).toBeLessThanOrEqual(40);
  });

  it('keeps every answer inside one Discord message', () => {
    // 2000 characters is the API's limit and 4096 is an embed's. Going over it
    // is a 400 at the moment somebody asks, which is the worst possible time to
    // find out.
    for (const fact of KNOWLEDGE) {
      expect(fact.body.length, `${fact.id} is ${fact.body.length} characters`).toBeLessThan(2000);
    }
    expect(UNKNOWN.length).toBeLessThan(2000);
  });

  it('keeps the command description inside Discord\u2019s own 100 characters', () => {
    // The `/ask` description *is* this string, and Discord refuses a command
    // whose description is longer — so the limit is held here rather than
    // discovered by a failed registration.
    expect(HELP.length).toBeLessThanOrEqual(100);
    expect(HELP.length).toBeGreaterThan(20);
    expect(HELP.trim()).toBe(HELP);
  });

  it('writes its triggers the way a question is written', () => {
    for (const fact of KNOWLEDGE) {
      for (const trigger of fact.triggers) {
        expect(trigger, `${fact.id} → ${trigger}`).toBe(trigger.toLowerCase());
        expect(trigger.trim()).toBe(trigger);
        expect(trigger.length).toBeGreaterThan(1);
        // A trigger made only of words the matcher ignores can never fire.
        expect(terms(trigger).length, `${fact.id} → "${trigger}" matches nothing`).toBeGreaterThan(0);
      }
    }
  });

  it('says where each answer came from, in a form somebody can follow', () => {
    for (const fact of KNOWLEDGE) {
      expect(fact.source, fact.id).toMatch(/\w+\.(md|ts|tsx)/);
    }
  });

  it('has a help entry, which is what a question with no words in it gets', () => {
    expect(KNOWLEDGE.some((fact) => fact.id === HELP_FACT_ID)).toBe(true);
  });
});

describe('the matcher', () => {
  it('answers the questions people actually ask', () => {
    for (const [question, expected] of QUESTIONS) {
      const answer = answerFor(question);
      expect(answer?.fact.id, `"${question}"`).toBe(expected);
    }
  });

  it('prefers the longer match when a question could be about two things', () => {
    // "game" alone is the entry that explains what the game is; "game crashed"
    // is the one that tells somebody what to do about it. The phrase has to win,
    // and that is what the scoring is for.
    expect(answerFor('my game crashed')?.fact.id).toBe('bug');
    expect(answerFor('what is the game')?.fact.id).toBe('what-is-it');
  });

  it('explains itself: it reports the words that did the matching', () => {
    const answer = answerFor('how do promotions work');
    expect(answer).not.toBeNull();
    expect(answer!.matched.length).toBeGreaterThan(0);
    expect(answer!.matched.join(' ')).toMatch(/promotion/);
    expect(answer!.score).toBeGreaterThan(0);
  });

  it('refuses to answer what it does not know', () => {
    for (const question of [
      'good morning everyone',
      'what is the capital of peru',
      'has anyone got a spare ticket for saturday',
      'aaaaaaaaaa',
    ]) {
      expect(answerFor(question), question).toBeNull();
    }
  });

  it('falls back to the help entry when a question has no words to match on', () => {
    // "hi" is not a question it does not understand; it is somebody who has not
    // asked yet.
    for (const question of ['hi', 'what can you do', '', '??']) {
      expect(answerFor(question)?.fact.id, `"${question}"`).toBe(HELP_FACT_ID);
    }
  });

  it('answers the same question the same way every time', () => {
    // The first fact wins a tie. A bot that answers differently on Tuesday is a
    // bot nobody trusts, and this is the test that keeps the tie-break still.
    for (const [question] of QUESTIONS) {
      expect(answerFor(question)?.fact.id).toBe(answerFor(question)?.fact.id);
    }
  });

  it('reads a question as words, dropping what carries no meaning', () => {
    expect(terms('Where do I find my Saves?')).toEqual(['find', 'saves']);
    // An apostrophe is dropped rather than kept: what people type and what they
    // mean have to be the same words.
    expect(terms("the game doesn't work")).toEqual(['game', 'doesnt', 'work']);
    expect(terms('a')).toEqual([]);
    // A word inside another word is not a match: "cup" is not "cupboard".
    expect(answerFor('i put it in the cupboard')).toBeNull();
    expect(answerFor('the cups are in the cupboard')?.fact.id).toBe('cups');
  });

  it('can be given a different knowledge base, which is how it is tested', () => {
    const facts = [
      { id: 'one', title: 'One', triggers: ['treacle'], body: 'A fact about treacle.', source: 'nowhere.md' },
    ];
    expect(answerFor('treacle', facts)?.fact.id).toBe('one');
    expect(answerFor('promotion', facts)).toBeNull();
  });
});
