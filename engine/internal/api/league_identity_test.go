package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/scribble-rs/scribble.rs/internal/config"
	"github.com/scribble-rs/scribble.rs/internal/state"
)

func TestManagedCookiesAndTicketsCannotCrossPlatformAccounts(t *testing.T) {
	secret := uuid.Must(uuid.NewV4()).String()
	t.Setenv("SKRIBBIL_ENGINE_SECRET", secret)
	h := NewHandler(&config.Default)
	matchID := uuid.Must(uuid.NewV4()).String()
	create := httptest.NewRequest("POST", "/internal/rooms", strings.NewReader(`{"matchId":"`+matchID+`","mode":"private"}`))
	create.Header.Set("Authorization", "Bearer "+secret)
	created := httptest.NewRecorder()
	h.postLeagueRoom(created, create)
	if created.Code != http.StatusOK {
		t.Fatal(created.Body.String())
	}
	var room map[string]string
	_ = json.Unmarshal(created.Body.Bytes(), &room)
	lobby := state.GetLobby(room["lobbyId"])
	defer lobby.Shutdown()
	token := signTestTicket(joinTicket{UserID: "account-a", Username: "Artist", MatchID: matchID, LobbyID: lobby.LobbyID, ExpiresAt: time.Now().Add(time.Minute).Unix()}, secret)
	join := func(user, key string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/engine/league/join?ticket="+token, nil)
		r.Header.Set("X-Skribbil-User", user)
		r.Header.Set("X-Skribbil-Gateway-Key", key)
		w := httptest.NewRecorder()
		h.joinLeagueRoom(w, r)
		return w
	}
	for _, headers := range [][2]string{{"account-a", ""}, {"account-b", secret}, {"account-a", "wrong-key"}} {
		if w := join(headers[0], headers[1]); w.Code != http.StatusForbidden {
			t.Fatalf("stolen or untrusted ticket accepted: %d", w.Code)
		}
	}
	rightful := join("account-a", secret)
	if rightful.Code != http.StatusSeeOther {
		t.Fatal(rightful.Body.String())
	}
	var session string
	for _, cookie := range rightful.Result().Cookies() {
		if cookie.Name == "usersession" {
			session = cookie.Value
		}
	}
	for _, endpoint := range []struct {
		name, method string
		handle       http.HandlerFunc
	}{
		{"websocket", "GET", h.websocketUpgrade}, {"native player", "POST", h.postPlayer}, {"private settings", "PATCH", h.patchLobby},
	} {
		r := httptest.NewRequest(endpoint.method, "/engine/v1/lobby/"+lobby.LobbyID, nil)
		r.SetPathValue("lobby_id", lobby.LobbyID)
		r.AddCookie(&http.Cookie{Name: "usersession", Value: session})
		r.Header.Set("X-Skribbil-User", "account-b")
		r.Header.Set("X-Skribbil-Gateway-Key", secret)
		w := httptest.NewRecorder()
		endpoint.handle(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s accepted another account's native session: %d", endpoint.name, w.Code)
		}
	}
}
