package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/scribble-rs/scribble.rs/internal/config"
	"github.com/scribble-rs/scribble.rs/internal/game"
	"github.com/scribble-rs/scribble.rs/internal/state"
)

func signTestTicket(t joinTicket, secret string) string {
	b, _ := json.Marshal(t)
	p := base64.RawURLEncoding.EncodeToString(b)
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(p))
	return p + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func TestJoinTicketRejectsForgeryExpiredAndExcessiveLifetime(t *testing.T) {
	secret := strings.Repeat("s", 32)
	now := time.Now()
	ticket := joinTicket{UserID: "user", Username: "Scribbler", MatchID: "match", LobbyID: "lobby", ExpiresAt: now.Add(time.Minute).Unix()}
	token := signTestTicket(ticket, secret)
	if _, err := verifyJoinTicket(token, secret, now); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyJoinTicket(token, strings.Repeat("x", 32), now); err == nil {
		t.Fatal("forgery accepted")
	}
	if _, err := verifyJoinTicket(token, secret, now.Add(2*time.Minute)); err == nil {
		t.Fatal("expired ticket accepted")
	}
	ticket.ExpiresAt = now.Add(time.Hour).Unix()
	if _, err := verifyJoinTicket(signTestTicket(ticket, secret), secret, now); err == nil {
		t.Fatal("long-lived ticket accepted")
	}
}

func TestJoinTicketAvatarPathsStayOnCommunityOrigin(t *testing.T) {
	secret := strings.Repeat("s", 32)
	now := time.Now()
	ticket := joinTicket{UserID: "user", Username: "Scribbler", MatchID: "match", LobbyID: "lobby", ExpiresAt: now.Add(time.Minute).Unix()}
	for _, avatar := range []string{"", "/api/avatar-presets/v1/2-0-0-0-0-1-1-0-0.svg", "/api/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"} {
		ticket.AvatarURL = avatar
		got, err := verifyJoinTicket(signTestTicket(ticket, secret), secret, now)
		if err != nil || got.AvatarURL != avatar {
			t.Fatalf("valid avatar rejected: %v", err)
		}
	}
	for _, avatar := range []string{"https://example.com/track.png", "//example.com/track.png", "data:image/svg+xml,test", "/api/media/../logout", "/api/avatar-presets/v1/2-0-0-0-0-1-1-0-0.svg?redirect=outside"} {
		ticket.AvatarURL = avatar
		if _, err := verifyJoinTicket(signTestTicket(ticket, secret), secret, now); err == nil {
			t.Fatal("unsafe avatar accepted")
		}
	}
}

func TestRankedRulesIgnoreCallerSettingsAndRequireSecret(t *testing.T) {
	secret := strings.Repeat("s", 32)
	t.Setenv("SKRIBBIL_ENGINE_SECRET", secret)
	t.Setenv("SKRIBBIL_RANKED_ENABLED", "true")
	h := NewHandler(&config.Default)
	request := httptest.NewRequest("POST", "/internal/rooms", strings.NewReader(`{"matchId":"rules-test","mode":"ranked","rounds":20,"drawTime":300,"maxPlayers":24}`))
	w := httptest.NewRecorder()
	h.postLeagueRoom(w, request)
	if w.Code != 401 {
		t.Fatal("unauthenticated create accepted")
	}
	request = httptest.NewRequest("POST", "/internal/rooms", strings.NewReader(`{"matchId":"rules-test","mode":"ranked","rounds":20,"drawTime":300,"maxPlayers":24}`))
	request.Header.Set("Authorization", "Bearer "+secret)
	w = httptest.NewRecorder()
	h.postLeagueRoom(w, request)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	l := state.GetLobby(body["lobbyId"])
	if l.Rounds != 3 || l.DrawingTime != 80 || l.MaxPlayers != 8 || l.Public || len(l.GetPlayers()) != 0 {
		t.Fatal("ranked rules changed or placeholder player remained")
	}
	ticket := signTestTicket(joinTicket{UserID: "ranked-owner", Username: "Owner", MatchID: "rules-test", LobbyID: l.LobbyID, ExpiresAt: time.Now().Add(time.Minute).Unix()}, secret)
	join := httptest.NewRequest("GET", "/engine/league/join?ticket="+ticket, nil)
	join.Header.Set("X-Skribbil-User", "ranked-owner")
	join.Header.Set("X-Skribbil-Gateway-Key", secret)
	joined := httptest.NewRecorder()
	h.joinLeagueRoom(joined, join)
	if joined.Code != 303 {
		t.Fatal(joined.Body.String())
	}
	patch := httptest.NewRequest("PATCH", "/v1/lobby", nil)
	patch.Header.Set("X-Skribbil-User", "ranked-owner")
	patch.Header.Set("X-Skribbil-Gateway-Key", secret)
	for _, cookie := range joined.Result().Cookies() {
		if cookie.Name == "usersession" {
			patch.AddCookie(cookie)
		}
	}
	patch.SetPathValue("lobby_id", l.LobbyID)
	w = httptest.NewRecorder()
	h.patchLobby(w, patch)
	if w.Code != 403 {
		t.Fatal("ranked settings mutable")
	}
}

