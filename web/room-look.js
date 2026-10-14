import { avatarOptions, avatarKeys, defaultAvatar, avatarFromUrl, avatarUrl, randomAvatar } from './avatar.js';

const labels = {hair:'Hair',eyes:'Eyes',eyebrows:'Brows',mouth:'Mouth',accessory:'Extras',skin:'Skin tone',hairColor:'Hair color',shirtColor:'Clothing',background:'Background'};
const mediaPath = /^\/api\/media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function roomDisplayName(value) {
  return Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu,c=>c==='\u200d'?c:'').trim()).slice(0,30).join('').trim();
}
export function roomRules({players=[],ownID,ownerID,gameState}) {
  const self=players.find(p=>p.id===ownID), guests=players.filter(p=>p.connected && p.state!=='spectating' && p.id!==ownerID);
  const count=players.filter(p=>p.connected && p.state!=='spectating').length;
  return {self,host:ownID===ownerID,editable:gameState==='unstarted' && Boolean(self?.connected) && self.state!=='spectating',
    canStart:gameState==='unstarted' && count>=2 && guests.every(p=>p.state==='ready'),count,ready:guests.filter(p=>p.state==='ready').length,needed:guests.length};
}

// All player strings go through textContent or input.value. This component only
// emits match-scoped WS commands; it has no profile API or persistence access.
export function createRoomLook(root,{send,isConnected,focusAfterStart}) {
  let snapshot={players:[],gameState:'unstarted'},draft=null,pending=null,error='',notice='';
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;};
  const button=(text,fn,cls='')=>{const b=node('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;};
  const title=node('h2','Before we draw…'), hint=node('p','Pick your room look.');
  title.id='room-look-title';root.setAttribute('aria-labelledby',title.id);
  const scope=node('p','This only changes how you appear in this room. Your profile stays untouched.','room-look-scope');
  const columns=node('div',null,'room-look-columns'), identity=node('div',null,'room-look-identity');
  const preview=node('div',null,'room-look-preview');
  const edit=button('Edit room look',()=>openEditor(),'room-look-edit');
  const form=node('form');form.hidden=true;form.noValidate=true;
  const nameLabel=node('label','Room display name'),name=node('input');name.id='room-display-name';name.type='text';name.autocomplete='off';name.maxLength=120;nameLabel.htmlFor=name.id;
  const nameHelp=node('small','Up to 30 characters. Longer names are shortened safely.');nameHelp.id='room-name-help';name.setAttribute('aria-describedby',nameHelp.id);
  const selects=node('div',null,'room-look-drawers');const fields={};
  for(const key of avatarKeys) {
    const label=node('label',labels[key]),select=node('select');select.id=`room-${key}`;label.htmlFor=select.id;
    avatarOptions[key].forEach((option,i)=>{const o=node('option',typeof option==='string'?option:option.name);o.value=String(i);select.append(o);});
    select.addEventListener('change',()=>{if(!canEdit())return;const preset=avatarFromUrl(draft.avatarUrl)||{...defaultAvatar};preset[key]=Number(select.value);draft.avatarUrl=avatarUrl(preset);updatePreview();});
    label.append(select);selects.append(label);fields[key]=select;
  }
  const restore=button('Use my profile look',()=>{if(!canEdit())return;draft={...snapshot.profileIdentity};syncDraft();});
  const shuffle=button('⚄ Surprise me',()=>{if(!canEdit())return;draft.avatarUrl=avatarUrl(randomAvatar());syncDraft();},'room-look-shuffle');
  const apply=node('button','Apply room look','room-look-primary');apply.type='submit';
  const cancel=button('Cancel',()=>{if(pending)return;draft=null;error='';render();edit.focus();});
  const actions=node('div',null,'room-look-actions');actions.append(apply,cancel);
  form.append(nameLabel,name,nameHelp,selects,shuffle,restore,actions);
  name.addEventListener('input',()=>{if(canEdit()){draft.displayName=name.value;updatePreview();}});
  form.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pending){e.preventDefault();cancel.click();}});
  form.addEventListener('submit',e=>{e.preventDefault();if(!canEdit())return;if(!draft.displayName.trim()){error='Enter a room name.';render();name.focus();return;}command('room-identity-change',{...draft});});
  identity.append(preview,edit,form);
  const rosterSection=node('section',null,'room-look-roster-section'),roster=node('ul',null,'room-look-roster');roster.setAttribute('aria-label','Room roster');rosterSection.append(node('h3','The drawing crew'),roster);
  columns.append(identity,rosterSection);
  const status=node('p',null,'room-look-status');status.setAttribute('role','status');
  const errors=node('p',null,'room-look-error');errors.setAttribute('role','alert');
  const bottom=node('div',null,'room-look-actions');
  const readyLabel=node('label',null,'room-look-ready'),ready=node('input');ready.type='checkbox';ready.id='room-ready';readyLabel.htmlFor=ready.id;const readyText=node('span','Ready');readyLabel.append(ready,readyText);
  ready.addEventListener('change',()=>command('toggle-readiness'));
  const start=button('Start game',()=>command('start'),'room-look-primary');bottom.append(readyLabel,start);
  root.append(title,hint,scope,columns,errors,status,bottom);

  function avatar(person) {
    const holder=node('span',Array.from(person.displayName||person.name||'?').slice(0,2).join('').toUpperCase(),'room-look-avatar');holder.setAttribute('aria-hidden','true');
    if(avatarFromUrl(person.avatarUrl)||mediaPath.test(person.avatarUrl||'')) {
      const img=node('img');img.alt='';img.src=person.avatarUrl;img.addEventListener('error',()=>img.remove(),{once:true});holder.append(img);
    }
    return holder;
  }
  function canEdit(){return draft && !pending && roomRules(snapshot).editable && isConnected();}
  function updatePreview(){const self=roomRules(snapshot).self;preview.replaceChildren();if(!self)return;const raw=draft||{displayName:self.name,avatarUrl:self.avatarUrl};const look={...raw,displayName:roomDisplayName(raw.displayName)};preview.append(avatar(look),node('strong',roomDisplayName(look.displayName)||'Your room name'),node('small',draft?'Preview · not applied yet':'Your room look · You'));}
  function syncDraft(){name.value=draft.displayName;const preset=avatarFromUrl(draft.avatarUrl)||defaultAvatar;for(const key of avatarKeys)fields[key].value=String(preset[key]);updatePreview();}
  function openEditor(){if(!roomRules(snapshot).editable||pending)return;const self=roomRules(snapshot).self;draft={displayName:self.name,avatarUrl:self.avatarUrl||''};error='';notice='';syncDraft();render();name.focus();}
  function command(action,data){
    const rules=roomRules(snapshot);
    if(pending||!rules.editable||!isConnected()||(action==='start'&&(!rules.host||!rules.canStart))||(action==='toggle-readiness'&&rules.host))return;
    pending=action;error='';notice='';render();
    try{send({type:action,...(data?{data}:{})});}catch{pending=null;error='Connection lost. Your draft is still here; reconnect and try again.';render();}
  }
  function render(){
    const rules=roomRules(snapshot),open=snapshot.gameState==='unstarted';
    if(!open){const hadFocus=root.contains(document.activeElement);root.hidden=true;draft=null;pending=null;form.hidden=true;if(hadFocus)focusAfterStart?.();return;}
    root.hidden=false;edit.hidden=!rules.editable||Boolean(draft);form.hidden=!draft||!rules.editable;
    readyLabel.hidden=!rules.editable||rules.host;start.hidden=!rules.editable||!rules.host;
    const busy=Boolean(pending)||!isConnected();root.setAttribute('aria-busy',String(Boolean(pending)));
    for(const el of [edit,name,shuffle,restore,apply,cancel,ready,...Object.values(fields)])el.disabled=busy;
    start.disabled=busy||!rules.canStart;apply.textContent=pending==='room-identity-change'?'Applying…':'Apply room look';
    ready.checked=rules.self?.state==='ready';readyText.textContent=ready.checked?'Ready':'Not ready · tick when you’re set';
    errors.textContent=error;errors.hidden=!error;
    status.textContent=(notice?notice+' ':'') + (!isConnected()?'Reconnecting…':`${rules.ready}/${rules.needed} guests ready. ${rules.count<2?'Waiting for at least two players.':rules.host?'You start when the crew is ready.':'The host starts the game.'}`);
    updatePreview();roster.replaceChildren();
    for(const p of snapshot.players.filter(p=>p.connected)) {
      const row=node('li'),who=node('span',null,'room-look-roster-name');who.append(node('strong',p.name),node('small',`${p.id===snapshot.ownID?'You · ':''}${p.id===snapshot.ownerID?'♛ Host':p.state==='spectating'?'Spectating':p.state==='ready'?'Ready':'Not ready'}`));row.append(avatar(p),who);roster.append(row);
    }
  }
  return {
    update(next){snapshot={...snapshot,...next};render();},
    result(data){if(data.action!==pending)return;const action=pending;pending=null;error=data.error||'';
      if(!error&&action==='room-identity-change'){draft=null;notice='Room look applied. Your profile is unchanged.';render();if(!root.hidden)edit.focus();}else render();},
    disconnect(){pending=null;if(draft)error='Connection lost. Your draft is still here; reconnect and try again.';render();},
  };
}
