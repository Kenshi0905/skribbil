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
	patch := httptest.NewRequest("PATCH", "/v1/lobby", nil)
	patch.SetPathValue("lobby_id", l.LobbyID)
	patch.Header.Set("Usersession", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
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
