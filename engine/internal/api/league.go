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
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/scribble-rs/scribble.rs/internal/game"
	"github.com/scribble-rs/scribble.rs/internal/state"
)

var leagueCreateMutex sync.Mutex
var leagueAvatarPath = regexp.MustCompile(`^/api/(media/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$`)

type joinTicket struct {
	UserID          string `json:"userId"`
	Username        string `json:"username"`
	AvatarURL       string `json:"avatarUrl,omitempty"`
	MatchID         string `json:"matchId"`
	LobbyID         string `json:"lobbyId"`
	ExpiresAt       int64  `json:"expiresAt"`
	Role            string `json:"role,omitempty"`
	HardWordPending bool   `json:"hardWordPending,omitempty"`
	ResetScore      bool   `json:"resetScore,omitempty"`
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
	// Cosmetic data must never make the browser contact a third-party image host.
	if t.AvatarURL != "" && (!game.ValidPresetAvatarURL(t.AvatarURL) && !leagueAvatarPath.MatchString(t.AvatarURL)) {
		return nil, errors.New("invalid avatar path")
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

// GatewayAccountMatches binds a native engine cookie to the authenticated
// platform account. The gateway overwrites both headers on the private hop.
// Call only for managed rooms; standalone upstream lobbies remain unchanged.
func GatewayAccountMatches(r *http.Request, accountID string) bool {
	secret := os.Getenv("SKRIBBIL_ENGINE_SECRET")
	return accountID != "" && len(secret) >= 32 &&
		hmac.Equal([]byte(r.Header.Get("X-Skribbil-Gateway-Key")), []byte(secret)) &&
		hmac.Equal([]byte(r.Header.Get("X-Skribbil-User")), []byte(accountID))
}

func (handler *V1Handler) joinLeagueRoom(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	ticket, err := verifyJoinTicket(r.URL.Query().Get("ticket"), os.Getenv("SKRIBBIL_ENGINE_SECRET"), time.Now())
	if err != nil {
		http.Error(w, "invalid or expired join ticket", http.StatusUnauthorized)
		return
	}
	if !GatewayAccountMatches(r, ticket.UserID) {
		http.Error(w, "platform account does not match join ticket", http.StatusForbidden)
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
		// A fresh admission reuses the account's seat even if a suspended tab's
		// socket has not timed out yet. The next upgrade replaces that socket.
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
			player = lobby.JoinPlayer(ticket.Username)
			player.AccountID = ticket.UserID
			player.HardWordPending = ticket.HardWordPending
			player.SpectatorOnly = ticket.Role == "spectator"
			lobby.RegisterLeaguePlayer(player)
			if player.SpectatorOnly {
				player.State = game.Spectating
			}
			if lobby.OwnerID == uuid.Nil && !player.SpectatorOnly && lobby.League.SessionOwnerAccountID == "" {
				lobby.OwnerID = player.ID
			}
		} else if player.SpectatorOnly != (ticket.Role == "spectator") {
			if ticket.Role == "spectator" || lobby.State == game.GameOver {
				http.Error(w, "role cannot change within a match", 409)
				return
			}
			if !lobby.HasFreePlayerSlot() {
				http.Error(w, "room full", 409)
				return
			}
			player.SpectatorOnly = false
			// Spectators may have seen the answer. Join the drawing rotation
			// now, and start guessing when the next word is chosen.
			player.State = game.Standby
			player.Score, player.LastScore = 0, 0
			player.SpectateToggleRequested = false
		}
		if lobby.State == game.Ongoing && !player.SpectatorOnly && (!player.Connected || ticket.ResetScore) {
			// A new invite admission after leaving starts at zero. Ordinary
			// websocket reconnects do not pass through this admission handler.
			player.Score, player.LastScore = 0, 0
			player.SpectateToggleRequested = false
			if player.State == game.Spectating {
				player.State = game.Standby
			}
		}
		lobby.ApplyProfileIdentity(player, ticket.Username, ticket.AvatarURL)
		lobby.ApplySessionIdentity(player)
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
		MatchID      string `json:"matchId"`
		LobbyID      string `json:"lobbyId"`
		AllowStarted bool   `json:"allowStarted"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&input) != nil {
		http.Error(w, "invalid cancellation request", 400)
		return
	}
	// A timed-out provision may have created a deterministic room even though
	// the platform still has a pending ID. Close it without provisioning again.
	if strings.HasPrefix(input.LobbyID, "pending-") {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(input.MatchID))
		input.LobbyID = fmt.Sprintf("league-%x", mac.Sum(nil)[:16])
	}
	lobby := state.GetLobby(input.LobbyID)
	if lobby == nil || lobby.League == nil || lobby.League.MatchID != input.MatchID {
		http.Error(w, "match not found", 404)
		return
	}
	completed, err := lobby.CloseLeagueRoom(input.MatchID, input.AllowStarted)
	if err != nil {
		http.Error(w, err.Error(), 409)
		return
	}
	state.RemoveLobby(input.LobbyID)
	_, _ = marshalToHTTPWriter(map[string]bool{"cancelled": !completed, "completed": completed}, w)
}

// statusLeagueRoom gives the platform authoritative evidence that an in-memory
// room disappeared. It intentionally exposes no prompt, roster or game state.
// Finished rooms still exist while their final event is awaiting settlement.
func (handler *V1Handler) statusLeagueRoom(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	secret := os.Getenv("SKRIBBIL_ENGINE_SECRET")
	if len(secret) < 32 || !hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+secret)) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var input struct {
		MatchID string `json:"matchId"`
		LobbyID string `json:"lobbyId"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || input.MatchID == "" || len(input.MatchID) > 128 || input.LobbyID == "" || len(input.LobbyID) > 200 {
		http.Error(w, "invalid room status request", http.StatusBadRequest)
		return
	}
	lobby := state.GetLobby(input.LobbyID)
	exists := false
	if lobby != nil {
		lobby.Synchronized(func() {
			exists = lobby.League != nil && lobby.League.MatchID == input.MatchID && !lobby.League.Cancelled
		})
	}
	if !exists {
		http.Error(w, "match not found", http.StatusNotFound)
		return
	}
	_, _ = marshalToHTTPWriter(map[string]bool{"exists": true}, w)
}
