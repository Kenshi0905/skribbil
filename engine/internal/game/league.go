package game

// Every method below runs under the existing lobby mutex. Emit must never do
// network or filesystem I/O: it only queues an immutable event for a worker.
import (
	"errors"
	"math/rand/v2"
	"sort"
	"time"

	"github.com/gofrs/uuid/v5"
)

const EventTypeLike = "like-drawing"
const EventTypeDislike = "dislike-drawing"
const EventTypeDislikeState = "dislike-state"
const EventTypeDrawingDisliked = "drawing-disliked"

type DrawingDislikeVote struct {
	VoterID    uuid.UUID `json:"voterId"`
	VoterName  string    `json:"voterName"`
	ArtistName string    `json:"artistName"`
	Votes      int       `json:"votes"`
	Required   int       `json:"required"`
	Applied    bool      `json:"applied"`
}

// Difficulty is curated and versioned, not inferred from word length.
var hardWordsV1 = []string{"time travel", "optical illusion", "photosynthesis", "continental drift", "parallel universe", "chain reaction", "metamorphosis", "gravitational wave", "ecosystem", "supply and demand", "infinite loop", "magnetic field"}

type LeagueState struct {
	Stats                 map[uuid.UUID]*LeaguePlayerStats
	WordStartedAt         time.Time
	FinalRoundNumber      int
	LastAtFinalRoundStart map[uuid.UUID]bool
	Cancelled             bool
	Roster                []*Player
	MatchID               string
	Mode                  string
	TurnID                int
	TurnUUID              string
	Sequence              int
	Eligible              map[uuid.UUID]bool
	Votes                 map[uuid.UUID]bool
	Likes                 map[uuid.UUID]bool
	Applied               bool
	HardTurn              bool
	Emit                  func(LeagueEvent) bool
	NextSessionMatchID    string
	SessionOwnerAccountID string
	SessionPlayers        map[string]RoomIdentity
}

// CancelLeagueBeforeStart is atomic with the first start event. A running match
// cannot be cancelled just because the asynchronous platform status is stale.
func (lobby *Lobby) CancelLeagueBeforeStart(matchID string) error {
	lobby.mutex.Lock()
	defer lobby.mutex.Unlock()
	if lobby.League == nil || lobby.League.MatchID != matchID {
		return errors.New("match not found")
	}
	if lobby.League.Cancelled {
		return nil
	}
	if lobby.State != Unstarted {
		return errors.New("match already started")
	}
	lobby.League.Cancelled = true
	lobby.State = GameOver
	return nil
}

// Explicit owner deletion may abandon casual play. Completed results are
// already immutable events and must still settle after the live room closes.
func (lobby *Lobby) CloseLeagueRoom(matchID string, allowStarted bool) (bool, error) {
	lobby.mutex.Lock()
	defer lobby.mutex.Unlock()
	if lobby.League == nil || lobby.League.MatchID != matchID {
		return false, errors.New("match not found")
	}
	if lobby.League.Cancelled {
		return false, nil
	}
	completed := lobby.State == GameOver
	if lobby.State != Unstarted && !completed && (!allowStarted || lobby.League.Mode != "private") {
		return false, errors.New("match already started")
	}
	lobby.League.Cancelled = true
	lobby.State = GameOver
	if lobby.timeLeftTicker != nil {
		lobby.timeLeftTicker = nil
	}
	lobby.Broadcast(&EventTypeOnly{Type: "room-session-closed"})
	return completed, nil
}

type LeagueEvent struct {
	EventID    string `json:"eventId"`
	Sequence   int    `json:"sequence"`
	Type       string `json:"type"`
	MatchID    string `json:"matchId"`
	LobbyID    string `json:"lobbyId"`
	OccurredAt string `json:"occurredAt"`
	Payload    any    `json:"payload"`
}

type DislikeState struct {
	TurnID   int         `json:"turnId"`
	Active   bool        `json:"active"`
	Votes    int         `json:"votes"`
	Likes    int         `json:"likes"`
	Likers   []uuid.UUID `json:"likers"`
	Required int         `json:"required"`
	Applied  bool        `json:"applied"`
	Eligible []uuid.UUID `json:"eligible"`
	Voters   []uuid.UUID `json:"voters"`
}

// ConfigureLeague runs before publication. Remove CreateLobby's placeholder;
// the first signed player will own the lobby.
func (lobby *Lobby) ConfigureLeague(matchID, mode string, emit func(LeagueEvent) bool) {
	lobby.League = &LeagueState{MatchID: matchID, Mode: mode, Emit: emit}
	lobby.players = nil
	lobby.OwnerID = uuid.Nil
	createdAt := time.Now()
	lobby.LastPlayerDisconnectTime = &createdAt
}

