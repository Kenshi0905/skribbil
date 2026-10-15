package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/scribble-rs/scribble.rs/internal/config"
	"github.com/scribble-rs/scribble.rs/internal/game"
	"github.com/scribble-rs/scribble.rs/internal/state"
)

func TestInviteMidgamePlayerAdmission(t *testing.T) {
	for _, mode := range []string{"private", "ranked"} {
		t.Run(mode, func(t *testing.T) {
			secret := strings.Repeat("m", 32)
			t.Setenv("SKRIBBIL_ENGINE_SECRET", secret)
			t.Setenv("SKRIBBIL_RANKED_ENABLED", "true")
			h := NewHandler(&config.Default)
			matchID := "midgame-" + mode
			r := httptest.NewRequest("POST", "/internal/rooms", strings.NewReader(`{"matchId":"`+matchID+`","mode":"`+mode+`","maxPlayers":3}`))
			r.Header.Set("Authorization", "Bearer "+secret)
			w := httptest.NewRecorder()
			h.postLeagueRoom(w, r)
			if w.Code != http.StatusOK {
				t.Fatal(w.Body.String())
			}
			var room map[string]string
			_ = json.Unmarshal(w.Body.Bytes(), &room)
			lobby := state.GetLobby(room["lobbyId"])
			t.Cleanup(func() { state.RemoveLobby(lobby.LobbyID) })
			lobby.State = game.Ongoing
			lobby.MaxPlayers = 3
			admit := func(account, role string, reset bool) int {
				t.Helper()
				ticket := signTestTicket(joinTicket{UserID: account, Username: account, MatchID: matchID, LobbyID: lobby.LobbyID, Role: role, ResetScore: reset, ExpiresAt: time.Now().Add(time.Minute).Unix()}, secret)
				r := httptest.NewRequest("GET", "/league/join?ticket="+ticket, nil)
				r.Header.Set("X-Skribbil-User", account)
				r.Header.Set("X-Skribbil-Gateway-Key", secret)
				w := httptest.NewRecorder()
				h.joinLeagueRoom(w, r)
				return w.Code
			}
			if code := admit("late", "player", false); code != http.StatusSeeOther {
				t.Fatalf("late player rejected: %d", code)
			}
			p := lobby.GetPlayers()[0]
			if p.State != game.Guessing || p.SpectatorOnly || p.Score != 0 {
				t.Fatal("late invite did not join as a zero-point guesser")
			}
			p.Connected, p.Score, p.LastScore = true, 100, 25
			if admit("late", "player", false) != http.StatusSeeOther || p.Score != 100 {
				t.Fatal("opening another tab reset a connected player")
			}
			p.Connected = false
			if admit("late", "player", false) != http.StatusSeeOther || p.Score != 0 || p.LastScore != 0 || p.State != game.Guessing {
				t.Fatal("returning invite did not reset points and retain participation")
			}
			p.Connected, p.Score, p.LastScore = true, 200, 50
			if admit("late", "player", true) != http.StatusSeeOther || p.Score != 0 || p.LastScore != 0 {
				t.Fatal("explicit departure did not reset points before old socket closed")
			}
			p.State = game.Standby // Already guessed this word; do not award it twice.
			p.Connected = false
			if admit("late", "player", false) != http.StatusSeeOther || p.State != game.Standby {
				t.Fatal("returning player could guess an already revealed word again")
			}
			if admit("watcher", "spectator", false) != http.StatusSeeOther {
				t.Fatal("explicit Watch admission failed")
			}
			watcher := lobby.GetPlayers()[1]
			if !watcher.SpectatorOnly || watcher.State != game.Spectating {
				t.Fatal("explicit Watch did not remain spectator-only")
			}
			if admit("watcher", "player", false) != http.StatusSeeOther || watcher.SpectatorOnly || watcher.State != game.Standby || watcher.Score != 0 {
				t.Fatal("invite could not turn a spectator into a zero-point participant")
			}
			if len(lobby.League.Roster) != 2 || len(lobby.GetPlayers()) != 2 {
				t.Fatal("rejoining duplicated a player or result roster")
			}
			if admit("third", "player", false) != http.StatusSeeOther || admit("fourth", "player", false) != http.StatusConflict {
				t.Fatal("late joins bypassed room capacity")
			}
			if admit("extra-watcher", "spectator", false) != http.StatusSeeOther || admit("extra-watcher", "player", false) != http.StatusConflict {
				t.Fatal("spectator promotion bypassed room capacity")
			}
			lobby.State = game.GameOver
			if admit("finished-late", "player", false) != http.StatusConflict {
				t.Fatal("late player entered a finished match")
			}
		})
	}
}
