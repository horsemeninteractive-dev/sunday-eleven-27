import { Rng } from '../rng';

/**
 * Name pools. These are building blocks, not a fixed cast: the generators
 * recombine them so a given seed produces a consistent, believable local area
 * of plausible (but not real) English grassroots clubs and people.
 */

const PLACE_PREFIXES = [
  'Abb', 'Ack', 'Ald', 'Alders', 'Amble', 'Amber', 'Ank', 'App', 'Arden', 'Ark', 'Ash', 'Aspen',
  'Ather', 'Ayl', 'Bab', 'Bad', 'Bag', 'Bal', 'Ban', 'Barl', 'Barn', 'Barrow', 'Bast', 'Batt',
  'Bay', 'Beacon', 'Beck', 'Bed', 'Beech', 'Bel', 'Ben', 'Bex', 'Bib', 'Bid', 'Birch', 'Bish',
  'Blak', 'Bland', 'Blea', 'Bol', 'Bon', 'Bor', 'Bos', 'Bour', 'Bow', 'Box', 'Brad', 'Braid',
  'Bram', 'Bramble', 'Bran', 'Brant', 'Breck', 'Bren', 'Brick', 'Brid', 'Bright', 'Brin', 'Broad', 'Brock',
  'Brom', 'Brook', 'Broom', 'Buck', 'Bud', 'Burl', 'Burn', 'Burt', 'Cad', 'Cald', 'Cam', 'Can',
  'Car', 'Carrow', 'Cas', 'Cat', 'Chad', 'Chal', 'Chap', 'Charl', 'Chel', 'Cher', 'Ches', 'Chil',
  'Chip', 'Chur', 'Clack', 'Clap', 'Clay', 'Cleve', 'Clif', 'Clip', 'Clun', 'Cob', 'Col', 'Coln',
  'Comb', 'Copse', 'Corn', 'Cot', 'Cover', 'Cow', 'Crab', 'Crag', 'Cran', 'Cress', 'Crew', 'Crick',
  'Crop', 'Cros', 'Crow', 'Culm', 'Cur', 'Dal', 'Dam', 'Dan', 'Darl', 'Dart', 'Denb', 'Dent',
  'Derw', 'Dew', 'Did', 'Dil', 'Din', 'Dod', 'Don', 'Dore', 'Dov', 'Down', 'Dray', 'Drib',
  'Duff', 'Dun', 'Eas', 'East', 'Edg', 'Eld', 'Elm', 'Elv', 'Epp', 'Even', 'Fal', 'Farn',
  'Faw', 'Fell', 'Fen', 'Fer', 'Fern', 'Fin', 'Firs', 'Flet', 'Flit', 'Fol', 'Ford', 'Foss',
  'Fram', 'Fro', 'Fur', 'Gad', 'Gal', 'Gar', 'Garth', 'Gat', 'Gil', 'Glan', 'Glas', 'Glen',
  'Gold', 'Gor', 'Gos', 'Gran', 'Gray', 'Great', 'Green', 'Gren', 'Grim', 'Grimb', 'Gro', 'Gul',
  'Had', 'Hal', 'Hall', 'Ham', 'Han', 'Harb', 'Hard', 'Hare', 'Harp', 'Harrow', 'Hart', 'Hatch',
  'Hawk', 'Hax', 'Hay', 'Hazel', 'Hed', 'Hel', 'Hen', 'Herb', 'Hert', 'Hex', 'High', 'Hill',
  'Hin', 'Hind', 'Hobb', 'Hock', 'Hol', 'Holl', 'Holly', 'Holme', 'Holt', 'Honey', 'Hook', 'Hope',
  'Horn', 'Hough', 'How', 'Hud', 'Hun', 'Hunt', 'Hurst', 'Hut', 'Ick', 'Il', 'Ing', 'Ink',
  'Iron', 'Ivy', 'Jack', 'Jar', 'Jev', 'John', 'Kay', 'Kel', 'Ken', 'Kett', 'Key', 'Kid',
  'Kil', 'Kim', 'Kin', 'King', 'Kirk', 'Kit', 'Knap', 'Knot', 'Lad', 'Lan', 'Latch', 'Law',
  'Lea', 'Leck', 'Led', 'Lee', 'Lent', 'Lev', 'Ley', 'Lid', 'Lil', 'Lin', 'Linch', 'Lind',
  'Lit', 'Liv', 'Lod', 'Long', 'Loth', 'Low', 'Luck', 'Lud', 'Ludb', 'Lum', 'Lund', 'Lut',
  'Lyd', 'Lyn', 'Mab', 'Mad', 'Mag', 'Maid', 'Mal', 'Man', 'Map', 'March', 'Mark', 'Marl',
  'Marsh', 'Mart', 'Mat', 'Maw', 'May', 'Mead', 'Mel', 'Mere', 'Merl', 'Mid', 'Mil', 'Mill',
  'Milt', 'Min', 'Monk', 'Mont', 'Moor', 'Mor', 'More', 'Mort', 'Moss', 'Mot', 'Moul', 'Mount',
  'Mow', 'Mul', 'Mur', 'Nail', 'Nan', 'Nap', 'Nash', 'Neat', 'Nes', 'Neth', 'New', 'Newb',
  'Nid', 'Nob', 'Nook', 'Nor', 'Nord', 'North', 'Norton', 'Not', 'Nun', 'Nut', 'Oak', 'Oakl',
  'Ock', 'Off', 'Old', 'Olv', 'Orl', 'Orp', 'Osm', 'Ot', 'Oul', 'Over', 'Ox', 'Pad',
  'Pag', 'Pain', 'Pal', 'Pan', 'Pap', 'Par', 'Park', 'Part', 'Pat', 'Pay', 'Peak', 'Pear',
  'Ped', 'Pel', 'Pen', 'Pend', 'Penn', 'Pent', 'Per', 'Pet', 'Pick', 'Pidd', 'Pike', 'Pil',
  'Pill', 'Pin', 'Pipe', 'Pit', 'Pla', 'Play', 'Plum', 'Ply', 'Pond', 'Pool', 'Port', 'Post',
  'Pot', 'Pound', 'Pove', 'Pow', 'Pren', 'Pres', 'Prest', 'Prim', 'Pud', 'Pul', 'Pur', 'Quab',
  'Quar', 'Quen', 'Quill', 'Rad', 'Ram', 'Rams', 'Ran', 'Rat', 'Raven', 'Raw', 'Ray', 'Read',
  'Red', 'Redd', 'Reed', 'Ren', 'Rib', 'Rich', 'Rick', 'Rid', 'Ring', 'Rip', 'Rob', 'Roch',
  'Rod', 'Rom', 'Rook', 'Rose', 'Ross', 'Roth', 'Rough', 'Row', 'Rox', 'Rud', 'Ruff', 'Rumb',
  'Rush', 'Rus', 'Sal', 'Salb', 'Salt', 'Sand', 'Sander', 'Sandy', 'Sar', 'Sax', 'Scar', 'Sea',
  'Sed', 'Sel', 'Set', 'Sew', 'Shal', 'Shap', 'Shar', 'Shaw', 'Sheen', 'Sheep', 'Shelf', 'Shen',
  'Shep', 'Sher', 'Shil', 'Shin', 'Ship', 'Shir', 'Sho', 'Shor', 'Shot', 'Shrew', 'Sid', 'Sil',
  'Sit', 'Skel', 'Skip', 'Slack', 'Slin', 'Small', 'Sme', 'Snap', 'Sod', 'Sol', 'Som', 'South',
  'Sow', 'Spa', 'Spal', 'Span', 'Spen', 'Spil', 'Spin', 'Sprat', 'Staf', 'Stal', 'Stan', 'Stap',
  'Star', 'Sted', 'Steep', 'Step', 'Ster', 'Stev', 'Stew', 'Stil', 'Stir', 'Stok', 'Ston', 'Stor',
  'Stot', 'Stour', 'Stow', 'Strad', 'Strat', 'Straw', 'Strea', 'Stret', 'Stro', 'Stub', 'Stud', 'Sturt',
  'Sud', 'Sug', 'Sum', 'Sun', 'Sund', 'Sur', 'Sut', 'Swaf', 'Swan', 'Swar', 'Swe', 'Swin',
  'Syd', 'Tal', 'Tan', 'Tar', 'Tat', 'Ted', 'Tem', 'Ter', 'Tew', 'Thack', 'Thax', 'Thed',
  'They', 'Thim', 'Thist', 'Thix', 'Thom', 'Thorn', 'Thrap', 'Thur', 'Thurs', 'Tib', 'Tick', 'Tid',
  'Til', 'Tils', 'Timb', 'Tin', 'Ting', 'Tipt', 'Tir', 'Tit', 'Tock', 'Tod', 'Tol', 'Ton',
  'Tor', 'Tot', 'Tow', 'Tov', 'Tran', 'Trap', 'Tred', 'Trev', 'Trim', 'Tro', 'Trot', 'Tru',
  'Tuck', 'Tun', 'Tur', 'Twy', 'Tyd', 'Tyn', 'Uck', 'Ul', 'Ull', 'Upc', 'Uph', 'Upm',
  'Upp', 'Urc', 'Val', 'Ven', 'Ver', 'Vet', 'Vic', 'Vin', 'Wad', 'Wadd', 'Wak', 'Wal',
  'Wald', 'Wall', 'Wals', 'Walth', 'Wam', 'Wan', 'War', 'Warb', 'Ward', 'Wark', 'Warn', 'Wart',
  'Wath', 'Watt', 'Wav', 'Way', 'Wea', 'Weav', 'Web', 'Wed', 'Wee', 'Weet', 'Wel', 'Well',
  'Wemb', 'Wen', 'Wend', 'Went', 'Wer', 'Wes', 'West', 'Wex', 'Wey', 'Wha', 'Whal', 'Whar',
  'Whe', 'Wheat', 'Whim', 'Whitb', 'Whitc', 'Whitf', 'Whitn', 'Whitt', 'Wib', 'Wig', 'Wil', 'Wilb',
  'Wilc', 'Wild', 'Wilf', 'Will', 'Wils', 'Wim', 'Win', 'Winch', 'Wind', 'Wins', 'Wint', 'Wis',
  'With', 'Wob', 'Wolf', 'Wolv', 'Won', 'Woo', 'Wool', 'Wor', 'Worl', 'Wort', 'Wot', 'Wray',
  'Wren', 'Wrex', 'Writt', 'Wrox', 'Wyb', 'Wyc', 'Wye', 'Wyke', 'Wyl', 'Wym', 'Wync', 'Wyre',
  'Yal', 'Yar', 'Yarn', 'Yate', 'Yea', 'Yew', 'Yor', 'Zeal',
];

