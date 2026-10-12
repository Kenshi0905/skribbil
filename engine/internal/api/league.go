package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/scribble-rs/scribble.rs/internal/game"
	"github.com/scribble-rs/scribble.rs/internal/state"
)

var leagueCreateMutex sync.Mutex

type joinTicket struct {
	UserID          string `json:"userId"`
	Username        string `json:"username"`
	MatchID         string `json:"matchId"`
	LobbyID         string `json:"lobbyId"`
	ExpiresAt       int64  `json:"expiresAt"`
	Role            string `json:"role,omitempty"`
	HardWordPending bool   `json:"hardWordPending,omitempty"`
}

func verifyJoinTicket(token, secret string, now time.Time) (*joinTicket, error) {
	if len(secret) < 32 || len(token) > 4096 {
		return nil, errors.New("invalid ticket")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, errors.New("invalid ticket")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, errors.New("invalid signature")
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	var t joinTicket
	if json.Unmarshal(data, &t) != nil || t.ExpiresAt <= now.Unix() || t.ExpiresAt > now.Add(5*time.Minute).Unix() || t.UserID == "" || t.Username == "" || t.MatchID == "" || t.LobbyID == "" || (t.Role != "" && t.Role != "player" && t.Role != "spectator") {
		return nil, errors.New("invalid or expired ticket")
	}
	return &t, nil
}

func (handler *V1Handler) postLeagueRoom(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("SKRIBBIL_ENGINE_SECRET")
	if len(secret) < 32 || !hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+secret)) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var input struct {
		MatchID    string `json:"matchId"`
		Mode       string `json:"mode"`
		Rounds     int    `json:"rounds"`
		DrawTime   int    `json:"drawTime"`
		MaxPlayers int    `json:"maxPlayers"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || input.MatchID == "" || len(input.MatchID) > 128 || (input.Mode != "ranked" && input.Mode != "private") {
		http.Error(w, "invalid room request", 400)
		return
	}
	if input.Mode == "ranked" && os.Getenv("SKRIBBIL_RANKED_ENABLED") != "true" {
		http.Error(w, "ranked disabled pending deployment validation", 503)
		return
	}
	settings := &game.EditableLobbySettings{Rounds: 3, DrawingTime: 80, MaxPlayers: 8, WordsPerTurn: 3, CustomWordsPerTurn: 0, ClientsPerIPLimit: 24, Public: false}
	if input.Mode == "private" {
		if input.Rounds != 0 {
			settings.Rounds = input.Rounds
		}
		if input.DrawTime != 0 {
			settings.DrawingTime = input.DrawTime
		}
		if input.MaxPlayers != 0 {
			settings.MaxPlayers = input.MaxPlayers
		}
		if settings.Rounds < 1 || settings.Rounds > 20 || settings.DrawingTime < 60 || settings.DrawingTime > 300 || settings.MaxPlayers < 2 || settings.MaxPlayers > 24 {
			http.Error(w, "settings out of bounds", 400)
			return
		}
	}
	// Deterministic opaque room ID + serialized creation makes retries idempotent.
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(input.MatchID))
	lobbyID := fmt.Sprintf("league-%x", mac.Sum(nil)[:16])
	leagueCreateMutex.Lock()
	defer leagueCreateMutex.Unlock()
	if existing := state.GetLobby(lobbyID); existing != nil {
		if existing.League == nil || existing.League.Mode != input.Mode {
			http.Error(w, "match mode conflict", 409)
			return
		}
		_, _ = marshalToHTTPWriter(map[string]string{"lobbyId": lobbyID}, w)
		return
	}
	_, lobby, err := game.CreateLobby(lobbyID, "League", "english", settings, nil, game.CompetitiveScoring)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	lobby.WriteObject = WriteObject
	lobby.WritePreparedMessage = WritePreparedMessage
	lobby.ConfigureLeague(input.MatchID, input.Mode, leagueOutbox().enqueue)
	state.AddLobby(lobby)
	_, _ = marshalToHTTPWriter(map[string]string{"lobbyId": lobbyID}, w)
}

func (handler *V1Handler) joinLeagueRoom(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	ticket, err := verifyJoinTicket(r.URL.Query().Get("ticket"), os.Getenv("SKRIBBIL_ENGINE_SECRET"), time.Now())
	if err != nil {
		http.Error(w, "invalid or expired join ticket", http.StatusUnauthorized)
		return
	}
	lobby := state.GetLobby(ticket.LobbyID)
	if lobby == nil || lobby.League == nil || lobby.League.MatchID != ticket.MatchID {
		http.Error(w, "match not found", 404)
		return
	}
	success := false
	lobby.Synchronized(func() {
		var player *game.Player
		for _, p := range lobby.GetPlayers() {
			if p.AccountID == ticket.UserID {
				player = p
				break
			}
		}
		if player != nil && player.Connected {
			http.Error(w, "account already connected", 409)
			return
		}
		if player == nil {
			for _, former := range lobby.League.Roster {
				if former.AccountID == ticket.UserID {
					http.Error(w, "removed players cannot rejoin this match", http.StatusForbidden)
					return
				}
			}
			if lobby.State == game.GameOver {
				http.Error(w, "match finished", 409)
				return
			}
			spectators := 0
			for _, p := range lobby.GetPlayers() {
				if p.SpectatorOnly {
					spectators++
				}
			}
			if (ticket.Role == "spectator" && spectators >= 100) || (ticket.Role != "spectator" && !lobby.HasFreePlayerSlot()) {
				http.Error(w, "room full", 409)
				return
			}
			if lobby.League.Mode == "ranked" && lobby.State == game.Ongoing && ticket.Role != "spectator" {
				http.Error(w, "ranked match already started", 409)
				return
			}
			player = lobby.JoinPlayer(ticket.Username)
			player.AccountID = ticket.UserID
			player.HardWordPending = ticket.HardWordPending
			player.SpectatorOnly = ticket.Role == "spectator"
			lobby.RegisterLeaguePlayer(player)
			if player.SpectatorOnly {
				player.State = game.Spectating
			}
			if lobby.OwnerID == uuid.Nil && !player.SpectatorOnly {
				lobby.OwnerID = player.ID
			}
		} else if player.SpectatorOnly != (ticket.Role == "spectator") {
			http.Error(w, "role cannot change within a match", 409)
			return
		}
		player.SetLastKnownAddress(GetIPAddressFromRequest(r))
		SetGameplayCookies(w, r, player, lobby)
		success = true
	})
	if success {
		http.Redirect(w, r, "/"+path.Join(handler.cfg.RootPath, "lobby", lobby.LobbyID), http.StatusSeeOther)
	}
}

func (handler *V1Handler) cancelLeagueRoom(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("SKRIBBIL_ENGINE_SECRET")
	if len(secret) < 32 || !hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+secret)) {
		http.Error(w, "unauthorized", 401)
		return
	}
	var input struct {
		MatchID string `json:"matchId"`
		LobbyID string `json:"lobbyId"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&input) != nil {
		http.Error(w, "invalid cancellation request", 400)
		return
	}
	lobby := state.GetLobby(input.LobbyID)
	if lobby == nil || lobby.League == nil || lobby.League.MatchID != input.MatchID {
		http.Error(w, "match not found", 404)
		return
	}
	if err := lobby.CancelLeagueBeforeStart(input.MatchID); err != nil {
		http.Error(w, err.Error(), 409)
		return
	}
	lobby.Shutdown()
	_, _ = marshalToHTTPWriter(map[string]bool{"cancelled": true}, w)
}
