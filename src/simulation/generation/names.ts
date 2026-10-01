import { Rng } from '../rng';

/**
 * Name pools. These are building blocks, not a fixed cast: the generators
 * recombine them so a given seed produces a consistent, believable local area
 * of plausible (but not real) English grassroots clubs and people.
 */

const PLACE_PREFIXES = [
  'Ash',
  'Bram',
  'Cald',
  'Cran',
  'Dal',
  'Dun',
  'Eas',
  'Fen',
  'Grim',
  'Hal',
  'Hart',
  'Hax',
  'Ick',
  'Kel',
  'Lud',
  'Marl',
  'Neth',
  'Oak',
  'Pen',
  'Rush',
  'Stan',
  'Thorn',
  'Wex',
  'Wil',
  'Yarn',
  'Bex',
  'Col',
  'Dray',
  'Elm',
  'Fer',
  'Gat',
  'Hol',
  'Ing',
  'Kirk',
  'Lin',
  'Mor',
  'Nor',
  'Orp',
  'Pil',
  'Quar',
  'Red',
  'Sel',
  'Til',
  'Upp',
  'Ver',
  'Wen',
  'Wool',
];

const PLACE_SUFFIXES = [
  'ford',
  'ton',
  'ham',
  'wick',
  'bury',
  'field',
  'cott',
  'ley',
  'combe',
  'thorpe',
  'stow',
  'well',
  'marsh',
  'bridge',
  'hurst',
  'gate',
  'den',
  'mere',
  'worth',
  'croft',
  'stead',
  'end',
];

const FUNNY_BUT_PLAUSIBLE_VILLAGE_QUALIFIERS = [
  'Nether',
  'Upper',
  'Little',
  'Great',
  'Long',
  'Lower',
  'Middle',
];

const RIVER_WORDS = ['Avon', 'Wyre', 'Cale', 'Stour', 'Isle', 'Brue', 'Ouse', 'Teme', 'Dene', 'Yare'];

export function generatePlaceName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const useQualifier = rng.chance(0.22);
    const base = `${rng.pick(PLACE_PREFIXES)}${rng.pick(PLACE_SUFFIXES)}`;
    const name = useQualifier
      ? `${rng.pick(FUNNY_BUT_PLAUSIBLE_VILLAGE_QUALIFIERS)} ${capitalise(base)}`
      : capitalise(base);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Extremely unlikely fallback, still deterministic.
  const fallback = `${capitalise(rng.pick(PLACE_PREFIXES))}${rng.pick(PLACE_SUFFIXES)}${used.size}`;
  used.add(fallback);
  return fallback;
}

export function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function riverName(rng: Rng): string {
  return `the River ${rng.pick(RIVER_WORDS)}`;
}

const FIRST_NAMES = [
  'Dave', 'John', 'Craig', 'Ryan', 'Leon', 'Sam', 'Dan', 'Tom', 'Jake', 'Kieran', 'Aaron', 'Callum',
  'Liam', 'Josh', 'Ben', 'Ashley', 'Gaz', 'Stu', 'Mikey', 'Nathan', 'Ollie', 'Phil', 'Reece', 'Scott',
  'Shane', 'Simon', 'Toby', 'Warren', 'Andy', 'Baz', 'Chris', 'Dean', 'Eddie', 'Frank', 'Glen', 'Harry',
  'Ian', 'Joel', 'Karl', 'Lewis', 'Marc', 'Neil', 'Owen', 'Paul', 'Ricky', 'Steve', 'Terry', 'Vince',
  'Wayne', 'Zak', 'Alex', 'Charlie', 'Elliot', 'Freddie', 'George', 'Harvey', 'Isaac', 'Jack', 'Kyle',
  'Luke', 'Max', 'Noah', 'Riley', 'Tyler', 'Alfie', 'Bradley', 'Corey', 'Dylan', 'Ethan', 'Finley',
  'Gareth', 'Hugo', 'Jenson', 'Kurtis', 'Louis', 'Morgan', 'Nick', 'Oscar', 'Pete', 'Quinn', 'Ross',
  'Spencer', 'Todd', 'Umar', 'Vinny', 'Will', 'Yusuf', 'Zane', 'Marcus', 'Damien', 'Colin', 'Brian',
];