const PLACE_SUFFIXES = [
  'ford', 'ton', 'ham', 'wick', 'bury', 'field', 'cott', 'ley', 'combe', 'thorpe', 'stow', 'well',
  'marsh', 'bridge', 'hurst', 'gate', 'den', 'mere', 'worth', 'croft', 'stead', 'end', 'by', 'shaw',
  'wood', 'don', 'hall', 'holme', 'moss', 'green', 'side', 'stone', 'bank', 'burn', 'carr', 'cliff',
  'dale', 'dene', 'ditch', 'dyke', 'edge', 'fleet', 'garth', 'holm', 'hough', 'kiln', 'land', 'law',
  'lee', 'moor', 'ness', 'nook', 'ridge', 'rook', 'sey', 'stoke', 'street', 'thwaite', 'tree', 'vale',
  'view', 'wall', 'way', 'wharf', 'wold', 'yard', 'hill', 'grove',
];

const FUNNY_BUT_PLAUSIBLE_VILLAGE_QUALIFIERS = [
  'Nether', 'Upper', 'Little', 'Great', 'Long', 'Lower', 'Middle', 'Over', 'Much', 'High',
  'Church', 'Chapel', 'Cold', 'Winter', 'Easter', 'Steeple', 'Broad',
];

const RIVER_WORDS = [
  'Avon', 'Wyre', 'Cale', 'Stour', 'Isle', 'Brue', 'Ouse', 'Teme', 'Dene', 'Yare',
  'Dove', 'Rye', 'Swale', 'Ure', 'Nene', 'Welland', 'Witham', 'Blyth', 'Chelmer', 'Colne',
  'Deer', 'Don', 'Eden', 'Idle', 'Lark', 'Loddon', 'Medway', 'Mole', 'Nadder', 'Piddle',
  'Sow', 'Tarrant', 'Test', 'Weaver', 'Wharfe', 'Windrush', 'Wye', 'Kennet', 'Lea', 'Rother',
  'Allen', 'Camel', 'Dart', 'Erme', 'Tavy', 'Torridge', 'Yealm', 'Lugg', 'Cam', 'Bourne',
  'Ant', 'Bure',
];

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
  'Wayne', 'Zak', 'Alex', 'Charlie', 'Elliot', 'Freddie', 'George', 'Harvey', 'Isaac', 'Jack', 'Kyle', 'Luke',
  'Max', 'Noah', 'Riley', 'Tyler', 'Alfie', 'Bradley', 'Corey', 'Dylan', 'Ethan', 'Finley', 'Gareth', 'Hugo',
  'Jenson', 'Kurtis', 'Louis', 'Morgan', 'Nick', 'Oscar', 'Pete', 'Quinn', 'Ross', 'Spencer', 'Todd', 'Umar',
  'Vinny', 'Will', 'Yusuf', 'Zane', 'Marcus', 'Damien', 'Colin', 'Brian', 'Adam', 'Adrian', 'Aidan', 'Alan',
  'Albert', 'Alec', 'Alistair', 'Allan', 'Alvin', 'Amir', 'Angus', 'Anthony', 'Archie', 'Arjun', 'Arthur', 'Austin',
  'Barry', 'Bernard', 'Billy', 'Blake', 'Bobby', 'Brad', 'Brandon', 'Brendan', 'Brett', 'Bruce', 'Bryan', 'Byron',
  'Calum', 'Cameron', 'Carl', 'Clifford', 'Clive', 'Cody', 'Connor', 'Curtis', 'Dale', 'Danny', 'Darren', 'David',
  'Declan', 'Dennis', 'Derek', 'Dermot', 'Dev', 'Dominic', 'Don', 'Dougie', 'Drew', 'Duncan', 'Dwayne', 'Eamon',
  'Edward', 'Elijah', 'Ellis', 'Emmanuel', 'Eric', 'Fabian', 'Felix', 'Fergus', 'Fraser', 'Fred', 'Gabriel', 'Gavin',
  'Geoff', 'Gerard', 'Gerry', 'Gordon', 'Graham', 'Grant', 'Greg', 'Gus', 'Guy', 'Gwilym', 'Hakeem', 'Hamza',
  'Hanif', 'Haroon', 'Hassan', 'Henry', 'Howard', 'Huw', 'Idris', 'Imran', 'Ivan', 'Iwan', 'Jacob', 'Jamie',
  'Jason', 'Jay', 'Jayden', 'Jed', 'Jeff', 'Jerome', 'Jerry', 'Jesse', 'Jim', 'Jimmy', 'Joe', 'Joey',
  'Jonah', 'Jonathan', 'Jordan', 'Josef', 'Joseph', 'Julian', 'Junior', 'Justin', 'Kane', 'Keith', 'Kelvin', 'Ken',
  'Kenny', 'Kevin', 'Kieron', 'Kirk', 'Kristian', 'Kye', 'Laurence', 'Lee', 'Lenny', 'Leo', 'Les', 'Leslie',
  'Levi', 'Lincoln', 'Lloyd', 'Logan', 'Lorcan', 'Louie', 'Luca', 'Lucas', 'Malachi', 'Malik', 'Manny', 'Marcel',
  'Mark', 'Martin', 'Marty', 'Mason', 'Matthew', 'Maurice', 'Mel', 'Michael', 'Mickey', 'Milan', 'Miles', 'Milo',
  'Mitch', 'Mo', 'Mohammed', 'Monty', 'Moses', 'Ned', 'Nelson', 'Nev', 'Nicholas', 'Nigel', 'Nikhil', 'Noel',
  'Norman', 'Olu', 'Omar', 'Otis', 'Paddy', 'Pat', 'Patrick', 'Perry', 'Peter', 'Prince', 'Raj', 'Ralph',
  'Ranjit', 'Raymond', 'Reggie', 'Reuben', 'Rex', 'Rhys', 'Richard', 'Richie', 'Rob', 'Robbie', 'Robin', 'Rodney',
  'Roger', 'Rohan', 'Roland', 'Ron', 'Ronnie', 'Rory', 'Rowan', 'Roy', 'Rudy', 'Rufus', 'Russell', 'Saeed',
  'Salim', 'Sammy', 'Sanjay', 'Sebastian', 'Seth', 'Shaun', 'Shay', 'Sonny', 'Stan', 'Stefan', 'Stephen', 'Stevie',
  'Stuart', 'Sunny', 'Tariq', 'Taylor', 'Ted', 'Teddy', 'Theo', 'Thomas', 'Tim', 'Tommy', 'Tony', 'Trevor',
  'Troy', 'Victor', 'Waqas', 'Wasim', 'William', 'Yasin', 'Zach', 'Zeeshan', 'Abe', 'Alf', 'Arnold', 'Aubrey',
  'Bert', 'Cedric', 'Clement', 'Cyril', 'Douglas', 'Edwin', 'Ernest', 'Herbert', 'Horace', 'Leonard', 'Percy', 'Sid',
  'Sidney', 'Walter', 'Wilf', 'Wally',
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
  'Abbott', 'Ackroyd', 'Adkins', 'Ainsworth', 'Alder', 'Allcock', 'Alvey', 'Anderson', 'Appleton', 'Archer',
  'Armitage', 'Arnold', 'Ashcroft', 'Ashdown', 'Ashman', 'Aspinall', 'Astley', 'Atherton', 'Atkin', 'Attwood',
  'Austin', 'Bagley', 'Bairstow', 'Baldwin', 'Ball', 'Bancroft', 'Bannister', 'Barber', 'Barlow', 'Barnett',
  'Barron', 'Bartholomew', 'Barton', 'Bashford', 'Bassett', 'Bateman', 'Batey', 'Batty', 'Baxter', 'Beale',
  'Beasley', 'Beaumont', 'Beckett', 'Bedwell', 'Belfield', 'Belton', 'Bennett', 'Bentley', 'Berry', 'Billings',
  'Billington', 'Binns', 'Birch', 'Bird', 'Blackman', 'Blackwell', 'Blain', 'Blake', 'Bland', 'Blewitt',
  'Bloomfield', 'Blythe', 'Boon', 'Booth', 'Bottomley', 'Boulter', 'Bourne', 'Bowden', 'Bower', 'Bowers',
  'Bowles', 'Boyce', 'Bracken', 'Bradbury', 'Bradford', 'Bradshaw', 'Bramley', 'Bray', 'Brennan', 'Brett',
  'Brewster', 'Bridges', 'Brierley', 'Briggs', 'Brigham', 'Broadbent', 'Broadhurst', 'Bromley', 'Brook', 'Brooke',
  'Brooks', 'Broughton', 'Brough', 'Brown', 'Browning', 'Brunton', 'Bryan', 'Bryce', 'Buck', 'Buckley',
  'Bullock', 'Bunn', 'Burgess', 'Burnett', 'Burrows', 'Burton', 'Bush', 'Butcher', 'Butler', 'Byers',
  'Byford', 'Cade', 'Cahill', 'Calder', 'Callaghan', 'Callow', 'Calvert', 'Cameron', 'Cann', 'Cantrell',
  'Carey', 'Carlin', 'Carlisle', 'Carr', 'Carroll', 'Carter', 'Caswell', 'Caton', 'Cave', 'Chadwick',
  'Chamberlain', 'Chandler', 'Chapman', 'Charlesworth', 'Charlton', 'Cheetham', 'Childs', 'Chisholm', 'Chivers',
  'Christie', 'Churchill', 'Clancy', 'Clark', 'Clay', 'Clayton', 'Clegg', 'Clements', 'Cliff', 'Clifton',
  'Coates', 'Coburn', 'Cochrane', 'Cole', 'Coleman', 'Coles', 'Collier', 'Collins', 'Colman', 'Comber',
  'Compton', 'Connolly', 'Connor', 'Conway', 'Cook', 'Cooke', 'Coombes', 'Cooper', 'Cope', 'Corcoran',
  'Cornish', 'Cotterill', 'Cottrell', 'Coulson', 'Coulter', 'Court', 'Courtney', 'Cousins', 'Cove', 'Cowan',
  'Cowley', 'Cox', 'Coyle', 'Crabtree', 'Craig', 'Crane', 'Craven', 'Crawford', 'Creasey', 'Crewe',
  'Croft', 'Crook', 'Cross', 'Crowe', 'Crowley', 'Cudworth', 'Culley', 'Culshaw', 'Cummins', 'Cunningham',
  'Curran', 'Dacre', 'Dale', 'Dalton', 'Daniels', 'Darbyshire', 'Darlow', 'Dawe', 'Dawson', 'Day',
  'Deakin', 'Dean', 'Dell', 'Denton', 'Denyer', 'Devlin', 'Dewar', 'Dickson', 'Dilworth', 'Dobson',
  'Dodd', 'Dodds', 'Doherty', 'Dolan', 'Donnelly', 'Doughty', 'Dowling', 'Downes', 'Downing', 'Dowson',
  'Doyle', 'Draper', 'Duckworth', 'Dudley', 'Duffy', 'Duggan', 'Duke', 'Duncan', 'Dunkley', 'Dunn',
  'Dunning', 'Dutton', 'Dyer', 'Dyson', 'Eames', 'Earle', 'Eastwood', 'Eaton', 'Eccles', 'Edge',
  'Edmonds', 'Edwards', 'Eldridge', 'Ellison', 'Elston', 'Emmett', 'English', 'Escott', 'Etchells',
  'Etherington', 'Evans', 'Everitt', 'Ewart', 'Fagan', 'Fairclough', 'Falconer', 'Farley', 'Farrar',
  'Farrant', 'Farthing', 'Fawcett', 'Fearn', 'Featherstone', 'Fenwick', 'Ferguson', 'Field', 'Fielding',
  'Finch', 'Firth', 'Fisher', 'Fitzgerald', 'Flanagan', 'Fleming', 'Fletcher', 'Flint', 'Foley', 'Forbes',
  'Ford', 'Foreman', 'Forrest', 'Forster', 'Forsyth', 'Foster', 'Fowles', 'Fox', 'Franklin', 'Freer',
  'Frost', 'Fryer', 'Fuller', 'Gadsby', 'Gaffney', 'Gale', 'Gallagher', 'Gamble', 'Gammon', 'Gardiner',
  'Garner', 'Garnett', 'Garratt', 'Garvey', 'Gaynor', 'Geddes', 'Gee', 'Gent', 'Gibbons', 'Gibbs',
  'Gibson', 'Gilbert', 'Gilchrist', 'Giles', 'Gill', 'Gillespie', 'Gilmore', 'Glover', 'Goddard', 'Godfrey',
  'Golding', 'Goodall', 'Goodchild', 'Goode', 'Goodwin', 'Gordon', 'Gore', 'Gough', 'Gould', 'Goulding',
  'Grady', 'Graham', 'Grainger', 'Grant', 'Grantham', 'Graves', 'Gray', 'Greatorex', 'Greaves', 'Green',
  'Greenhalgh', 'Greenwood', 'Gregory', 'Grimshaw', 'Grundy', 'Guest', 'Hackett', 'Hadfield', 'Hague', 'Haigh',
  'Haines', 'Hale', 'Hall', 'Hallam', 'Halliwell', 'Halstead', 'Hamer', 'Hamilton', 'Hammond', 'Hampshire',
  'Hampton', 'Hanley', 'Hardy', 'Hare', 'Hargreaves', 'Harker', 'Harman', 'Harper', 'Harrington', 'Harris',
  'Harrison', 'Harrop', 'Hart', 'Harvey', 'Harwood', 'Haslam', 'Hatch', 'Hatton', 'Hawkes', 'Hawkins',
  'Hawthorne', 'Haywood', 'Hazel', 'Heald', 'Healey', 'Heath', 'Heaton', 'Hedges', 'Hemingway', 'Hemmings',
  'Henderson', 'Hendry', 'Hepworth', 'Heslop', 'Hewitt', 'Hibbert', 'Hickman', 'Hicks', 'Higgins', 'Higgs',
  'Higham', 'Hill', 'Hillier', 'Hills', 'Hilton', 'Hinchcliffe', 'Hind', 'Hines', 'Hirst', 'Hobbs',
  'Hobson', 'Hodgkinson', 'Hodgson', 'Hodson', 'Hogan', 'Holden', 'Holder', 'Holdsworth', 'Holland', 'Holloway',
  'Holmes', 'Holt', 'Hood', 'Hooper', 'Hope', 'Hopkins', 'Hopper', 'Horn', 'Hornby', 'Horner',
  'Horsley', 'Horton', 'Hoskins', 'Houghton', 'House', 'Howarth', 'Howe', 'Howell', 'Howells', 'Howes',
  'Hudson', 'Huggett', 'Hughes', 'Hulme', 'Humberstone', 'Hume', 'Humphreys', 'Hunter', 'Hurst', 'Husband',
  'Hutchinson', 'Hyde', 'Iles', 'Illingworth', 'Ince', 'Innes', 'Ireland', 'Ives', 'Jackman', 'Jackson',
  'Jacques', 'Jagger', 'Jarrett', 'Jarvis', 'Jefferies', 'Jefferson', 'Jeffery', 'Jeffrey', 'Jenkins', 'Jennings',
  'Jepson', 'Jewell', 'Johns', 'Johnson', 'Johnston', 'Jones', 'Jordan', 'Joyce', 'Kay', 'Keane',
  'Kearney', 'Keating', 'Keeble', 'Keegan', 'Keen', 'Kelly', 'Kemp', 'Kendall', 'Kennedy', 'Kenny',
  'Kent', 'Kenyon', 'Kerr', 'Kettle', 'Kidd', 'Kilby', 'Kimber', 'Kincaid', 'King', 'Kirby',
  'Knight', 'Knowles', 'Knox', 'Lamb', 'Lambert', 'Lancaster', 'Lane', 'Lang', 'Langley', 'Latham',
  'Law', 'Lawler', 'Lawrence', 'Lawson', 'Laycock', 'Leach', 'Ledger', 'Leech', 'Lees', 'Leeson',
  'Legg', 'Leigh', 'Leighton', 'Lennox', 'Leonard', 'Lester', 'Lewin', 'Lewis', 'Lilley', 'Lindsay',
  'Lister', 'Little', 'Littlewood', 'Livesey', 'Lloyd', 'Lodge', 'Loftus', 'Long', 'Longhurst', 'Lord',
  'Love', 'Loveday', 'Lowry', 'Lucas', 'Ludlow', 'Lunn', 'Lynch', 'Lyons', 'Macdonald', 'Machin',
  'Mackay', 'Mackenzie', 'Maddox', 'Maguire', 'Mahon', 'Mainwaring', 'Major', 'Makin', 'Maloney', 'Mann',
  'Manning', 'Manton', 'Marchant', 'Markham', 'Marsland', 'Mason', 'Massey', 'Masters', 'Matthews', 'May',
  'Maynard', 'McArdle', 'McCann', 'McCarthy', 'McCormack', 'McDonald', 'McGrath', 'McIntyre', 'McKay', 'McKenna',
  'McLaughlin', 'McMahon', 'McNeil', 'Mead', 'Meadows', 'Mellor', 'Mercer', 'Meredith', 'Metcalfe', 'Middleton',
  'Midgley', 'Mildenhall', 'Millard', 'Miller', 'Milner', 'Mitchell', 'Molloy', 'Monk', 'Moody', 'Mooney',
  'Moore', 'Moran', 'Morley', 'Morris', 'Morrison', 'Morrow', 'Mortimer', 'Morton', 'Moss', 'Mowbray',
  'Moxon', 'Mullen', 'Mullins', 'Mumford', 'Munro', 'Murdoch', 'Murphy', 'Murray', 'Nash', 'Neal',
  'Needham', 'Neil', 'Nelson', 'Newell', 'Newman', 'Newton', 'Nicholls', 'Nichols', 'Nicholson', 'Nightingale',
  'Nixon', 'Noble', 'North', 'Nunn', 'Nutt', 'Oakley', 'Oates', 'Odell', 'Ogden', 'Ogilvie',
  'Oldham', 'Oldfield', 'Oliver', 'Openshaw', 'Ormerod', 'Osborne', 'Overall', 'Overton', 'Owen', 'Owens',
  'Oxley', 'Page', 'Painter', 'Palmer', 'Park', 'Parker', 'Parkes', 'Parkin', 'Parkinson', 'Parr',
  'Parry', 'Parsons', 'Partridge', 'Pascoe', 'Paterson', 'Patrick', 'Patterson', 'Payne', 'Peacock', 'Pearson',
  'Peck', 'Pedley', 'Peel', 'Pegg', 'Pendlebury', 'Penfold', 'Penn', 'Pepper', 'Perkins', 'Perrin',
  'Perry', 'Petrie', 'Pettit', 'Petty', 'Phillips', 'Pickering', 'Pickford', 'Pickup', 'Pierce', 'Piggott',
  'Pilling', 'Pilkington', 'Pink', 'Piper', 'Plant', 'Platt', 'Plummer', 'Pollard', 'Pooley', 'Pope',
  'Porter', 'Potts', 'Poulter', 'Pound', 'Powell', 'Power', 'Pratt', 'Preece', 'Preston', 'Price',
  'Pride', 'Prince', 'Pringle', 'Pritchard', 'Probert', 'Proctor', 'Prowse', 'Pryce', 'Purnell', 'Purvis',
  'Pye', 'Quayle', 'Quick', 'Radcliffe', 'Radley', 'Rae', 'Raggett', 'Raine', 'Ramsay', 'Ramsden',
  'Randall', 'Rankin', 'Ransom', 'Rathbone', 'Raven', 'Rawlins', 'Rawson', 'Ray', 'Rayner', 'Rea',
  'Read', 'Reader', 'Reardon', 'Redfern', 'Redman', 'Reece', 'Reed', 'Rees', 'Reeve', 'Reeves',
  'Reid', 'Reilly', 'Rendell', 'Rennie', 'Reynolds', 'Rhodes', 'Rice', 'Rich', 'Richards', 'Richardson',
  'Rickard', 'Ricketts', 'Riddell', 'Ridley', 'Rigby', 'Riley', 'Rimmer', 'Ring', 'Ripley', 'Ritchie',
  'Rivers', 'Roach', 'Robbins', 'Roberts', 'Robertson', 'Robinson', 'Robson', 'Rodgers', 'Rodwell', 'Rogers',
  'Rogerson', 'Roper', 'Roscoe', 'Ross', 'Rosser', 'Rouse', 'Rowe', 'Rowlands', 'Rowley', 'Royal',
  'Rudd', 'Ruddock', 'Rudge', 'Rumbold', 'Rush', 'Rushton', 'Rutter', 'Ryder', 'Rye', 'Salt',
  'Salter', 'Sambrook', 'Sampson', 'Sanderson', 'Sands', 'Sansom', 'Sargent', 'Saunders', 'Savage', 'Sawyer',
  'Saxton', 'Sayers', 'Scales', 'Scanlon', 'Schofield', 'Scott', 'Scrivener', 'Seaman', 'Searle', 'Seddon',
  'Seed', 'Selby', 'Sellars', 'Sellers', 'Senior', 'Sewell', 'Sharman', 'Sharp', 'Sharpe', 'Shaw',
  'Sheldon', 'Shenton', 'Shepherd', 'Sheppard', 'Sheridan', 'Sherlock', 'Sherwood', 'Shields', 'Shipley', 'Shirley',
  'Shore', 'Short', 'Shuttleworth', 'Silk', 'Simmonds', 'Simmons', 'Simms', 'Simpson', 'Sims', 'Sinclair',
  'Singh', 'Singleton', 'Sissons', 'Skelton', 'Skidmore', 'Slade', 'Slater', 'Slattery', 'Small', 'Smart',
  'Smeaton', 'Smith', 'Smithers', 'Snape', 'Snell', 'Snow', 'Solomon', 'Southall', 'Southern', 'Southgate',
  'Spalding', 'Sparkes', 'Speed', 'Spence', 'Spencer', 'Spicer', 'Spinks', 'Spooner', 'Spring', 'Stacey',
  'Stafford', 'Staines', 'Stanley', 'Stanton', 'Staples', 'Starkey', 'Statham', 'Stead', 'Steadman', 'Steel',
  'Steele', 'Steer', 'Stephenson', 'Stevens', 'Stevenson', 'Steward', 'Stewart', 'Stiles', 'Still', 'Stirling',
  'Stock', 'Stoddart', 'Stokes', 'Stone', 'Storer', 'Storey', 'Stott', 'Stowe', 'Stratford', 'Stratton',
  'Street', 'Streeter', 'Stringer', 'Stroud', 'Stuart', 'Stubbs', 'Sugden', 'Sullivan', 'Summerfield', 'Summers',
  'Sumner', 'Sutcliffe', 'Sutherland', 'Swain', 'Swann', 'Swift', 'Sykes', 'Symes', 'Symonds', 'Tait',
  'Talbot', 'Tanner', 'Tarrant', 'Tasker', 'Tate', 'Tattersall', 'Taylor', 'Teale', 'Tebbutt', 'Tempest',
  'Tennant', 'Terry', 'Thatcher', 'Thacker', 'Thomas', 'Thompson', 'Thomson', 'Thorpe', 'Threlfall', 'Thurston',
  'Tilley', 'Tillotson', 'Tindall', 'Tinker', 'Tobin', 'Todd', 'Tomlin', 'Tomlinson', 'Topping', 'Tovey',
  'Towers', 'Townend', 'Townsend', 'Travers', 'Trigg', 'Trott', 'Trueman', 'Truscott', 'Tucker', 'Tudor',
  'Turnbull', 'Turner', 'Turton', 'Tyson', 'Underwood', 'Unsworth', 'Upton', 'Usher', 'Uttley', 'Varley',
  'Vasey', 'Veale', 'Venables', 'Verity', 'Vickery', 'Vincent', 'Vine', 'Waddell', 'Wade', 'Wagstaff',
  'Waite', 'Wake', 'Wakefield', 'Walcott', 'Walden', 'Waldron', 'Walker', 'Wall', 'Waller', 'Wallis',
  'Walmsley', 'Walsh', 'Walton', 'Warburton', 'Ward', 'Wardle', 'Ware', 'Waring', 'Warne', 'Warner',
  'Warnock', 'Warren', 'Warwick', 'Waterhouse', 'Waters', 'Watkins', 'Watson', 'Watts', 'Way', 'Weaver',
  'Webb', 'Webber', 'Webster', 'Weekes', 'Weeks', 'Wells', 'Welsh', 'West', 'Weston', 'Westwood',
  'Wheeler', 'Whitaker', 'Whitby', 'White', 'Whitehead', 'Whitehouse', 'Whiteley', 'Whitfield', 'Whiting', 'Whitmore',
  'Whittaker', 'Whitworth', 'Whittle', 'Wicks', 'Widdowson', 'Wiggins', 'Wilcox', 'Wilder', 'Wilkes', 'Wilkins',
  'Wilkinson', 'Williams', 'Williamson', 'Willmott', 'Willoughby', 'Wills', 'Wilson', 'Winch', 'Winter', 'Winterbottom',
  'Wise', 'Wiseman', 'Withers', 'Wolstenholme', 'Wood', 'Woodcock', 'Woodhead', 'Woodley', 'Woodward', 'Woolley',
  'Wootton', 'Worsley', 'Worthington', 'Wragg', 'Wray', 'Wright', 'Wyatt', 'Yarwood', 'Yeates', 'Yeo',
  'Yeoman', 'York', 'Young',
];

