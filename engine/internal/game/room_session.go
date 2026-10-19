package game

import (
	"errors"

	"github.com/gofrs/uuid/v5"
)

type SessionMember struct {
	AccountID string `json:"accountId"`
	Role      string `json:"role"`
}

// All session decisions use the live room leader, rather than its original creator.
func (lobby *Lobby) resultsLeaderError(matchID, accountID string) error {
	if lobby.League == nil || lobby.League.MatchID != matchID || lobby.League.Cancelled {
		return errors.New("room not found")
	}
	if lobby.State != GameOver {
		return errors.New("wait until the game ends")
	}
	for _, p := range lobby.players {
		if p.ID == lobby.OwnerID && p.AccountID == accountID && p.Connected && !p.SpectatorOnly {
			return nil
		}
	}
	return errors.New("only the connected room leader can manage the next session")
}

func (lobby *Lobby) ResultsSessionMembers(matchID, accountID string) ([]SessionMember, error) {
	lobby.mutex.Lock()
	defer lobby.mutex.Unlock()
	if err := lobby.resultsLeaderError(matchID, accountID); err != nil {
		return nil, err
	}
	members := []SessionMember{}
	for _, p := range lobby.players {
		if !p.Connected || p.AccountID == "" {
			continue
		}
		role := "player"
		if p.SpectatorOnly || p.State == Spectating {
			role = "spectator"
		}
		members = append(members, SessionMember{AccountID: p.AccountID, Role: role})
	}
	return members, nil
}

func (lobby *Lobby) CloseResultsSession(matchID, accountID string) error {
	_, err := lobby.CloseResultsAndPendingSession(matchID, accountID, nil, "")
	return err
}

func (lobby *Lobby) CloseResultsAndPendingSession(matchID, accountID string, pending *Lobby, pendingMatchID string) (bool, error) {
	lobby.mutex.Lock()
	defer lobby.mutex.Unlock()
	if err := lobby.resultsLeaderError(matchID, accountID); err != nil {
		return false, err
	}
	if lobby.League.NextSessionMatchID != "" {
		return false, errors.New("the next session has already opened")
	}
	if pending == lobby {
		return false, errors.New("invalid pending session")
	}
	// A failed replay may have reserved an empty successor. Close that too,
	// without disturbing a rematch that players already opened independently.
	closedPending := pending == nil && pendingMatchID != ""
	if pending != nil {
		pending.mutex.Lock()
		if pending.League != nil && pending.League.MatchID == pendingMatchID && pending.State == Unstarted && pending.GetConnectedPlayerCount() == 0 {
			pending.League.Cancelled = true
			pending.State = GameOver
			closedPending = true
		}
		pending.mutex.Unlock()
	}
	// Closing the live room preserves its already queued, immutable result.
	lobby.League.Cancelled = true
	lobby.Broadcast(&EventTypeOnly{Type: "room-session-closed"})
	return closedPending, nil
}

// A successor has a distinct match and lobby so previous results remain immutable.
// Locks are always acquired in source -> successor order; a successor is unstarted.
func (lobby *Lobby) TransferResultsSession(matchID, accountID string, target *Lobby, targetMatchID string, admitted map[string]string) error {
	if target == nil || target == lobby {
		return errors.New("invalid next session")
	}
	lobby.mutex.Lock()
	defer lobby.mutex.Unlock()
	if err := lobby.resultsLeaderError(matchID, accountID); err != nil {
		return err
	}
	if lobby.League.NextSessionMatchID != "" && lobby.League.NextSessionMatchID != targetMatchID {
		return errors.New("a different next session has already opened")
	}
	target.mutex.Lock()
	defer target.mutex.Unlock()
	if target.League == nil || target.League.MatchID != targetMatchID || target.League.Cancelled {
		return errors.New("next session not found")
	}
	if lobby.League.NextSessionMatchID == "" {
		if target.State != Unstarted {
			return errors.New("the next session has already started")
		}
		identities := make(map[string]RoomIdentity)
		for _, p := range lobby.players {
			if !p.Connected {
				continue
			}
			role := "player"
			if p.SpectatorOnly || p.State == Spectating {
				role = "spectator"
			}
			if admitted[p.AccountID] != role {
				return errors.New("the room roster changed; try starting again")
			}
			if role == "spectator" {
				continue
			}
			identities[p.AccountID] = RoomIdentity{DisplayName: p.Name, AvatarURL: p.AvatarURL}
		}
		if len(identities) < 2 {
			return errors.New("at least two players must stay for another game")
		}
		for _, p := range target.players {
			if p.Connected {
				return errors.New("the rematch is already open in another room")
			}
		}
		target.League.SessionOwnerAccountID = accountID
		target.League.SessionPlayers = identities
		target.OwnerID = uuid.Nil
		lobby.League.NextSessionMatchID = targetMatchID
	}
	for _, p := range lobby.players {
		if p.Connected && admitted[p.AccountID] != "" {
			lobby.sendSessionTransition(p)
		}
	}
	return nil
}

func (lobby *Lobby) sendSessionTransition(player *Player) {
	role := "player"
	if player.SpectatorOnly || player.State == Spectating {
		role = "spectator"
	}
	_ = lobby.WriteObject(player, Event{Type: "room-session-transition", Data: map[string]string{
		"matchId": lobby.League.NextSessionMatchID, "role": role,
	}})
}

// Called under the lobby lock after applying the account's trusted profile.
func (lobby *Lobby) ApplySessionIdentity(player *Player) {
	if lobby.League == nil || lobby.State != Unstarted || lobby.League.SessionPlayers == nil {
		return
	}
	if identity, ok := lobby.League.SessionPlayers[player.AccountID]; ok {
		player.Name, player.AvatarURL = identity.DisplayName, identity.AvatarURL
		player.roomIdentityOverride = true
		player.Score, player.LastScore = 0, 0
		player.State = Standby
		// Consume the carried look once. Later reconnects must keep edits made
		// in this waiting room, including "Use my profile look".
		delete(lobby.League.SessionPlayers, player.AccountID)
	}
	if player.AccountID == lobby.League.SessionOwnerAccountID {
		if lobby.OwnerID != player.ID {
			lobby.OwnerID = player.ID
			lobby.Broadcast(&Event{Type: EventTypeOwnerChange, Data: &OwnerChangeEvent{PlayerID: player.ID, PlayerName: player.Name}})
		}
		// From here the ordinary waiting-room ownership and explicit Start
		// controls apply. Arrival itself never starts another match.
		lobby.League.SessionOwnerAccountID = ""
	}
}
