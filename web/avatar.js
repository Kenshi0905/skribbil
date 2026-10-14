// v1 artwork and indices are persisted data: its renderer is frozen.
import * as v1 from './avatar-v1.js';
import { avatarV2Options, avatarV2Keys, defaultAvatarV2, validateAvatarV2, renderAvatarV2 } from './avatar-v2.js';
export { avatarV2Options, avatarV2Keys, defaultAvatarV2 };
export const { avatarOptions, avatarKeys, defaultAvatar } = v1;
export const validateAvatar = value => value?.version === 2 ? validateAvatarV2(value) : v1.validateAvatar(value);
export const renderAvatar = value => value?.version === 2 ? renderAvatarV2(value) : v1.renderAvatar(value);
export function avatarUrl(value) {
  if(value?.version!==2)return v1.avatarUrl(value);
  const a=validateAvatarV2(value);
  return `/api/avatar-presets/v2/${avatarV2Keys.map(k=>a[k]).join('-')}.svg`;
}
export function avatarFromUrl(url) {
  const legacy=v1.avatarFromUrl(url);if(legacy)return legacy;
  if(typeof url!=='string')return null;
  const code=url.match(/^\/api\/avatar-presets\/v2\/((?:\d{1,2}-){11}\d{1,2})\.svg$/)?.[1];
  if(!code)return null;
  try{const a=validateAvatarV2({version:2,...Object.fromEntries(code.split('-').map((n,i)=>[avatarV2Keys[i],Number(n)]))});return avatarUrl(a)===url?a:null;}catch{return null;}
}
export function editableAvatar(value) {
  if(value?.version===2)return validateAvatarV2(value);
  return {...defaultAvatarV2,...(value?v1.validateAvatar(value):{})};
}
export const avatarVibes=Object.freeze(['Cute','Anime','Goofy','Chaos']);
export function randomAvatar(random=Math.random,vibe) {
  if(!vibe)return v1.randomAvatar(random);
  if(!avatarVibes.includes(vibe))throw new Error('Choose a valid avatar vibe.');
  const pools={Cute:{face:[0,1,6],eyes:[3,6,14],nose:[0,1,5],mouth:[0,6,14],ears:[0,1],accessory:[5,7,11,16]},Anime:{face:[2,0],hair:[3,8,9,12,14,16,20,21],eyes:[6,15,3],eyebrows:[2,3],nose:[0,5],mouth:[3,7,14],ears:[0,1,2],accessory:[7,8,12,13]},Goofy:{face:[1,3,4,5,6],hair:[10,11,13,15,17,18,19,22,23],eyes:[7,10,11,12,13],nose:[2,3,4],mouth:[8,9,10,11,12,15],ears:[2,3,4,5],accessory:[6,8,10,14,15]}};
  const choose=items=>items[Math.min(items.length-1,Math.max(0,Math.floor(random()*items.length)))];
  return {version:2,...Object.fromEntries(avatarV2Keys.map(k=>[k,choose(pools[vibe]?.[k]||avatarV2Options[k].map((_,i)=>i))]))};
}
