// Gallery nominations use authenticated HTTP, independently of the game socket.
export function createGalleryVoting(root, {roomCode, fetcher = fetch, document: doc = document, hidden = () => document.hidden} = {}) {
  let stopped = false, loading = false, pending = false, fingerprint = '', timer;
  const message = doc.createElement('p'); message.setAttribute('role','status');
  const list = doc.createElement('div'); root.append(list, message);
  async function request(path, options = {}) {
    const response = await fetcher(path, {credentials:'same-origin', ...options, signal:AbortSignal.timeout(10000)});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Voting is temporarily unavailable.');
    return body;
  }
  function render(turns) {
    const key = JSON.stringify(turns);
    if (fingerprint === key) return;
    fingerprint = key; list.replaceChildren(); root.hidden = !turns.length; note.hidden = turns.every(t => !t.open);
    for (const turn of turns) {
      const row = doc.createElement('section'); row.className = 'gallery-turn-vote';
      const title = doc.createElement('strong'); title.textContent = `${turn.artist} · ${turn.prompt}`;
      const counts = doc.createElement('span'); counts.textContent = `${turn.fame} Fame / ${turn.shame} Shame`;
      const result = doc.createElement('small');
      result.textContent = `${turn.open ? 'Open' : 'Closed'} · ${turn.decision === 'no-decision' ? 'No decision' : `${turn.decision === 'fame' ? 'Fame' : 'Shame'} candidate${turn.open ? ' (provisional)' : ''}`} · ${turn.minimum} voters minimum, ${turn.percent}% majority`;
      row.append(title, counts);
      for (const [choice,label] of [['fame','👍 Fame'],['shame','👎 Shame']]) {
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
        button.setAttribute('aria-label', `${label} for ${turn.artist}’s ${turn.prompt}`);
        button.setAttribute('aria-pressed', String(turn.choice === choice));
        button.disabled = pending || !turn.open || !turn.eligible || Boolean(turn.choice);
        button.addEventListener('click', async () => {
          if (pending) return; pending = true;
          for (const b of list.querySelectorAll('button')) b.disabled = true;
          try {
            await request(`/api/turns/${encodeURIComponent(turn.turnId)}/gallery-vote`, {method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'Skribbil'},body:JSON.stringify({choice})});
            message.textContent = 'Vote recorded.';
          } catch (error) { message.textContent = error.message; }
          finally { pending = false; fingerprint = ''; await refresh(); }
        }); row.append(button);
      }
      row.append(result);
      if (!turn.open) {
        const details = doc.createElement('details');
        const summary = doc.createElement('summary');
        summary.textContent = `Gallery closed · ${turn.fame} Fame / ${turn.shame} Shame · ${turn.decision === 'no-decision' ? 'No decision' : turn.decision + ' candidate'}`;
        details.append(summary,row); list.append(details);
      } else list.append(row);
    }
  }
  async function refresh() {
    if (stopped || loading || pending || hidden()) return;
    loading = true;
    try { const data = await request(`/api/rooms/${encodeURIComponent(roomCode)}/gallery-votes`); if (!stopped) render(data.turns); }
    catch (error) { if (!root.hidden) message.textContent = error.message; }
    finally { loading = false; }
  }
  const note = doc.createElement('small'); note.textContent = 'Shame is playful art feedback, never personal. Candidates need artist consent and admin approval.'; root.append(note);
  timer = setInterval(refresh, 4000); refresh();
  return {refresh, dispose(){stopped = true; clearInterval(timer);}};
}
