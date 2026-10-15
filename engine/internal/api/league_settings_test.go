package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/scribble-rs/scribble.rs/internal/config"
	"github.com/scribble-rs/scribble.rs/internal/state"
)

func TestPrivateLeaderCanSaveSettingsWithZeroCustomWords(t *testing.T) {
	secret := strings.Repeat("s", 32)
	t.Setenv("SKRIBBIL_ENGINE_SECRET", secret)
	h := NewHandler(&config.Default)
	created := httptest.NewRecorder()
	create := httptest.NewRequest("POST", "/engine/internal/rooms", strings.NewReader(`{"matchId":"private-settings","mode":"private"}`))
	create.Header.Set("Authorization", "Bearer "+secret)
	h.postLeagueRoom(created, create)
	if created.Code != http.StatusOK {
		t.Fatal(created.Body.String())
	}
	var room map[string]string
	_ = json.Unmarshal(created.Body.Bytes(), &room)
	lobby := state.GetLobby(room["lobbyId"])
	t.Cleanup(func() { state.RemoveLobby(lobby.LobbyID) })
	admit := func(account string) string {
		t.Helper()
		ticket := signTestTicket(joinTicket{UserID: account, Username: account, MatchID: "private-settings", LobbyID: lobby.LobbyID, ExpiresAt: time.Now().Add(time.Minute).Unix()}, secret)
		r := httptest.NewRequest("GET", "/engine/league/join?ticket="+ticket, nil)
		r.Header.Set("X-Skribbil-User", account)
		r.Header.Set("X-Skribbil-Gateway-Key", secret)
		w := httptest.NewRecorder()
		h.joinLeagueRoom(w, r)
		if w.Code != http.StatusSeeOther {
			t.Fatal(w.Body.String())
		}
		for _, cookie := range w.Result().Cookies() {
			if cookie.Name == "usersession" {
				return cookie.Value
			}
		}
		t.Fatal("missing native session")
		return ""
	}
	owner, guest := admit("owner"), admit("guest")
	patch := func(account, session, custom string) *httptest.ResponseRecorder {
		values := url.Values{"drawing_time": {"90"}, "rounds": {"4"}, "max_players": {"12"}, "public": {"false"}, "words_per_turn": {"3"}, "custom_words_per_turn": {custom}, "clients_per_ip_limit": {"24"}}
		r := httptest.NewRequest("PATCH", "/engine/v1/lobby?"+values.Encode(), nil)
		r.SetPathValue("lobby_id", lobby.LobbyID)
		r.AddCookie(&http.Cookie{Name: "usersession", Value: session})
		r.Header.Set("X-Skribbil-User", account)
		r.Header.Set("X-Skribbil-Gateway-Key", secret)
		w := httptest.NewRecorder()
		h.patchLobby(w, r)
		return w
	}
	if w := patch("owner", owner, "0"); w.Code != http.StatusOK {
		t.Fatalf("unchanged zero custom-word setting blocked timer edit: %d %s", w.Code, w.Body.String())
	}
	if lobby.DrawingTime != 90 || lobby.Rounds != 4 || lobby.MaxPlayers != 12 || lobby.CustomWordsPerTurn != 0 {
		t.Fatal("leader settings were not applied")
	}
	if w := patch("guest", guest, "0"); w.Code != http.StatusForbidden {
		t.Fatal("guest could edit settings")
	}
	for _, custom := range []string{"-1", "4"} {
		if w := patch("owner", owner, custom); w.Code != http.StatusBadRequest {
			t.Fatalf("invalid custom-word count %s accepted", custom)
		}
	}
	lobby.League.Mode = "ranked"
	if w := patch("owner", owner, "0"); w.Code != http.StatusForbidden {
		t.Fatal("ranked settings became editable")
	}
}