const NICKNAMES = [
  'Taff', 'Nobby', 'Spud', 'Ginge', 'Disco', 'Tank', 'Macca', 'Bazza', 'Wiggy', 'Shiner', 'Chalky',
  'Bomber', 'Beefy', 'Slim', 'Jock', 'Podge', 'Tiny', 'Noddy', 'Ratty', 'Trigger', 'Dodger', 'Sticky',
  'Speedy', 'Chunky', 'Mudger', 'Hooky', 'Nutty', 'Rowdy', 'Scouse', 'Smudge', 'Tucker', 'Webby',
  'Buster', 'Chippy', 'Chubby', 'Coops', 'Cracker', 'Dagger', 'Daz', 'Deano', 'Digger', 'Dinky',
  'Doc', 'Dopey', 'Doughnut', 'Dusty', 'Fizzy', 'Flash', 'Foxy', 'Frosty', 'Gazza', 'Gonzo',
  'Grunter', 'Gummy', 'Haggis', 'Hendo', 'Hovis', 'Jacko', 'Jelly', 'Jinx', 'Jonty', 'Kipper',
  'Lofty', 'Mad Dog', 'Midge', 'Moose', 'Mucker', 'Muppet', 'Napper', 'Nipper', 'Nosey', 'Paddy',
  'Peanut', 'Percy', 'Puggy', 'Rabbit', 'Rooster', 'Scruff', 'Shaggy', 'Sharky', 'Shorty', 'Skinny',
  'Slick', 'Smiler', 'Sniffer', 'Sparky', 'Spider', 'Sponge', 'Stretch', 'Stumpy', 'Teapot', 'Tommo',
  'Topper', 'Tubbs', 'Tubby', 'Wally', 'Whippet', 'Yorkie', 'Zippy',
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
  'Town', 'Sports', 'Dynamos', 'Conservatives', 'Casuals', 'Swifts', 'Argyle', 'Alexandra', 'Lions',
  'Nomads', 'Olympic', 'Park', 'Spartans', 'Thistle', 'Eagles', 'Harriers', 'Magpies', 'Ramblers',
  'Royal', 'Services', 'Union', 'Youth', 'Colts', 'Juniors', 'Community', 'Social', 'Old Boys',
  'Sunday', 'Academy', 'Vale', 'Star',
];

