export function createRoomExit({matchId, navigate, fetch: request = globalThis.fetch} = {}) {
    let busy = false;
    return async () => {
        if (busy) return;
        busy = true;
        try {
            const response = await request(`/api/rooms/${encodeURIComponent(matchId)}/leave`, {
                method:'POST', credentials:'same-origin',
                headers:{'Content-Type':'application/json', 'X-Requested-With':'Skribbil'},
                body:'{}',
            });
            const result = await response.json();
            if (!response.ok) throw Error(result.error || 'The room could not be left. Try again.');
            navigate('/#/skribbil');
        } finally {
            busy = false;
        }
    };
}
