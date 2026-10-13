// Original Skribbil artwork. Preset indices and v1 URLs are stable: append new
// choices rather than changing the order of existing ones.
const colors = entries => entries.map(([name, color]) => ({ name, color }));
export const avatarOptions = Object.freeze({
  hair: ['Bare head', 'Short crop', 'Side sweep', 'Spikes', 'Curls', 'Bob', 'Long waves', 'Top bun'],
  eyes: ['Little dots', 'Wide awake', 'Sleepy', 'Happy', 'Wink', 'Starry eyed'],
  eyebrows: ['Natural', 'Straight', 'Curious', 'Bold', 'None'],
  mouth: ['Smile', 'Big grin', 'Surprised', 'Smirk', 'Cheeky', 'Straight face'],
  accessory: ['None', 'Round glasses', 'Square glasses', 'Sunglasses', 'Freckles', 'Rosy cheeks', 'Moustache'],
  skin: colors([['Porcelain','#ffe5cf'],['Peach','#f5c6a5'],['Warm sand','#e2ac80'],['Honey','#c68b5a'],['Caramel','#a96e46'],['Chestnut','#845236'],['Espresso','#593d30'],['Deep brown','#3d2b24']]),
  hairColor: colors([['Ink','#302c3b'],['Chocolate','#684334'],['Chestnut','#92583b'],['Copper','#ce7544'],['Golden','#f3c76a'],['Silver','#c9c9db'],['Snow','#f6f3ed'],['Lilac','#ad8bdd'],['Pink','#ed8cab'],['Ocean','#689cbc']]),
  shirtColor: colors([['Violet','#8270d7'],['Coral','#e98472'],['Golden','#f4cc64'],['Sage','#80b59b'],['Sky','#80b4d5'],['Rose','#dfa0bc'],['Ink','#49465d'],['Cream','#eee6d8']]),
  background: colors([['Lilac','#e8e0f8'],['Peach','#ffe1ce'],['Butter','#fff0bb'],['Mint','#d9efe2'],['Sky','#dcecf8'],['Rose','#f7dfe8'],['Paper','#f3eee4'],['Slate','#dfe1eb']]),
});
export const avatarKeys = Object.freeze(Object.keys(avatarOptions));
export const defaultAvatar = Object.freeze({ hair:2, eyes:0, eyebrows:0, mouth:0, accessory:0, skin:1, hairColor:1, shirtColor:0, background:0 });

export function validateAvatar(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== avatarKeys.length || Object.keys(value).some(key => !avatarKeys.includes(key))) throw new Error('Choose a valid preset avatar.');
  const result = {};
  for (const key of avatarKeys) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] >= avatarOptions[key].length) throw new Error(`Choose a valid ${key} preset.`);
    result[key] = value[key];
  }
  return result;
}
export function avatarUrl(value) {
  const avatar = validateAvatar(value);
  return `/api/avatar-presets/v1/${avatarKeys.map(key => avatar[key]).join('-')}.svg`;
}
export function avatarFromUrl(url) {
  if (typeof url !== 'string') return null;
  const code = url.match(/^\/api\/avatar-presets\/v1\/((?:\d{1,2}-){8}\d{1,2})\.svg$/)?.[1];
  if (!code) return null;
  try {
    const value = validateAvatar(Object.fromEntries(code.split('-').map((part, i) => [avatarKeys[i], Number(part)])));
    return avatarUrl(value) === url ? value : null;
  } catch { return null; }
}
export function randomAvatar(random = Math.random) {
  return Object.fromEntries(avatarKeys.map(key => [key, Math.floor(random() * avatarOptions[key].length)]));
}

