import {avatarOptions as legacy,renderAvatar as renderLegacy,defaultAvatar} from './avatar-v1.js';
export const avatarV2Options=Object.freeze({
  face:['Round mochi','Certified bean','Anime chin','Long noodle','Hero jaw','The chin','Soft double chin'],
  hair:[...legacy.hair,'Main character','Twin tails','Mega pompadour','Mushroom','Cat tufts','Cloud curls','Lightning fringe','One brave hair','Little sprout','Floppy fringe','Flat-top','Bed hair','Jellyfish bob','Heart fringe','Tiny wig','Shiny bald'],
  eyes:[...legacy.eyes,'Anime sparkle','Googly mismatch','Side-eye','Sleep mode','Dizzy spirals','>_<','One big thought','Loading…','Happy tears','Shonen stare'],
  eyebrows:[...legacy.eyebrows],nose:['Tiny anime line','Button','Long triangle','Piggy','Sideways','Invisible'],
  mouth:[...legacy.mouth,':3','Emotional support tooth','Buck teeth','Tiny scream','Mega grin','Tongue out','Crooked smile','Smug','uwu','Dramatic scream'],
  ears:['Satellite mode','Tiny ears','Elf ears','Monkey rounds','Uneven','Sticking out'],
  accessory:[...legacy.accessory,'Blush lines','Mild panic','Cheek bandage','Star cheek','Heart cheek','Tiny crown','Headband','Forehead vein','Whiskers','More freckles','Round frames','Square frames','Heart frames','Star frames','Oversized frames'],
  skin:legacy.skin,hairColor:legacy.hairColor,shirtColor:legacy.shirtColor,background:legacy.background,
});
export const avatarV2Keys=Object.freeze(Object.keys(avatarV2Options));
export const defaultAvatarV2=Object.freeze({version:2,face:0,hair:2,eyes:0,eyebrows:0,nose:0,mouth:0,ears:1,accessory:0,skin:1,hairColor:1,shirtColor:0,background:0});
export function validateAvatarV2(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==2||Object.keys(value).length!==avatarV2Keys.length+1||Object.keys(value).some(k=>k!=='version'&&!avatarV2Keys.includes(k)))throw new Error('Choose a valid v2 avatar.');
  const a={version:2};for(const k of avatarV2Keys){if(!Number.isInteger(value[k])||value[k]<0||value[k]>=avatarV2Options[k].length)throw new Error(`Choose a valid ${k} preset.`);a[k]=value[k];}return a;
}
const path=(d,attrs='')=>`<path d="${d}" ${attrs}/>`;
const circle=(x,y,r,attrs='')=>`<circle cx="${x}" cy="${y}" r="${r}" ${attrs}/>`;
const ellipse=(x,y,rx,ry,attrs='')=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" ${attrs}/>`;
const star=(x,y,r=10)=>path(`m${x} ${y-r} ${r*.3} ${r*.65} ${r*.7} ${r*.1} -${r*.5} ${r*.5} ${r*.15} ${r*.75} -${r*.65} -${r*.4} -${r*.65} ${r*.4} ${r*.15} -${r*.75} -${r*.5} -${r*.5} ${r*.7} -${r*.1}Z`);
const heart=(x,y)=>path(`M${x} ${y+8}q-18-10-12-19 7-8 12 1 5-9 12-1 6 9-12 19Z`);
// Pull only trusted, static v1 layers. The new schema owns the actual head,
// ears and nose geometry; no head overlay or user-supplied SVG is involved.
function legacyLayers(a){
  const base=renderLegacy({...defaultAvatar,...Object.fromEntries(Object.keys(defaultAvatar).map(k=>[k,a[k]<legacy[k].length?a[k]:0]))});
  const body=base.slice(base.indexOf('<g stroke='),-6);
  return {
    back:body.match(/<g fill="#[a-f0-9]+">(.*?)<\/g>/)[1],
    front:body.match(/<path d="M51 96q0-43[^>]+\/><g fill="#[a-f0-9]+">(.*?)<\/g>/)[1],
    eyes:body.match(/<\/g><g fill="#[a-f0-9]+">(.*?)<\/g><g fill="none" stroke=/)[1],
    brows:body.match(/<g fill="none" stroke="#[a-f0-9]+">(.*?)<\/g>/)[1],
    tail:body.slice(body.indexOf('<path d="m99 119')).replace(/^<path[^>]+\/>/,'').replace(/<path d="M57 192.*$/,''),
  };
}
export function renderAvatarV2(value){
  const a=validateAvatarV2(value),ink='#302c3b',skin=legacy.skin[a.skin].color,hair=legacy.hairColor[a.hairColor].color,shirt=legacy.shirtColor[a.shirtColor].color,bg=legacy.background[a.background].color,l=legacyLayers(a),featureInk=a.skin>=6?'#fff0dd':ink;
  const faces=[
    'M52 96Q50 52 100 52t48 44v27q0 40-48 40t-48-40Z',
    'M52 96Q49 51 100 52q46 0 48 44v27q-10 25-28 27-12 24-40 9-30-8-28-36Z',
    'M52 96Q50 52 100 52t48 44v26q-5 21-48 45-43-24-48-45Z',
    'M54 96Q52 52 100 52t46 44v35q-2 43-46 43t-46-43Z',
    'M52 96Q50 52 100 52t48 44v37l-16 29H68l-16-29Z',
    'M52 96Q50 52 100 52t48 44v27q-2 24-22 29l9 12q-37 21-58-5-25-12-25-36Z',
    'M52 96Q50 52 100 52t48 44v28q-1 26-22 32-26 26-52 0-21-6-22-32Z',
  ];
  const ears=[ellipse(44,112,16,20)+ellipse(156,112,16,20),ellipse(49,113,7,10)+ellipse(151,113,7,10),path('M53 102 25 86q2 38 29 37M147 102l28-16q-2 38-29 37'),circle(43,111,16)+circle(157,111,16),ellipse(45,111,14,19)+ellipse(152,115,8,12),path('M53 103 22 105l9 20 24-4M147 103l31 2-9 20-24-4')];
  const hairs=[
    path('m48 97-7-30 18 1-3-27 21 14 7-38 23 27 28-17-1 32 25-4-10 42-20-20-12 18-12-23-23 20-8-17Z'),
    path('M49 100Q42 43 100 43t51 57l-21-27-14 16-16-15-18 17-14-19Z'),
    path('M50 99Q24 50 63 31q-5-23 22-12 53-15 66 30 6 31-5 49l-17-28q-43 16-63 0Z'),
    path('M46 100Q35 44 100 44t54 56H46Z')+path('M57 84h86','fill="none"'),
    path('m48 98 4-64 28 22q20-10 40 0l28-22 4 64-19-27q-33 18-66 0Z'),
    path('M47 100q-22-10-9-30-8-24 17-26 8-27 32-15 19-23 37-1 30-7 34 17 25 3 18 26 12 21-19 30l-22-27q-12 11-24 0-21 10-37-4Z'),
    path('M49 98Q43 44 100 44t52 54l-25-27-17 22 2-27-26 28 7-30-25 21Z'),
    path('M96 53q-4-26 11-32 5 14-1 32','fill="none"'),
    path('M100 54V30q-25 0-26-16 26-4 26 16 1-20 25-15-1 17-25 15','fill="#80b59b"'),
    path('M50 94Q38 43 100 43q69 0 51 81-10 8-20-3l-3-51q-30 22-67 16Z'),
    path('M50 98V35h100v63l-20-25H69Z'),
    path('m49 98-10-35 24 3-9-24 26 9 18-32 13 30 32-19-6 31 26 5-14 32-20-25-20 17-24-17-20 23Z'),
    path('M46 96Q35 44 100 44t54 52l-15-20q-13 9-22 0l-17 10-17-10q-10 9-22 0Z'),
    path('M49 99Q42 42 100 44q59-2 52 55l-22-31q-17 3-30 24-13-21-30-24Z'),
    path('M78 64q-6-22 22-22t22 22l-12-7-10 11-10-11Z'),
    path('M74 69q10-12 24-11','fill="none" stroke="#fff" opacity=".65" stroke-width="5"'),
  ];
  let back=a.hair<8?l.back:'';if([9,17,20].includes(a.hair))back=path('M47 112Q37 43 100 43t53 69l7 64H40Z');if(a.hair===9)back+=path('M51 70Q13 34 17 97l-4 63q25-3 37-50M149 70q38-36 34 27l4 63q-25-3-37-50');if(a.hair===20)back+=path('M50 112v62m15-62v66m70-66v66m15-66v62','fill="none" stroke-width="7"');
  const animeEye=x=>ellipse(x,109,11,16,'fill="#fff"')+ellipse(x,111,7,11,'fill="#8270d7"')+circle(x-3,103,3,'fill="#fff" stroke="none"')+circle(x+3,114,2,'fill="#fff" stroke="none"');
  const eyes=[animeEye(77)+animeEye(123),circle(76,109,15,'fill="#fff"')+circle(124,111,12,'fill="#fff"')+circle(70,112,5)+circle(130,107,4),path('M65 105h24q-3 18-20 8Zm46 0h24q-3 18-20 8Z','fill="#fff"')+circle(83,109,3)+circle(129,109,3),path('M64 111h24m24 0h24m-70-4 3 4m63-4-3 4','fill="none"'),path('M77 112q-9 6-10-4t15-6q10 7 0 15t-17-5m60 0q-9 6-10-4t15-6q10 7 0 15t-17-5','fill="none" stroke-width="2.5"'),path('m67 100 14 10-14 10m66-20-14 10 14 10','fill="none"'),animeEye(75)+circle(126,112,4),circle(77,110,2)+circle(123,110,2),path('M66 109q11-16 22 0m24 0q11-16 22 0','fill="none"')+ellipse(66,121,4,8,'fill="#80b4d5" stroke-width="2"')+ellipse(134,121,4,8,'fill="#80b4d5" stroke-width="2"'),path('m63 100 27 7-5 12H69Zm74 0-27 7 5 12h16Z','fill="#fff"')+circle(79,111,4)+circle(121,111,4)];
  const noses=[path('m100 120-3 7h6','fill="none" stroke-width="2"'),ellipse(100,124,5,4),path('m98 116-8 15h18Z'),ellipse(100,124,10,6,'fill="#ed8cab"')+circle(96,124,1.5)+circle(104,124,1.5),path('m98 119 11 8-12 2','fill="none"'),''];
  const mouths=[path('M87 137q13 0 13 7 0-7 13-7m-26 0q0 12 13 7 13 5 13-7','fill="none"'),path('M83 138q17 13 34 0','fill="none"')+path('m103 143 9-1-4 11Z','fill="#fff"'),path('M81 140h38','fill="none"')+path('M91 140h18v13H91Z','fill="#fff"')+path('M100 141v12','fill="none" stroke-width="2"'),ellipse(100,145,5,9,'fill="#684334"'),path('M75 134q25 6 50 0-2 25-25 25t-25-25Z','fill="#fff"')+path('M81 143h38','fill="none" stroke-width="2"'),path('M83 138q17 15 34 0','fill="none"')+path('M95 144h15v12q-8 10-15 0Z','fill="#ed8cab"'),path('M82 145q12-8 20-3 10 7 18-8','fill="none"'),path('M87 143q18 9 31-6m-4 0h7','fill="none"'),path('M87 139q5 13 13 0 8 13 13 0','fill="none"'),ellipse(100,145,13,15,'fill="#684334"')+ellipse(100,153,8,4,'fill="#ed8cab" stroke="none"')];
  const frames=kind=>kind==='round'?circle(76,110,17)+circle(124,110,17):kind==='square'?'<rect x="58" y="97" width="35" height="27" rx="5"/><rect x="107" y="97" width="35" height="27" rx="5"/>':kind==='heart'?heart(76,110)+heart(124,110):kind==='star'?star(76,110,18)+star(124,110,18):ellipse(76,110,22,20)+ellipse(124,110,22,20);
  const extras=[path('m62 125-3 7m10-7-3 7m68-7-3 7m10-7-3 7','stroke="#ce7544" stroke-width="2"'),path('M149 77q-16 22-3 26 15 0 3-26Z','fill="#80b4d5" stroke-width="2"'),'<rect x="128" y="127" width="18" height="8" rx="2" fill="#ffe1ce"/><path d="M135 128v6"/>',`<g fill="#f4cc64" stroke-width="2">${star(137,130,7)}</g>`,`<g fill="#ed8cab" stroke-width="2">${heart(135,129)}</g>`,path('m83 40-6-22 15 7 8-18 8 18 15-7-6 22Z','fill="#f4cc64"'),path('M52 83q48-14 96 0v9q-48-14-96 0Z','fill="#e98472"'),path('m128 79 6 1-1 7m8-11-1 7 6 1','fill="none" stroke="#ce7544"'),path('m60 125-19-4m19 10-20 3m99-9 19-4m-19 10 20 3','fill="none" stroke-width="2"'),'<g fill="#c68b5a" stroke="none">'+[61,68,75,125,132,139].map((x,i)=>circle(x,126+i%3*3,2)).join('')+'</g>',...['round','square','heart','star','big'].map(k=>`<g fill="none">${frames(k)}${path('M94 109h12m-63-7 15 5m84 0 15-5')}</g>`)];
  // Split mouth/extras from the immutable v1 tail with a second neutral render.
  const neutral=legacyLayers({...a,accessory:0}).tail;
  const mouth=a.mouth<6?neutral:mouths[a.mouth-6];
  const extra=a.accessory<7?l.tail.slice(neutral.length):extras[a.accessory-7];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="Custom Skribbil avatar"><rect width="200" height="200" rx="30" fill="${bg}"/><g stroke="${ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><g fill="${hair}">${back}</g>${path('M35 204q3-38 65-38t65 38',`fill="${shirt}"`)}${path('M85 150v23q15 14 30 0v-23',`fill="${skin}"`)}<g fill="${skin}">${ears[a.ears]}${path(faces[a.face])}</g><g fill="${hair}">${a.hair<8?l.front:hairs[a.hair-8]}</g><g fill="${ink}" stroke="${a.skin>=6?featureInk:ink}" stroke-width="${a.skin>=6?2:3.5}">${a.eyes<6?l.eyes:eyes[a.eyes-6]}</g><g fill="none" stroke="${featureInk}">${l.brows}</g><g fill="${skin}" stroke="${featureInk}">${noses[a.nose]}</g><g stroke="${featureInk}">${mouth}</g>${extra}${path('M57 192v8m86-8v8','fill="none" opacity=".4"')}</g></svg>`;
}
