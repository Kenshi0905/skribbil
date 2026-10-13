package state

import (
	"testing"
	"time"

	"github.com/scribble-rs/scribble.rs/internal/config"
	"github.com/scribble-rs/scribble.rs/internal/game"
	"github.com/stretchr/testify/require"
)

//nolint:paralleltest //this test is very stateful
func TestAddAndRemove(t *testing.T) {
	require.Empty(t, lobbies, "Lobbies should be empty when test starts")

	createLobby := func() *game.Lobby {
		player, lobby, err := game.CreateLobby("", "player", "dutch", &game.EditableLobbySettings{
			Public:             true,
			DrawingTime:        100,
			Rounds:             10,
			MaxPlayers:         10,
			CustomWordsPerTurn: 3,
			ClientsPerIPLimit:  1,
			WordsPerTurn:       3,
		}, nil, game.ChillScoring)
		require.NoError(t, err)
		lobby.OnPlayerDisconnect(player)
		return lobby
	}
	lobbyA := createLobby()
	lobbyB := createLobby()
	lobbyC := createLobby()

	AddLobby(lobbyA)
	AddLobby(lobbyB)
	AddLobby(lobbyC)

	require.NotNil(t, GetLobby(lobbyA.LobbyID))
	require.NotNil(t, GetLobby(lobbyB.LobbyID))
	require.NotNil(t, GetLobby(lobbyC.LobbyID))

	RemoveLobby(lobbyB.LobbyID)
	require.Nil(t, GetLobby(lobbyB.LobbyID), "Lobby B should have been deleted.")

	require.NotNil(t, GetLobby(lobbyA.LobbyID), "Lobby A shouldn't have been deleted.")
	require.NotNil(t, GetLobby(lobbyC.LobbyID), "Lobby C shouldn't have been deleted.")
	require.Len(t, lobbies, 2)

	cleanupRoutineLogic(&config.LobbyCleanup{})
	require.Empty(t, lobbies)
}

func TestWaitingManagedRoomSurvivesInvitationBreak(t *testing.T) {
	_, lobby, err := game.CreateLobby("", "owner", "english", &game.EditableLobbySettings{
		DrawingTime: 60, Rounds: 1, MaxPlayers: 2, WordsPerTurn: 3,
	}, nil, game.CompetitiveScoring)
	require.NoError(t, err)
	lobby.ConfigureLeague("invitation-break", "private", nil)
	AddLobby(lobby)
	t.Cleanup(func() { RemoveLobby(lobby.LobbyID) })
	cfg := config.Default.LobbyCleanup

	// Creation with no socket must not be deleted by the first cleanup tick.
	cleanupRoutineLogic(&cfg)
	require.Same(t, lobby, GetLobby(lobby.LobbyID))

	owner := lobby.JoinPlayer("owner")
	owner.AccountID = "owner"
	lobby.RegisterLeaguePlayer(owner)
	age := time.Now().Add(-5 * time.Minute)
	lobby.LastPlayerDisconnectTime = &age
	cleanupRoutineLogic(&cfg)
	require.Same(t, lobby, GetLobby(lobby.LobbyID), "sharing an invitation must preserve the waiting room")
	owner.Connected = true
	require.False(t, lobby.ShouldCleanup(time.Now().Add(time.Hour), cfg.PlayerInactivityThreshold, cfg.ManagedWaitingInactivityThreshold), "connected rooms must stay open")
	owner.Connected = false
	for _, status := range []game.State{game.Ongoing, game.GameOver} {
		lobby.State = status
		require.True(t, lobby.ShouldCleanup(time.Now(), cfg.PlayerInactivityThreshold, cfg.ManagedWaitingInactivityThreshold), "started rooms retain the original cleanup threshold")
	}
	lobby.State = game.Unstarted

	// Abandoned rooms still have a bounded lifetime.
	age = time.Now().Add(-31 * time.Minute)
	cleanupRoutineLogic(&cfg)
	require.Nil(t, GetLobby(lobby.LobbyID))
}