func TestOutboxRetainsFailedDeliveryAndSignsExactBytes(t *testing.T) {
	data := []byte(`{"eventId":"retry-me"}`)
	secret := strings.Repeat("s", 32)
	accept := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m := hmac.New(sha256.New, []byte(secret))
		m.Write(data)
		actual, _ := io.ReadAll(r.Body)
		if string(actual) != string(data) || r.Header.Get("X-Skribbil-Signature") != hex.EncodeToString(m.Sum(nil)) {
			t.Error("missing signature")
		}
		if !accept {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(204)
	}))
	defer srv.Close()
	dir := t.TempDir()
	name := filepath.Join(dir, "event.json")
	if err := writeOutboxFile(name, data); err != nil {
		t.Fatal(err)
	}
	o := eventOutbox{directory: dir, url: srv.URL, secret: secret}
	o.deliverPending(srv.Client())
	if _, err := os.Stat(name); err != nil {
		t.Fatal("failed event lost")
	}
	accept = true
	o.deliverPending(srv.Client())
	if _, err := os.Stat(name); !os.IsNotExist(err) {
		t.Fatal("acknowledged event not removed")
	}
}

func TestLeagueRoomStatusRequiresControlAuthAndOnlyReportsExistence(t *testing.T) {
	secret := strings.Repeat("z", 32)
	t.Setenv("SKRIBBIL_ENGINE_SECRET", secret)
	h := NewHandler(&config.Default)
	status := func(body, auth string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/engine/internal/rooms/status", strings.NewReader(body))
		r.Header.Set("Authorization", auth)
		w := httptest.NewRecorder()
		h.statusLeagueRoom(w, r)
		return w
	}
	body := `{"matchId":"status-control-test","lobbyId":"missing-lobby"}`
	for _, auth := range []string{"", "Bearer incorrect-secret"} {
		if w := status(body, auth); w.Code != http.StatusUnauthorized {
			t.Fatalf("unauthorized status returned %d", w.Code)
		}
	}
	if w := status(body, "Bearer "+secret); w.Code != http.StatusNotFound {
		t.Fatalf("missing room returned %d", w.Code)
	}
	if w := status(`{"matchId":"status-control-test"}`, "Bearer "+secret); w.Code != http.StatusBadRequest {
		t.Fatalf("malformed request returned %d instead of 400", w.Code)
	}
	r := httptest.NewRequest("POST", "/engine/internal/rooms", strings.NewReader(`{"matchId":"status-control-test","mode":"private"}`))
	r.Header.Set("Authorization", "Bearer "+secret)
	w := httptest.NewRecorder()
	h.postLeagueRoom(w, r)
	if w.Code != http.StatusOK {
		t.Fatal(w.Body.String())
	}
	var room map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &room); err != nil {
		t.Fatal(err)
	}
	lobby := state.GetLobby(room["lobbyId"])
	defer lobby.Shutdown()
	request, _ := json.Marshal(map[string]string{"matchId": "status-control-test", "lobbyId": lobby.LobbyID})
	for _, state := range []game.State{game.Unstarted, game.Ongoing, game.GameOver} {
		lobby.Synchronized(func() { lobby.State = state })
		w := status(string(request), "Bearer "+secret)
		if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != `{"exists":true}` || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("existing room status exposed data or lost completed room: %d %s", w.Code, w.Body.String())
		}
	}
	wrongMatch, _ := json.Marshal(map[string]string{"matchId": "other-match", "lobbyId": lobby.LobbyID})
	if w := status(string(wrongMatch), "Bearer "+secret); w.Code != http.StatusNotFound {
		t.Fatalf("mismatched match returned %d", w.Code)
	}
	lobby.Synchronized(func() { lobby.League.Cancelled = true })
	if w := status(string(request), "Bearer "+secret); w.Code != http.StatusNotFound {
		t.Fatalf("cancelled room returned %d", w.Code)
	}
}