export function renderAvatar(value) {
  const a = validateAvatar(value), skin = avatarOptions.skin[a.skin].color,
    hair = avatarOptions.hairColor[a.hairColor].color, shirt = avatarOptions.shirtColor[a.shirtColor].color,
    background = avatarOptions.background[a.background].color, ink = '#302c3b';
  const hairBack = [
    '', '', '', '', '',
    '<path d="M48 109Q44 45 100 45t52 64l-5 54H53Z"/>',
    '<path d="M44 103Q44 40 100 44q58-4 58 62l12 91q-28 17-42-8H74q-20 18-43-1Z"/>',
    '<circle cx="100" cy="37" r="23"/><path d="M48 106Q46 45 100 45t52 61Z"/>',
  ][a.hair];
  const hairFront = [
    '',
    '<path d="M51 95Q44 45 100 45t49 50l-16-27q-31 11-64 0Z"/>',
    '<path d="M51 96Q42 45 98 44q46-1 52 44l-23-23q-20 25-60 25Z"/>',
    '<path d="m49 93 5-39 16 6 6-27 24 19 22-22 3 30 24-6 3 41-19-23-22 9-24-13-21 8Z"/>',
    '<path d="M49 97q-17-21 2-32-5-20 19-20 7-22 29-9 23-13 31 9 24-1 21 20 19 15 0 30l-10-23q-13 13-25-3-16 13-30 0-10 16-23 2Z"/>',
    '<path d="M48 109Q42 46 100 45q58 0 52 64l-17-36q-35 21-65-2l-15 38Z"/>',
    '<path d="M49 111Q42 42 100 44q61-4 53 69l-17-39-13-10q-30 27-55 15l-12 32Z"/>',
    '<path d="M49 102Q43 45 100 45t52 57l-20-30q-32 18-64 0Z"/>',
  ][a.hair];
  const eyes = [
    '<ellipse cx="77" cy="110" rx="4" ry="6"/><ellipse cx="123" cy="110" rx="4" ry="6"/>',
    '<g fill="#fff"><ellipse cx="77" cy="109" rx="10" ry="13"/><ellipse cx="123" cy="109" rx="10" ry="13"/></g><g stroke="none"><circle cx="79" cy="112" r="5"/><circle cx="125" cy="112" r="5"/></g>',
    '<path d="M66 107h20m28 0h20" fill="none"/><path d="M72 107v7m51-7v7"/>',
    '<path d="M67 113q10-14 20 0m26 0q10-14 20 0" fill="none"/>',
    '<ellipse cx="77" cy="110" rx="4" ry="6"/><path d="m114 108 8 5 10-6" fill="none"/>',
    '<path d="m77 99 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Zm46 0 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z" stroke-width="1.5"/>',
  ][a.eyes];
  const brows = [
    '<path d="m67 94 17-2m32 0 17 2"/>',
    '<path d="M66 94h20m28 0h20"/>',
    '<path d="m66 90 20 4m29-2 18-6"/>',
    '<path d="M66 93h20m28 0h20" stroke-width="6"/>', '',
  ][a.eyebrows];
  const mouth = [
    '<path d="M84 138q16 17 32 0" fill="none"/>',
    '<path d="M81 134h38q-3 24-19 24t-19-24Z" fill="#fff"/><path d="M85 144h30" fill="none" stroke-width="2"/>',
    '<ellipse cx="100" cy="143" rx="8" ry="11" fill="#684334"/>',
    '<path d="M88 145q16 4 28-10" fill="none"/>',
    '<path d="M83 137q17 16 34 0" fill="none"/><path d="M99 145h14v7q-7 11-14 0Z" fill="#ed8cab"/>',
    '<path d="M86 143h28" fill="none"/>',
  ][a.mouth];
  const accessory = [
    '',
    '<g fill="none"><circle cx="76" cy="110" r="17"/><circle cx="124" cy="110" r="17"/><path d="M93 108q7-6 14 0m-64-7 17 5m81 0 16-5"/></g>',
    '<g fill="none"><rect x="58" y="97" width="35" height="27" rx="5"/><rect x="107" y="97" width="35" height="27" rx="5"/><path d="M93 108h14m-64-7 15 5m84 0 16-5"/></g>',
    '<path d="M56 98h36v20q-18 16-32-2Zm52 0h36l-4 18q-14 16-32 2Z" fill="#49465d"/><path d="M92 106h16m-63-5 11 4m88 0 12-4"/><path d="m65 105 12 10m40-10 12 10" stroke="#dfe1eb" stroke-width="2"/>',
    '<g fill="#92583b" stroke="none"><circle cx="64" cy="128" r="2"/><circle cx="72" cy="131" r="2"/><circle cx="79" cy="126" r="2"/><circle cx="122" cy="126" r="2"/><circle cx="130" cy="131" r="2"/><circle cx="138" cy="128" r="2"/></g>',
    '<g fill="#e98472" opacity=".55" stroke="none"><ellipse cx="64" cy="129" rx="12" ry="6"/><ellipse cx="136" cy="129" rx="12" ry="6"/></g>',
    `<path d="M100 133q-9-10-16-3l-10 7q15 9 26-1 11 10 26 1l-10-7q-7-7-16 3Z" fill="${hair}" stroke-width="2"/>`,
  ][a.accessory];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="Custom Skribbil avatar"><rect width="200" height="200" rx="30" fill="${background}"/><g stroke="${ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><g fill="${hair}">${hairBack}</g><path d="M35 204q3-44 65-44t65 44" fill="${shirt}"/><path d="M85 149v20q15 16 30 0v-20" fill="${skin}"/><ellipse cx="49" cy="113" rx="10" ry="13" fill="${skin}"/><ellipse cx="151" cy="113" rx="10" ry="13" fill="${skin}"/><path d="M51 96q0-43 49-43t49 43v28q-2 39-49 39t-49-39Z" fill="${skin}"/><g fill="${hair}">${hairFront}</g><g fill="${ink}">${eyes}</g><g fill="none" stroke="${hair}">${brows}</g><path d="m99 119-3 8h7" fill="none" stroke-width="2" opacity=".5"/>${mouth}${accessory}<path d="M57 192v8m86-8v8" fill="none" opacity=".4"/></g></svg>`;
}