// ShouldCleanup inspects connection state under the lobby lock. Waiting managed
// rooms allow time to share invitations, including before the first connection.
func (lobby *Lobby) ShouldCleanup(now time.Time, inactivity, waitingInactivity time.Duration) bool {
	lobby.mutex.Lock()
	defer lobby.mutex.Unlock()
	if lobby.GetConnectedPlayerCount() > 0 {
		return false
	}
	if lobby.League != nil && !lobby.League.Cancelled && lobby.State == Unstarted {
		inactivity = waitingInactivity
	}
	return lobby.LastPlayerDisconnectTime == nil || now.Sub(*lobby.LastPlayerDisconnectTime) >= inactivity
}

func (lobby *Lobby) emitLeague(kind string, payload any) {
	if lobby.League == nil || lobby.League.Emit == nil {
		return
	}
	lobby.League.Sequence++
	if !lobby.League.Emit(LeagueEvent{Sequence: lobby.League.Sequence, EventID: uuid.Must(uuid.NewV4()).String(), Type: kind, MatchID: lobby.League.MatchID, LobbyID: lobby.LobbyID, OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), Payload: payload}) {
		// Never silently award ranked credit after a lost event.
		lobby.LeagueDeliveryFailed = true
	}
}

func (lobby *Lobby) beginDislikes() {
	if lobby.League == nil {
		return
	}
	ls := lobby.League
	ls.TurnID++
	ls.WordStartedAt = time.Now()
	ls.TurnUUID = uuid.Must(uuid.NewV4()).String()
	ls.Eligible = map[uuid.UUID]bool{}
	ls.Votes = map[uuid.UUID]bool{}
	ls.Likes = map[uuid.UUID]bool{}
	ls.Applied = false
	for _, p := range lobby.players {
		if p.Connected && p.State != Drawing && p.State != Spectating && !p.SpectatorOnly {
			ls.Eligible[p.ID] = true
		}
	}
	if drawer := lobby.Drawer(); drawer != nil && ls.HardTurn {
		drawer.HardWordPending = false
		lobby.emitLeague("hard-word.consumed", map[string]any{"userId": drawer.AccountID, "turnId": ls.TurnUUID, "turnNumber": ls.TurnID})
	}
	lobby.Broadcast(&Event{Type: EventTypeDislikeState, Data: lobby.dislikeState()})
}

func (lobby *Lobby) dislikeState() DislikeState {
	ls := lobby.League
	if ls == nil {
		return DislikeState{}
	}
	d := DislikeState{TurnID: ls.TurnID, Active: lobby.State == Ongoing && lobby.CurrentWord != "", Votes: len(ls.Votes), Likes: len(ls.Likes), Likers: []uuid.UUID{}, Required: len(ls.Eligible), Applied: ls.Applied, Eligible: []uuid.UUID{}, Voters: []uuid.UUID{}}
	for id := range ls.Eligible {
		d.Eligible = append(d.Eligible, id)
	}
	for id := range ls.Votes {
		d.Voters = append(d.Voters, id)
	}
	for id := range ls.Likes {
		d.Likers = append(d.Likers, id)
	}
	return d
}

// Likes are per-turn reactions. They never change scores or the dislike quorum.
func (lobby *Lobby) like(player *Player, turnID int) error {
	ls := lobby.League
	if ls == nil || lobby.State != Ongoing || lobby.CurrentWord == "" || turnID != ls.TurnID {
		return errors.New("like rejected: inactive or stale turn")
	}
	if !player.Connected || player.State == Drawing || player.State == Spectating || player.SpectatorOnly || !ls.Eligible[player.ID] {
		return errors.New("like rejected: player not eligible")
	}
	if ls.Applied || ls.Votes[player.ID] || ls.Likes[player.ID] {
		return nil
	}
	ls.Likes[player.ID] = true
	lobby.Broadcast(&Event{Type: EventTypeDislikeState, Data: lobby.dislikeState()})
	return nil
}

