import { createRoomExit } from './room-exit.js';

export function createRoomSessionControls(root, {matchId, navigate, fetch: request = globalThis.fetch, origin = globalThis.location?.origin,
    schedule = setTimeout, cancel = clearTimeout} = {}) {
    if (!root) return null;
    const actions = root.querySelector('.results-owner-actions');
    const note = root.querySelector('.results-session-note');
    const error = root.querySelector('.results-session-error');
    const retry = root.querySelector('[data-session-action="retry"]');
    const buttons = [...actions.querySelectorAll('button')];
    let isLeader = false, finished = false, busy = false, transferring = false, departing = false, next;
    let pendingResults = false, pendingTimer = null, pendingAttempts = 0, generation = 0;
    const stopWaiting = () => {
        if (pendingTimer !== null) cancel(pendingTimer);
        pendingTimer = null; pendingResults = false; pendingAttempts = 0; generation++;
    };
    const updateButtons = () => buttons.forEach(button => {
        button.disabled = busy || (pendingResults && button.dataset.sessionAction === 'rematch');
    });
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
        stopWaiting();
        transferring = true;
        root.hidden = false;
        actions.hidden = true;
        retry.hidden = true;
        error.hidden = true;
        note.textContent = 'Returning everyone to the waiting room…';
        try {
            const result = await post(`/api/rooms/${encodeURIComponent(next.matchId)}/join`, {role:next.role});
            const url = new URL(result.url, origin);
            if (url.origin !== origin || url.pathname !== '/engine/league/join') throw Error('The next room invitation is invalid.');
            departing = true;
            navigate(url.pathname + url.search);
        } catch (cause) {
            fail(cause.message);
            retry.hidden = false;
            note.textContent = 'The waiting room is ready. Retry joining, or leave the room.';
        } finally {
            transferring = false;
        }
    };
    const runLeaderAction = async action => {
        if (!isLeader || !finished || busy || next || !['rematch','close'].includes(action)) return;
        if (action === 'close') stopWaiting();
        const current = generation;
        busy = true;
        updateButtons();
        error.hidden = true;
        note.textContent = action === 'close' ? 'Closing the room…' : pendingResults
            ? 'Saving the match result… Everyone will return to the waiting room when it is ready.'
            : 'Getting the waiting room ready…';
        try {
            const result = await post(`/api/rooms/${encodeURIComponent(matchId)}/session`, {action});
            if (current !== generation || departing || !isLeader || !finished) return;
            if (result.pending) {
                pendingResults = true;
                note.textContent = 'Saving the match result… Everyone will return to the waiting room when it is ready.';
                // Back off so a slow save never consumes the session rate limit.
                const delay = Math.min(10000, 1500 * 2 ** Math.min(pendingAttempts++, 3));
                pendingTimer = schedule(() => { pendingTimer = null; return runLeaderAction('rematch'); }, delay);
                return;
            }
            stopWaiting();
            if (result.closed) { departing = true; navigate('/#/skribbil'); }
            else if (result.matchId) await transition({matchId:result.matchId, role:'player'});
        } catch (cause) {
            if (current !== generation || departing) return;
            stopWaiting();
            fail(cause.message);
            note.textContent = 'Everyone can stay here while you try again.';
        } finally {
            busy = false;
            updateButtons();
        }
    };
    root.addEventListener('click', async event => {
        const button = event.target.closest('[data-session-action]');
        if (!button || !root.contains(button)) return;
        const action = button.dataset.sessionAction;
        if (action === 'leave') {
            if (busy || departing) return;
            stopWaiting(); busy = true;
            try { await exit(); departing = true; }
            catch (cause) { fail(cause.message); }
            finally { busy = false; updateButtons(); }
            return;
        }
        if (action === 'retry') { if (next) await transition(next); return; }
        if (action === 'rematch' && pendingResults) return;
        await runLeaderAction(action);
    });
    return {
        transition,
        closed() { stopWaiting(); departing = true; navigate('/#/skribbil'); },
        update(state) {
            isLeader = state.isLeader;
            finished = state.finished;
            if (!isLeader || !finished) stopWaiting();
            root.hidden = !finished;
            actions.hidden = !isLeader || !!next;
            updateButtons();
            if (!busy && !next && !pendingResults) note.textContent = isLeader
                ? 'Return everyone to the waiting room, or delete the room.'
                : `Stay for another game. Waiting for ${state.leaderName || 'the room leader'} to choose.`;
        },
    };
}