const SURNAMES = [
  'Whitlock', 'Barnes', 'Pearce', 'Hollis', 'Merrick', 'Oakes', 'Pike', 'Sutton', 'Thorne', 'Vickers',
  'Wallace', 'Yardley', 'Ashby', 'Bishop', 'Clarke', 'Dunne', 'Ellery', 'Freeman', 'Gittens', 'Hartley',
  'Irvine', 'Jolley', 'Kendrick', 'Lockett', 'Marsden', 'Naylor', 'Oldacre', 'Pemberton', 'Quinnell',
  'Rowntree', 'Sadler', 'Tickle', 'Underhill', 'Vaughan', 'Wainwright', 'Yoxall', 'Aldridge', 'Bowen',
  'Cartwright', 'Dilley', 'Emery', 'Furlong', 'Griffiths', 'Hancock', 'Ingham', 'Judge', 'Kite',
  'Langford', 'Mottram', 'Newbold', 'Ormond', 'Pinches', 'Radford', 'Sandbrook', 'Trumper', 'Vale',
  'Wesson', 'Yates', 'Bracewell', 'Corbett', 'Denning', 'Eliot', 'Fairbrother', 'Godwin', 'Huxley',
  'Isaacs', 'Jamieson', 'Kirkham', 'Lovell', 'Madders', 'Norton', 'Padgett', 'Round', 'Skett',
  'Tunnicliffe', 'Urwin', 'Vernon', 'Wilding', 'Yarnold', 'Blakemore', 'Cuff', 'Dainty', 'Eardley',
];

const NICKNAMES = [
  'Taff', 'Nobby', 'Spud', 'Ginge', 'Disco', 'Tank', 'Macca', 'Bazza', 'Wiggy', 'Shiner', 'Chalky',
  'Bomber', 'Beefy', 'Slim', 'Jock', 'Podge', 'Tiny', 'Noddy', 'Ratty', 'Trigger', 'Dodger', 'Sticky',
  'Speedy', 'Chunky', 'Mudger', 'Hooky', 'Nutty', 'Rowdy', 'Scouse', 'Smudge', 'Tucker', 'Webby',
];

export function personFirstName(rng: Rng): string {
  return rng.pick(FIRST_NAMES);
}

export function personSurname(rng: Rng): string {
  return rng.pick(SURNAMES);
}

export function maybeNickname(rng: Rng, chanceOfNickname = 0.35): string | undefined {
  return rng.chance(chanceOfNickname) ? rng.pick(NICKNAMES) : undefined;
}

const CLUB_SUFFIXES = [
  'United', 'Athletic', 'Rovers', 'Albion', 'Wanderers', 'Rangers', 'Corinthians', 'Victoria', 'FC',
  'Town', 'Sports', 'Dynamos', 'Conservatives',
];

const CLUB_NICKNAMES = [
  'The Badgers', 'The Robins', 'The Swifts', 'The Oaks', 'The Millers', 'The Ferrymen', 'The Bulls',
  'The Rams', 'The Crown', 'The Magpies', 'The Railwaymen', 'The Stags', 'The Foxes', 'The Villagers',
  'The Legion', 'The Crows', 'The Herons', 'The Dockers', 'The Anchors', 'The Forgers', 'The Pelicans',
  'The Wheelers', 'The Poachers', 'The Harriers', 'The Brewers', 'The Cottagers',
];

export function clubSuffix(rng: Rng): string {
  return rng.pick(CLUB_SUFFIXES);
}

export function clubNickname(rng: Rng): string {
  return rng.pick(CLUB_NICKNAMES);
}