const CLUB_NICKNAMES = [
  'The Badgers', 'The Robins', 'The Swifts', 'The Oaks', 'The Millers', 'The Ferrymen', 'The Bulls',
  'The Rams', 'The Crown', 'The Magpies', 'The Railwaymen', 'The Stags', 'The Foxes', 'The Villagers',
  'The Legion', 'The Crows', 'The Herons', 'The Dockers', 'The Anchors', 'The Forgers', 'The Pelicans',
  'The Wheelers', 'The Poachers', 'The Harriers', 'The Brewers', 'The Cottagers', 'The Adders', 'The Barn Owls',
  'The Beeches', 'The Bellringers', 'The Blackbirds', 'The Boaters', 'The Bricklayers', 'The Builders',
  'The Buzzards', 'The Cabmen', 'The Cardinals', 'The Choughs', 'The Clippers', 'The Cocklers',
  'The Colliers', 'The Combers', 'The Coopers', 'The Cormorants', 'The Carters', 'The Cricketers',
  'The Dairymen', 'The Ditchers', 'The Dolphins', 'The Drovers', 'The Farmers', 'The Falcons',
  'The Fishers', 'The Foxcubs', 'The Gardeners', 'The Gulls', 'The Hammermen', 'The Hawkers',
  'The Heathmen', 'The Herdmen', 'The Hatters', 'The Hopmen', 'The Hornets', 'The Hounds',
  'The Jackdaws', 'The Kestrels', 'The Lambs', 'The Lancers', 'The Larks', 'The Linenmen',
  'The Lockkeepers', 'The Lumbermen', 'The Maltsters', 'The Marshmen', 'The Masons', 'The Merlins',
  'The Millwrights', 'The Miners', 'The Moles', 'The Nightjars', 'The Ostlers', 'The Owls',
  'The Paviours', 'The Pipers', 'The Pitmen', 'The Ploughmen', 'The Plovers', 'The Quarrymen',
  'The Rooks', 'The Sailors', 'The Saltmen', 'The Sawyers', 'The Shepherds', 'The Skylarks',
  'The Smiths', 'The Starlings', 'The Stevedores', 'The Stonecutters', 'The Tanners', 'The Thrushes',
  'The Tinkers', 'The Trawlermen', 'The Waggoners', 'The Weavers', 'The Wheelwrights', 'The Wherrymen',
  'The Woodmen', 'The Wrens',
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
    'Angel', 'Beehive', 'Black Bull', 'Blue Boar', 'Boars Head', 'Britannia', 'Brown Bear', 'Bulls Head',
    'Castle', 'Cherry Tree', 'Cricketers', 'Dolphin', 'Dragon', 'Drovers', 'Eagle', 'Farmers Arms',
    'Feathers', 'Ferry Boat', 'Fleece', 'Foresters Arms', 'Foundry Arms', 'Fountain', 'Golden Cross',
    'Grapes', 'Green Dragon', 'Greyhound', 'Griffin', 'Half Moon', 'Hare and Hounds', 'Harvest Home',
    'Holly Bush', 'Jolly Farmer', 'Jolly Sailor', 'Kings Head', 'Lamb', 'Lion', 'Live and Let Live',
    'Manor Arms', 'Market Tavern', 'Maypole', 'Millers Arms', 'Miners Arms', 'Mitre', 'Moorcock',
    'Nags Head', 'New Inn', 'Pack Horse', 'Peacock', 'Plough and Harrow', 'Punch Bowl', 'Queens Head',
    'Rising Sun', 'Roebuck', 'Rose and Thistle', 'Royal George', 'Saddlers Arms', 'Seven Stars',
    'Shepherd and Flock', 'Six Bells', 'Sportsman', 'Spotted Cow', 'Star',
    'Three Crowns', 'Three Horseshoes', 'Travellers Rest', 'Unicorn', 'Victoria', 'Weavers Arms',
    'Wellington', 'White Horse', 'White Lion', 'White Swan', 'Windmill', 'Woodman', 'Woolpack', 'Yew Tree',
  ];
  return `${rng.pick(patterns)} ${rng.pick(pubWords)}`;
}

