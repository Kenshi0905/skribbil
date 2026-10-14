package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/scribble-rs/scribble.rs/internal/state"
)

func (handler *V1Handler) controlResultsSession(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("SKRIBBIL_ENGINE_SECRET")
	if len(secret) < 32 || !hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+secret)) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var input struct {
		Action        string            `json:"action"`
		MatchID       string            `json:"matchId"`
		LobbyID       string            `json:"lobbyId"`
		AccountID     string            `json:"accountId"`
		TargetMatchID string            `json:"targetMatchId"`
		TargetLobbyID string            `json:"targetLobbyId"`
		Admitted      map[string]string `json:"admitted"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || input.MatchID == "" || input.AccountID == "" {
		http.Error(w, "invalid room session request", 400)
		return
	}
	lobby := state.GetLobby(input.LobbyID)
	if lobby == nil {
		http.Error(w, "room not found", 404)
		return
	}
	switch input.Action {
	case "inspect":
		members, err := lobby.ResultsSessionMembers(input.MatchID, input.AccountID)
		if err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		_, _ = marshalToHTTPWriter(map[string]any{"members": members}, w)
	case "close":
		if strings.HasPrefix(input.TargetLobbyID, "pending-") && input.TargetMatchID != "" {
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write([]byte(input.TargetMatchID))
			input.TargetLobbyID = fmt.Sprintf("league-%x", mac.Sum(nil)[:16])
		}
		target := state.GetLobby(input.TargetLobbyID)
		closedPending, err := lobby.CloseResultsAndPendingSession(input.MatchID, input.AccountID, target, input.TargetMatchID)
		if err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		state.RemoveLobby(input.LobbyID)
		if closedPending && target != nil {
			state.RemoveLobby(target.LobbyID)
		}
		_, _ = marshalToHTTPWriter(map[string]bool{"closed": true, "closedPending": closedPending}, w)
	case "transfer":
		if err := lobby.TransferResultsSession(input.MatchID, input.AccountID, state.GetLobby(input.TargetLobbyID), input.TargetMatchID, input.Admitted); err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		_, _ = marshalToHTTPWriter(map[string]bool{"transferred": true}, w)
	default:
		http.Error(w, "invalid room session action", 400)
	}
}
