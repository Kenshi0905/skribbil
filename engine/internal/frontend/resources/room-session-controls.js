import { createRoomExit } from './room-exit.js';

export function createRoomSessionControls(root, {matchId, navigate, fetch: request = globalThis.fetch, origin = globalThis.location?.origin} = {}) {
    if (!root) return null;
    const actions = root.querySelector('.results-owner-actions');
    const note = root.querySelector('.results-session-note');
    const error = root.querySelector('.results-session-error');
    const retry = root.querySelector('[data-session-action="retry"]');
    const buttons = [...actions.querySelectorAll('button')];
    let isLeader = false, finished = false, busy = false, transferring = false, departing = false, next;
    const exit = createRoomExit({matchId, navigate, fetch:request});
    const post = async (path, body) => {
        const response = await request(path, {method:'POST', credentials:'same-origin',
            headers:{'Content-Type':'application/json', 'X-Requested-With':'Skribbil'}, body:JSON.stringify(body)});
        const data = await response.json();
        if (!response.ok) throw Error(data.error || 'The room request failed. Try again.');
        return data;
    };
    const fail = message => { error.textContent = message; error.hidden = false; };
    const transition = async data => {
        if (transferring || departing) return;
        if (!/^[a-f0-9-]{36}$/.test(data?.matchId || '') || !['player','spectator'].includes(data.role)) {
            fail('The next room invitation is invalid. Try again.');
            return;
        }
        next = data;
        transferring = true;
        root.hidden = false;
        actions.hidden = true;
        retry.hidden = true;
        error.hidden = true;
        note.textContent = 'Joining the next game with your room…';
        try {
            const result = await post(`/api/rooms/${encodeURIComponent(next.matchId)}/join`, {role:next.role});
            const url = new URL(result.url, origin);
            if (url.origin !== origin || url.pathname !== '/engine/league/join') throw Error('The next room invitation is invalid.');
            departing = true;
            navigate(url.pathname + url.search);
        } catch (cause) {
            fail(cause.message);
            retry.hidden = false;
            note.textContent = 'The next game is ready. Retry joining, or leave the room.';
        } finally {
            transferring = false;
        }
    };
    root.addEventListener('click', async event => {
        const button = event.target.closest('[data-session-action]');
        if (!button || !root.contains(button)) return;
        const action = button.dataset.sessionAction;
        if (action === 'leave') {
            if (busy || departing) return;
            busy = true;
            try { await exit(); departing = true; }
            catch (cause) { fail(cause.message); }
            finally { busy = false; }
            return;
        }
        if (action === 'retry') { if (next) await transition(next); return; }
        if (!isLeader || !finished || busy || next || !['rematch','close'].includes(action)) return;
        busy = true;
        buttons.forEach(button => {button.disabled = true;});
        error.hidden = true;
        note.textContent = action === 'close' ? 'Closing the room…' : 'Getting the next game ready…';
        try {
            const result = await post(`/api/rooms/${encodeURIComponent(matchId)}/session`, {action});
            if (result.closed) { departing = true; navigate('/#/skribbil'); }
            else if (result.matchId) await transition({matchId:result.matchId, role:'player'});
        } catch (cause) {
            fail(cause.message);
            note.textContent = 'Everyone can stay here while you try again.';
        } finally {
            busy = false;
            buttons.forEach(button => {button.disabled = false;});
        }
    });
    return {
        transition,
        closed() { departing = true; navigate('/#/skribbil'); },
        update(state) {
            isLeader = state.isLeader;
            finished = state.finished;
            root.hidden = !finished;
            actions.hidden = !isLeader || !!next;
            if (!busy && !next) note.textContent = isLeader
                ? 'Your room is staying together. Start another game or delete the room.'
                : `Stay for another game. Waiting for ${state.leaderName || 'the room leader'} to choose.`;
        },
    };
}