func (lobby *Lobby) dislike(player *Player, turnID int) error {
	ls := lobby.League
	if ls == nil || lobby.State != Ongoing || lobby.CurrentWord == "" || turnID != ls.TurnID {
		return errors.New("dislike rejected: inactive or stale turn")
	}
	if !player.Connected || player.State == Drawing || player.State == Spectating || player.SpectatorOnly || !ls.Eligible[player.ID] {
		return errors.New("dislike rejected: player not eligible")
	}
	if ls.Applied || ls.Votes[player.ID] {
		return nil
	}
	drawer := lobby.Drawer()
	if drawer == nil {
		return errors.New("no active artist")
	}
	ls.Votes[player.ID] = true
	delete(ls.Likes, player.ID)
	// Frozen membership prevents disconnect/leave from manufacturing unanimity.
	if len(ls.Eligible) > 0 && len(ls.Votes) == len(ls.Eligible) {
		ls.Applied = true
		drawer.Score -= 100 // Exact deduction; negative scores are intentional.
		drawer.HardWordPending = true
		recalculateRanks(lobby)
		lobby.Broadcast(&Event{Type: EventTypeUpdatePlayers, Data: lobby.players})
		lobby.emitLeague("drawing.penalized", map[string]any{"turnId": ls.TurnUUID, "turnNumber": ls.TurnID, "artistId": drawer.AccountID, "userId": drawer.AccountID, "delta": -100, "dislikeCount": len(ls.Votes)})
	}
	lobby.Broadcast(&Event{Type: EventTypeDrawingDisliked, Data: DrawingDislikeVote{
		VoterID: player.ID, VoterName: player.Name, ArtistName: drawer.Name,
		Votes: len(ls.Votes), Required: len(ls.Eligible), Applied: ls.Applied,
	}})
	lobby.Broadcast(&Event{Type: EventTypeDislikeState, Data: lobby.dislikeState()})
	return nil
}

func (lobby *Lobby) leagueWordChoice(drawer *Player) {
	if lobby.League == nil {
		return
	}
	lobby.League.HardTurn = drawer.HardWordPending
	if drawer.HardWordPending {
		// Native timeout selects the same forced choice. Consume only when the
		// word is chosen, so a skipped/disconnected turn cannot evade a penalty.
		lobby.wordChoice = []string{hardWordsV1[rand.IntN(len(hardWordsV1))]}
	}
}

func (lobby *Lobby) archiveLeagueTurn() {
	if lobby.League == nil || lobby.CurrentWord == "" {
		return
	}
	drawer := lobby.Drawer()
	if drawer == nil {
		return
	}
	// Accepted event objects are immutable; copy the slice before clear/undo.
	drawing := append([]any{}, lobby.currentDrawing...)
	lobby.emitLeague("turn.completed", map[string]any{"turnId": lobby.League.TurnUUID, "turnNumber": lobby.League.TurnID, "artistId": drawer.AccountID, "artistUsername": drawer.Name, "eligibleVoterIds": lobby.leagueAccountIDs(lobby.League.Eligible), "voterIds": lobby.leagueAccountIDs(lobby.League.Votes), "word": lobby.CurrentWord, "dislikeCount": len(lobby.League.Votes), "penaltyApplied": lobby.League.Applied, "drawing": drawing, "round": lobby.Round, "hardWord": lobby.League.HardTurn})
}

func (lobby *Lobby) completeLeagueMatch() {
	if lobby.League == nil {
		return
	}
	participants := []map[string]any{}
	roster := append([]*Player{}, lobby.League.Roster...)
	sort.SliceStable(roster, func(i, j int) bool { return roster[i].Score > roster[j].Score })
	rank := 0
	previousScore := 0
	for _, p := range roster {
		if p.AccountID == "" || p.SpectatorOnly {
			continue
		}
		if rank == 0 || p.Score != previousScore {
			rank++
			previousScore = p.Score
		}
		correct, fastest, comeback := lobby.leagueTelemetry(p, rank)
		participants = append(participants, map[string]any{"userId": p.AccountID, "playerId": p.ID, "username": p.Name, "score": p.Score, "rank": rank, "correctGuesses": correct, "fastestGuessMs": fastest, "comebackWin": comeback})
	}
	// Owners may edit private room rules in the original lobby. Capture the
	// configured duration (including an edit queued during the final turn) so a
	// platform rematch can reuse those settings without inspecting live state.
	drawTime := lobby.DrawingTime
	if lobby.DrawingTimeNew != 0 {
		drawTime = lobby.DrawingTimeNew
	}
	settings := map[string]int{"rounds": lobby.Rounds, "drawTime": drawTime, "maxPlayers": lobby.MaxPlayers}
	lobby.emitLeague("match.completed", map[string]any{"participants": participants, "mode": lobby.League.Mode, "rulesVersion": "skribbil-ranked-v1", "deliveryFailed": lobby.LeagueDeliveryFailed, "settings": settings})
}

func (lobby *Lobby) leagueAccountIDs(ids map[uuid.UUID]bool) []string {
	accounts := []string{}
	for _, p := range lobby.League.Roster {
		if ids[p.ID] && p.AccountID != "" {
			accounts = append(accounts, p.AccountID)
		}
	}
	return accounts
}

// RegisterLeaguePlayer retains account identity and final scores if a player is
// subsequently kicked/removed from the native active player list. Caller holds lobby mutex.
func (lobby *Lobby) RegisterLeaguePlayer(p *Player) {
	lobby.League.Roster = append(lobby.League.Roster, p)
}
