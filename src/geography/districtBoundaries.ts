import type { BoundaryCut } from './geometry';

/** Actual national-space routes, never a normalized subdivision template.
 * Five local administrative divisions produce six catchments. Child order is
 * clockwise boundary traversal; route geometry is shared, not duplicated.
 * d1..d6 bind to explicitly listed local identities in alderland.ts.
 */
export const DISTRICT_BOUNDARIES: Readonly<Record<string, readonly BoundaryCut[]>> = {
  // Alderford's compact crossing district contrasts with the long Westbrook
  // valley, eastern millwater corridor and wooded western parish catchments.
  alder: [
    {parent:'land',children:['east','west'],route:[[420,470],[405,510],[420,540],[405,565],[400,600]]},
    {parent:'east',children:['d1','eastRest'],route:[[405,510],[440,515],[475,545]]},
    {parent:'eastRest',children:['d6','d3'],route:[[420,540],[445,555],[462,585],[500,585]]},
    {parent:'west',children:['woods','d2'],route:[[345,485],[330,520],[315,550],[260,535]]},
    {parent:'woods',children:['d5','d4'],route:[[315,550],[330,580],[315,625]]},
  ],
  bracken: [
    {parent:'land',children:['east','west'],route:[[370,380],[375,410],[355,440],[345,485]]},
    {parent:'east',children:['d3','e'],route:[[375,410],[410,400],[435,405]]},
    {parent:'e',children:['d4','d1'],route:[[355,440],[390,435],[455,435]]},
    {parent:'west',children:['d2','w'],route:[[300,365],[325,405],[375,410]]},
    {parent:'w',children:['d6','d5'],route:[[325,405],[310,440],[280,460]]},
  ],
  calder: [
    {parent:'land',children:['upper','lower'],route:[[435,405],[485,415],[535,405],[590,410]]},
    {parent:'upper',children:['d2','d6'],route:[[520,390],[525,398],[535,405]]},
    {parent:'lower',children:['east','west'],route:[[535,405],[550,445],[575,480]]},
    {parent:'east',children:['d3','d5'],route:[[550,445],[585,450],[625,460]]},
    {parent:'west',children:['d1','d4'],route:[[455,435],[490,440],[510,465],[550,445]]},
  ],
  iron: [
    {parent:'land',children:['moor','basin'],route:[[458,270],[495,285],[530,270],[565,280]]},
    {parent:'moor',children:['d2','d4'],route:[[530,240],[515,255],[530,270]]},
    {parent:'basin',children:['east','west'],route:[[530,270],[545,305],[535,335],[520,390]]},
    {parent:'east',children:['d6','d5'],route:[[545,305],[565,320],[590,315]]},
    {parent:'west',children:['d3','d1'],route:[[475,315],[495,330],[535,335]]},
  ],
  dun: [
    {parent:'land',children:['fells','dene'],route:[[330,280],[380,275],[410,285],[458,270]]},
    {parent:'fells',children:['f','d3'],route:[[400,235],[395,255],[380,275]]},
    {parent:'f',children:['d5','d4'],route:[[410,285],[425,260],[470,225]]},
    {parent:'dene',children:['d2','valley'],route:[[410,285],[415,320],[445,360]]},
    {parent:'valley',children:['d6','d1'],route:[[290,320],[340,330],[380,345],[415,320]]},
  ],
  highmarch: [
    {parent:'land',children:['coast','forest'],route:[[655,220],[630,265],[640,310],[675,385]]},
    {parent:'forest',children:['d5','f'],route:[[565,280],[600,275],[630,265]]},
    {parent:'f',children:['d4','d2'],route:[[590,315],[615,325],[640,310]]},
    {parent:'coast',children:['d6','c'],route:[[640,310],[660,300],[670,280]]},
    {parent:'c',children:['d1','d3'],route:[[660,300],[685,330],[725,320]]},
  ],
  eastmarch: [
    {parent:'land',children:['headland','river'],route:[[590,410],[645,420],[690,405],[720,415]]},
    {parent:'headland',children:['d3','d2'],route:[[675,385],[665,400],[690,405]]},
    {parent:'river',children:['shore','bank'],route:[[690,405],[700,450],[720,495]]},
    {parent:'bank',children:['d5','d1'],route:[[625,460],[660,455],[675,475],[700,450]]},
    {parent:'shore',children:['d4','d6'],route:[[700,450],[735,470],[770,465]]},
  ],
  caster: [
    {parent:'land',children:['market','mere'],route:[[475,545],[530,550],[575,535],[635,565]]},
    {parent:'market',children:['d2','d1'],route:[[575,480],[560,510],[575,535]]},
    {parent:'mere',children:['east','west'],route:[[575,535],[585,580],[580,610]]},
    {parent:'east',children:['d3','d4'],route:[[585,580],[620,590],[660,605]]},
    {parent:'west',children:['d5','d6'],route:[[500,585],[535,580],[550,600],[585,580]]},
  ],
  fenwick: [
    {parent:'land',children:['reach','fens'],route:[[635,565],[690,555],[745,570],[790,560]]},
    {parent:'reach',children:['r','d3'],route:[[720,495],[715,530],[690,555]]},
    {parent:'r',children:['d1','d4'],route:[[715,530],[755,530],[800,510]]},
    {parent:'fens',children:['d2','west'],route:[[745,570],[760,600],[745,635]]},
    {parent:'west',children:['d6','d5'],route:[[660,605],[710,595],[760,600]]},
  ],
  wych: [
    {parent:'land',children:['wood','fen'],route:[[235,690],[280,675],[335,695],[395,715]]},
    {parent:'wood',children:['w','d2'],route:[[315,625],[300,655],[280,675]]},
    {parent:'w',children:['d4','d5'],route:[[335,695],[350,665],[375,655]]},
    {parent:'fen',children:['d3','villages'],route:[[335,695],[330,735],[305,760]]},
    {parent:'villages',children:['d6','d1'],route:[[210,735],[265,730],[330,735]]},
  ],
  redford: [
    {parent:'land',children:['upper','lower'],route:[[375,655],[435,665],[495,650],[560,670],[650,685]]},
    {parent:'upper',children:['d2','d3'],route:[[580,610],[570,635],[560,670]]},
    {parent:'lower',children:['east','west'],route:[[495,650],[505,690],[490,730],[480,765]]},
    {parent:'west',children:['d5','d1'],route:[[395,715],[450,700],[505,690]]},
    {parent:'east',children:['d4','d6'],route:[[490,730],[555,735],[610,720],[680,730]]},
  ],
  greymere: [
    {parent:'land',children:['strand','tidal'],route:[[650,685],[710,695],[765,680],[845,690]]},
    {parent:'strand',children:['d2','d6'],route:[[745,635],[740,665],[765,680]]},
    {parent:'tidal',children:['port','marsh'],route:[[765,680],[770,730],[790,770],[775,820]]},
    {parent:'marsh',children:['d4','d5'],route:[[680,730],[725,740],[770,730]]},
    {parent:'port',children:['d1','d3'],route:[[790,770],[825,755],[870,750]]},
  ],
  king: [
    {parent:'land',children:['hundred','downs'],route:[[195,870],[280,840],[365,855],[485,870]]},
    {parent:'hundred',children:['d2','h'],route:[[385,790],[375,825],[365,855]]},
    {parent:'h',children:['d1','d6'],route:[[280,840],[305,800],[305,760]]},
    {parent:'downs',children:['chalk','d3'],route:[[350,920],[340,885],[365,855]]},
    {parent:'chalk',children:['d4','d5'],route:[[265,940],[290,895],[340,885]]},
  ],
  southam: [
    {parent:'land',children:['north','south'],route:[[465,820],[525,835],[590,820],[655,825]]},
    {parent:'north',children:['d2','d5'],route:[[575,800],[570,810],[590,820]]},
    {parent:'south',children:['east','west'],route:[[590,820],[585,860],[605,895],[625,940]]},
    {parent:'west',children:['d1','d3'],route:[[485,870],[525,875],[555,855],[585,860]]},
    {parent:'east',children:['d4','d6'],route:[[605,895],[650,890],[695,860]]},
  ],
  mereford: [
    {parent:'land',children:['north','harbours'],route:[[655,825],[720,835],[765,850],[875,830]]},
    {parent:'north',children:['d4','d6'],route:[[775,820],[780,835],[765,850]]},
    {parent:'harbours',children:['coast','inland'],route:[[765,850],[780,875],[790,895],[820,910]]},
    {parent:'inland',children:['d1','d5'],route:[[695,860],[735,865],[755,890],[780,875]]},
    {parent:'coast',children:['d2','d3'],route:[[780,875],[805,870],[840,860]]},
  ],
  bellamere: [
    {parent:'land',children:['shelf','point'],route:[[265,940],[290,990],[355,1015],[355,1080]]},
    {parent:'point',children:['d6','p'],route:[[100,1010],[135,1050],[210,1060],[290,990]]},
    {parent:'p',children:['d1','d2'],route:[[210,1060],[225,1090],[235,1120]]},
    {parent:'shelf',children:['d5','west'],route:[[535,915],[550,960],[535,1000],[535,1070]]},
    {parent:'west',children:['d4','d3'],route:[[355,1015],[415,1000],[470,1020],[535,1000]]},
  ],
  westmor: [
    {parent:'land',children:['fell','vale'],route:[[375,115],[425,135],[470,130],[495,115]]},
    {parent:'fell',children:['d5','d2'],route:[[450,55],[445,95],[425,135]]},
    {parent:'vale',children:['east','west'],route:[[470,130],[450,175],[460,200],[470,225]]},
    {parent:'west',children:['d1','d4'],route:[[365,160],[400,180],[450,175]]},
    {parent:'east',children:['d3','d6'],route:[[460,200],[490,190],[520,165]]},
  ],
  thorn: [
    {parent:'land',children:['cliffs','valley'],route:[[520,165],[565,155],[590,170],[610,155]]},
    {parent:'cliffs',children:['d3','d1'],route:[[540,95],[555,125],[565,155]]},
    {parent:'valley',children:['east','west'],route:[[590,170],[575,200],[590,230]]},
    {parent:'west',children:['d2','d5'],route:[[505,200],[540,190],[575,200]]},
    {parent:'east',children:['d4','d6'],route:[[575,200],[615,200],[655,220]]},
  ],
};