export function pubName(rng: Rng): string {
  const patterns = [
    'The',
    'The Old',
  ];
  const pubWords = [
    'Crown', 'Red Lion', 'White Hart', 'Plough', 'Bell', 'Wheatsheaf', 'Royal Oak', 'Ship', 'Anchor',
    'Barley Mow', 'Chequers', 'Horse and Groom', 'Nelson', 'Rose and Crown', 'Coach and Horses',
    'Black Horse', 'Fox and Hounds', 'Cross Keys', 'Swan', 'Duke of York', 'Three Tuns', 'Bull',
    'Bricklayers Arms', 'Railway Tavern', 'Station Hotel', 'Waggon and Horses', 'Sun Inn', 'George',
  ];
  return `${rng.pick(patterns)} ${rng.pick(pubWords)}`;
}

export function businessName(rng: Rng, kindLabel: string): string {
  const surnames = ['', ' & Sons', ' Bros', ' Ltd'];
  const bases = [
    'Apex', 'Ridgeway', 'Blackthorn', 'Ferndale', 'Marchant', 'Cornfield', 'Kestrel', 'Hedgerow',
    'Elmwood', 'Wessex', 'Wren', 'Hallmark', 'Bramble', 'Woodhouse', 'Stoneleigh', 'Orchard',
    'Pinnacle', 'Riverside', 'Milestone', 'Cedar', 'Harrow', 'Whitfield',
  ];
  return `${rng.pick(bases)} ${kindLabel}${rng.pick(surnames)}`;
}

const OCCUPATIONS = [
  'Roofer', 'Bricklayer', 'Electrician', 'Plasterer', 'Scaffolder', 'Joiner', 'Groundworker',
  'Site manager', 'Train driver', 'Nurse', 'Paramedic', 'Care worker', 'Teacher',
  'Teaching assistant', 'Warehouse operative', 'Van driver', 'HGV driver', 'Delivery driver',
  'Chef', 'Barman', 'Bar manager', 'Mechanic', 'Painter and decorator', 'Farmer', 'Farm worker',
  'Sales rep', 'Postman', 'Hairdresser', 'Personal trainer', 'Lifeguard', 'IT support',
  'Quantity surveyor', 'Accountant', 'Software developer', 'Call centre manager', 'Shop manager',
  'Student', 'Apprentice electrician', 'Apprentice plumber', 'Between jobs', 'Pub landlord',
  'Butcher', 'Baker', 'Waste collector', 'Security guard', 'Lorry loader', 'HGV mechanic',
  'Landscape gardener', 'Solicitor', 'Police officer', 'Firefighter', 'Army reservist',
];

export function occupation(rng: Rng): string {
  return rng.pick(OCCUPATIONS);
}

export function occupationForAge(rng: Rng, age: number): string {
  if (age <= 18) return rng.chance(0.7) ? 'Student' : 'Apprentice ' + rng.pick(['plumber', 'electrician', 'joiner']);
  if (age >= 38 && rng.chance(0.25)) {
    return rng.pick(['Site manager', 'Pub landlord', 'Self-employed', 'HGV driver', 'Retired (ex-forces)']);
  }
  return occupation(rng);
}

export const COLOUR_PAIRS: Array<{ primary: string; secondary: string }> = [
  { primary: '#c62828', secondary: '#ffffff' },
  { primary: '#1565c0', secondary: '#ffffff' },
  { primary: '#2e7d32', secondary: '#ffffff' },
  { primary: '#f9a825', secondary: '#1a237e' },
  { primary: '#6a1b9a', secondary: '#ffffff' },
  { primary: '#ef6c00', secondary: '#212121' },
  { primary: '#00838f', secondary: '#ffffff' },
  { primary: '#37474f', secondary: '#ffd54f' },
  { primary: '#ad1457', secondary: '#ffffff' },
  { primary: '#4e342e', secondary: '#ffe082' },
  { primary: '#0277bd', secondary: '#ffeb3b' },
  { primary: '#558b2f', secondary: '#ffffff' },
  { primary: '#d84315', secondary: '#ffffff' },
  { primary: '#283593', secondary: '#ffca28' },
  { primary: '#455a64', secondary: '#ffffff' },
  { primary: '#b71c1c', secondary: '#212121' },
];
