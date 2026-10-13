package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lxzan/gws"
	"github.com/scribble-rs/scribble.rs/internal/config"
	"github.com/scribble-rs/scribble.rs/internal/game"
	"github.com/scribble-rs/scribble.rs/internal/state"
)

type testSocketEvents struct {
	gws.BuiltinEventHandler
	events chan map[string]any
}

func TestRoomCreatorRejoinsWhilePreviousSocketIsStillConnected(t *testing.T) {
	secret := strings.Repeat("r", 32)
	t.Setenv("SKRIBBIL_ENGINE_SECRET", secret)
	cfg := config.Default
	cfg.RootPath = "engine"
	handler := NewHandler(&cfg)
	create := httptest.NewRequest("POST", "/engine/internal/rooms", strings.NewReader(`{"matchId":"owner-reconnect","mode":"private","rounds":1,"drawTime":60,"maxPlayers":2}`))
	create.Header.Set("Authorization", "Bearer "+secret)
	created := httptest.NewRecorder()
	handler.postLeagueRoom(created, create)
	if created.Code != http.StatusOK {
		t.Fatal(created.Body.String())
	}
	var room map[string]string
	_ = json.Unmarshal(created.Body.Bytes(), &room)
	lobby := state.GetLobby(room["lobbyId"])
	t.Cleanup(func() { state.RemoveLobby(lobby.LobbyID) })
	mux := http.NewServeMux()
	mux.HandleFunc("GET /engine/v1/lobby/{lobby_id}/ws", handler.websocketUpgrade)
	server := httptest.NewServer(mux)
	defer server.Close()
	ticket := signTestTicket(joinTicket{UserID: "owner-account", Username: "Owner", MatchID: "owner-reconnect", LobbyID: lobby.LobbyID, ExpiresAt: time.Now().Add(time.Minute).Unix()}, secret)
	admit := func() string {
		t.Helper()
		r := httptest.NewRequest("GET", "/engine/league/join?ticket="+ticket, nil)
		r.Header.Set("X-Skribbil-User", "owner-account")
		r.Header.Set("X-Skribbil-Gateway-Key", secret)
		w := httptest.NewRecorder()
		handler.joinLeagueRoom(w, r)
		if w.Code != http.StatusSeeOther {
			t.Fatalf("creator cannot rejoin: %d %s", w.Code, w.Body.String())
		}
		for _, c := range w.Result().Cookies() {
			if c.Name == "usersession" {
				return c.Name + "=" + c.Value
			}
		}
		t.Fatal("missing gameplay session")
		return ""
	}
	connect := func(cookie string) (*gws.Conn, map[string]any) {
		t.Helper()
		events := &testSocketEvents{events: make(chan map[string]any, 100)}
		client, _, err := gws.NewClient(events, &gws.ClientOption{
			Addr:          strings.Replace(server.URL, "http://", "ws://", 1) + "/engine/v1/lobby/" + lobby.LobbyID + "/ws",
			RequestHeader: http.Header{"Cookie": {cookie}, "Origin": {server.URL}, "X-Skribbil-User": {"owner-account"}, "X-Skribbil-Gateway-Key": {secret}},
		})
		if err != nil {
			t.Fatal(err)
		}
		go client.ReadLoop()
		t.Cleanup(func() { _ = client.WriteClose(1000, nil) })
		return client, waitSocketEvent(t, events, "ready")["data"].(map[string]any)
	}
	cookie := admit()
	_, first := connect(cookie)
	var player *game.Player
	var previous *gws.Conn
	lobby.Synchronized(func() {
		player = lobby.GetPlayers()[0]
		previous = player.GetWebsocket()
		player.Score = 42
		player.HardWordPending = true
	})
	if next := admit(); next != cookie {
		t.Fatal("rejoin replaced the player's identity")
	}
	_, second := connect(cookie)
	if first["playerId"] != second["playerId"] || first["ownerId"] != second["ownerId"] {
		t.Fatal("reconnect changed the owner's seat")
	}
	// Delayed callbacks and queued packets from the old connection are harmless.
	lobby.OnSocketDisconnect(player, previous)
	if err := lobby.HandleSocketEvent(game.EventTypeToggleReadiness, []byte(`{"type":"toggle-readiness"}`), player, previous); err != nil {
		t.Fatal(err)
	}
	var current *gws.Conn
	lobby.Synchronized(func() {
		current = player.GetWebsocket()
		if !player.Connected || current == previous || len(lobby.GetPlayers()) != 1 || len(lobby.League.Roster) != 1 || player.Score != 42 || !player.HardWordPending || player.State != game.Standby {
			t.Error("replacement lost player state or duplicated the roster")
		}
	})
	// A fully disconnected player can return using the same seat as well.
	lobby.OnSocketDisconnect(player, current)
	_ = current.WriteClose(1000, nil)
	_, third := connect(admit())
	if third["playerId"] != first["playerId"] || third["ownerId"] != first["ownerId"] {
		t.Fatal("disconnected creator lost ownership")
	}
}