export function businessName(rng: Rng, kindLabel: string): string {
  const surnames = ['', ' & Sons', ' Bros', ' Ltd', ' & Co', ' and Partners'];
  const bases = [
    'Apex', 'Ridgeway', 'Blackthorn', 'Ferndale', 'Marchant', 'Cornfield', 'Kestrel', 'Hedgerow',
    'Elmwood', 'Wessex', 'Wren', 'Hallmark', 'Bramble', 'Woodhouse', 'Stoneleigh', 'Orchard',
    'Pinnacle', 'Riverside', 'Milestone', 'Cedar', 'Harrow', 'Whitfield', 'Aldermere', 'Amberley',
    'Ashcombe', 'Badgers', 'Barlow', 'Beacon', 'Beechwood', 'Bellhouse', 'Birchwood', 'Blackwater',
    'Bracken', 'Bramley', 'Brindley', 'Brookside', 'Chapter', 'Cleeve', 'Clover', 'Copperfield',
    'Cotswold', 'Cranfield', 'Cresswell', 'Crowther', 'Daneway', 'Deepdale', 'Dunmore', 'Eastgate',
    'Fairway', 'Fallowfield', 'Farthing', 'Fielding', 'Foxglove', 'Glendale', 'Granary', 'Greystone',
    'Haldon', 'Harborne', 'Hawksworth', 'Highfield', 'Hillcrest', 'Holbrook', 'Hollingworth', 'Ironbridge',
    'Ivyhouse', 'Kelmscott', 'Kingsbury', 'Larkfield', 'Lavender', 'Limekiln', 'Longmeadow', 'Mallory',
    'Maple', 'Marlborough', 'Meadowbrook', 'Meridian', 'Millbrook', 'Moorcroft', 'Nettlebed', 'Newlands',
    'Northgate', 'Oakfield', 'Otterburn', 'Pennine', 'Primrose', 'Quarry', 'Redwood', 'Rockley',
    'Ryecroft', 'Saddleworth', 'Saltmarsh', 'Sandhurst', 'Shirebrook', 'Southgate', 'Springfield', 'Stanley',
    'Stonebridge', 'Thornbury', 'Thornfield', 'Underhill', 'Watermill', 'Westbourne', 'Wexford', 'Wheatlands',
    'Willowbrook', 'Windermere', 'Winterbourne', 'Woodcote', 'Yewtree',
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
  'Air conditioning engineer', 'Ambulance technician', 'Architect', 'Arborist', 'Bakery assistant',
  'Bank clerk', 'Barista', 'Bathroom fitter', 'Bin lorry driver', 'Boat builder', 'Bookkeeper',
  'Builder', 'Building surveyor', 'Bus driver', 'Cabinet maker', 'Car salesman', 'Caretaker',
  'Carpenter', 'Catering manager', 'Chemist', 'Chimney sweep', 'Civil engineer', 'Cleaner',
  'Coach driver', 'Courier', 'Crane operator', 'Dairy farmer', 'Data analyst', 'Dentist',
  'Diesel fitter', 'Drayman', 'Dryliner', 'Estate agent', 'Events manager', 'Excavator driver',
  'Factory worker', 'Farm manager', 'Fencer', 'Fibre engineer', 'Fishmonger', 'Fitter',
  'Floor layer', 'Florist', 'Football coach', 'Foreman', 'Forester', 'Foundry worker',
  'Furniture maker', 'Gamekeeper', 'Gas engineer', 'General builder', 'Glazier', 'Greenkeeper',
  'Greengrocer', 'Groundsman', 'Gym manager', 'Handyman', 'Heating engineer', 'Hod carrier',
  'Horticulturist', 'Hotel manager', 'Insurance broker', 'Journalist', 'Kitchen fitter',
  'Land surveyor', 'Landlord', 'Lettings agent', 'Locksmith', 'Logistics manager', 'Machine operator',
  'Machinist', 'Metal fabricator', 'Milkman', 'Motorcycle mechanic', 'Network engineer', 'Newsagent',
  'Nursery worker', 'Office manager', 'Panel beater', 'Park keeper', 'Parts advisor', 'Pharmacist',
  'Photographer', 'Physiotherapist', 'Pilot', 'Pipe fitter', 'Plumber', 'Poultry farmer',
  'Prison officer', 'Project manager', 'Quarry worker', 'Radiographer', 'Rail engineer', 'Receptionist',
  'Recruitment consultant', 'Retired', 'Scrap dealer', 'Semi-retired', 'Sheet metal worker',
  'Shepherd', 'Shopfitter', 'Sign maker', 'Site engineer', 'Skip driver', 'Steel erector',
  'Stonemason', 'Support worker', 'Tattoo artist', 'Taxi driver', 'Telecoms engineer', 'Tiler',
  'Toolmaker', 'Traffic management', 'Trainer', 'Transport manager', 'Tree surgeon',
  'TV aerial installer', 'Water engineer', 'Welder', 'Wheelwright', 'Window fitter', 'Yard foreman',
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
  { primary: '#7b1f2b', secondary: '#f4e3c1' },
  { primary: '#1b5e20', secondary: '#f9f9f4' },
  { primary: '#0d3b66', secondary: '#f4d35e' },
  { primary: '#111827', secondary: '#e5e7eb' },
  { primary: '#003049', secondary: '#f77f00' },
  { primary: '#4a148c', secondary: '#e1bee7' },
  { primary: '#00695c', secondary: '#ffffff' },
  { primary: '#8d6e63', secondary: '#ffffff' },
  { primary: '#37474f', secondary: '#ffffff' },
  { primary: '#a5d6a7', secondary: '#1b5e20' },
  { primary: '#fdd835', secondary: '#0d47a1' },
  { primary: '#e65100', secondary: '#000000' },
  { primary: '#283593', secondary: '#ffffff' },
  { primary: '#880e4f', secondary: '#fce4ec' },
  { primary: '#33691e', secondary: '#fffde7' },
  { primary: '#5d4037', secondary: '#ffe0b2' },
  { primary: '#01579b', secondary: '#ffffff' },
  { primary: '#616161', secondary: '#ffd54f' },
  { primary: '#c2185b', secondary: '#111111' },
  { primary: '#1a237e', secondary: '#f8bbd0' },
  { primary: '#827717', secondary: '#111111' },
  { primary: '#00897b', secondary: '#111111' },
  { primary: '#d32f2f', secondary: '#ffd600' },
  { primary: '#455a64', secondary: '#ffeb3b' },
  { primary: '#6a1b9a', secondary: '#ffd54f' },
  { primary: '#004d40', secondary: '#a7ffeb' },
  { primary: '#bf360c', secondary: '#ffe0b2' },
  { primary: '#263238', secondary: '#4fc3f7' },
  { primary: '#689f38', secondary: '#263238' },
  { primary: '#ec407a', secondary: '#1a237e' },
  { primary: '#1565c0', secondary: '#ffd600' },
  { primary: '#ffffff', secondary: '#c62828' },
  { primary: '#212121', secondary: '#ffab00' },
  { primary: '#006064', secondary: '#ffe082' },
  { primary: '#3e2723', secondary: '#ffffff' },
  { primary: '#4527a0', secondary: '#ffd54f' },
  { primary: '#0288d1', secondary: '#ffffff' },
];