func (h *testSocketEvents) OnMessage(_ *gws.Conn, m *gws.Message) {
	defer m.Close()
	var e map[string]any
	if json.Unmarshal(m.Bytes(), &e) == nil {
		h.events <- e
	}
}

func waitSocketEvent(t *testing.T, h *testSocketEvents, kind string) map[string]any {
	t.Helper()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for {
		select {
		case e := <-h.events:
			if e["type"] == kind {
				return e
			}
		case <-timer.C:
			t.Fatalf("timeout waiting for websocket event %s", kind)
			return nil
		}
	}
}

func TestOriginalWebsocketDrawingGuessingAndLeaguePenaltyTogether(t *testing.T) {
	secret := strings.Repeat("n", 32)
	t.Setenv("SKRIBBIL_ENGINE_SECRET", secret)
	cfg := config.Default
	cfg.RootPath = "engine"
	handler := NewHandler(&cfg)
	create := httptest.NewRequest("POST", "/engine/internal/rooms", strings.NewReader(`{"matchId":"network-smoke","mode":"private","rounds":1,"drawTime":60,"maxPlayers":2}`))
	create.Header.Set("Authorization", "Bearer "+secret)
	result := httptest.NewRecorder()
	handler.postLeagueRoom(result, create)
	if result.Code != 200 {
		t.Fatal(result.Body.String())
	}
	var room map[string]string
	_ = json.Unmarshal(result.Body.Bytes(), &room)
	lobby := state.GetLobby(room["lobbyId"])
	defer lobby.Shutdown()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /engine/v1/lobby/{lobby_id}/ws", handler.websocketUpgrade)
	server := httptest.NewServer(mux)
	defer server.Close()
	clients := make([]*gws.Conn, 2)
	handlers := make([]*testSocketEvents, 2)
	for i, name := range []string{"Artist", "Guesser"} {
		ticket := signTestTicket(joinTicket{UserID: name, Username: name, MatchID: "network-smoke", LobbyID: room["lobbyId"], ExpiresAt: time.Now().Add(time.Minute).Unix()}, secret)
		join := httptest.NewRequest("GET", "/engine/league/join?ticket="+ticket, nil)
		join.Header.Set("X-Skribbil-User", name)
		join.Header.Set("X-Skribbil-Gateway-Key", secret)
		joined := httptest.NewRecorder()
		handler.joinLeagueRoom(joined, join)
		if joined.Code != 303 {
			t.Fatal(joined.Body.String())
		}
		cookie := ""
		for _, c := range joined.Result().Cookies() {
			if c.Name == "usersession" {
				cookie = c.Name + "=" + c.Value
			}
		}
		h := &testSocketEvents{events: make(chan map[string]any, 100)}
		handlers[i] = h
		client, _, err := gws.NewClient(h, &gws.ClientOption{Addr: strings.Replace(server.URL, "http://", "ws://", 1) + "/engine/v1/lobby/" + room["lobbyId"] + "/ws", RequestHeader: http.Header{"Cookie": []string{cookie}, "Origin": []string{server.URL}, "X-Skribbil-User": []string{name}, "X-Skribbil-Gateway-Key": []string{secret}}})
		if err != nil {
			t.Fatal(err)
		}
		clients[i] = client
		go client.ReadLoop()
		defer client.WriteClose(1000, nil)
		waitSocketEvent(t, h, "ready")
	}
	send := func(i int, payload string) {
		t.Helper()
		if err := clients[i].WriteMessage(gws.OpcodeText, []byte(payload)); err != nil {
			t.Fatal(err)
		}
	}
	send(0, `{"type":"start"}`)
	choice := waitSocketEvent(t, handlers[0], "your-turn")["data"].(map[string]any)["words"].([]any)[0].(string)
	send(0, `{"type":"choose-word","data":0}`)
	waitSocketEvent(t, handlers[1], "word-chosen")
	send(0, `{"type":"line","data":{"x":10,"y":10,"x2":20,"y2":20,"color":2,"width":8}}`)
	line := waitSocketEvent(t, handlers[1], "line")
	if line["data"].(map[string]any)["x2"] != float64(20) {
		t.Fatal("native drawing transport changed")
	}
	send(1, `{"type":"dislike-drawing","data":{"turnId":1}}`)
	penalty := waitSocketEvent(t, handlers[1], "dislike-state")["data"].(map[string]any)
	if penalty["applied"] != true {
		t.Fatal("unanimous websocket penalty missing")
	}
	lobby.Synchronized(func() {
		if lobby.GetPlayers()[0].Score != -100 {
			t.Error("network penalty not exactly -100")
		}
	})
	guess, _ := json.Marshal(map[string]string{"type": "message", "data": choice})
	send(1, string(guess))
	waitSocketEvent(t, handlers[1], "correct-guess-self")
	waitSocketEvent(t, handlers[1], "your-turn")
	lobby.Synchronized(func() {
		if lobby.Round != 1 || lobby.GetPlayers()[1].Score <= 0 {
			t.Error("original correct guess/turn advance failed")
		}
	})
}
