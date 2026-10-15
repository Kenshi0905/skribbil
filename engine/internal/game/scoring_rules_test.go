package game

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestCompetitiveGuesserRewardDeclinesWithTimeLeft(t *testing.T) {
	for _, duration := range []int{60, 80, 120, 300} {
		t.Run(fmt.Sprintf("%d-seconds", duration), func(t *testing.T) {
			l := &Lobby{EditableLobbySettings: EditableLobbySettings{DrawingTime: duration}, ScoreCalculation: CompetitiveScoring}
			previous := CompetitiveScoring.MaxScore() + 1
			for _, remaining := range []int{duration, duration * 3 / 4, duration / 2, duration / 4, 1} {
				l.roundEndTime = time.Now().Add(time.Duration(remaining) * time.Second).UnixMilli()
				score := l.calculateGuesserScore()
				if score <= 0 || score >= previous {
					t.Fatalf("%d seconds left: got %d, expected positive points below earlier reward %d", remaining, score, previous)
				}
				previous = score
			}
		})
	}
}

func TestCompetitiveDrawerRewardReflectsSuccessfulGuessCountAndSpeed(t *testing.T) {
	for _, tc := range []struct {
		name   string
		scores [3]int
		want   int
	}{
		{"nobody guessed", [3]int{0, 0, 0}, 0},
		{"one of three guessed", [3]int{300, 0, 0}, 100},
		{"two of three guessed", [3]int{300, 300, 0}, 200},
		{"everyone guessed quickly", [3]int{300, 300, 300}, 300},
		{"everyone guessed slowly", [3]int{150, 150, 150}, 150},
	} {
		t.Run(tc.name, func(t *testing.T) {
			l := &Lobby{ScoreCalculation: CompetitiveScoring, players: []*Player{
				{State: Drawing, Connected: true, LastScore: 9000},
				{State: Spectating, SpectatorOnly: true, Connected: true, LastScore: 9000},
			}}
			for _, score := range tc.scores {
				state := Guessing
				if score > 0 {
					state = Standby
				}
				l.players = append(l.players, &Player{State: state, Connected: true, LastScore: score})
			}
			if got := l.calculateDrawerScore(); got != tc.want {
				t.Fatalf("drawer reward = %d, want %d; drawer and spectator must not affect the average", got, tc.want)
			}
		})
	}
}

func TestManagedTurnAwardsTimeBasedGuessesAndCreditsDrawerOnce(t *testing.T) {
	l, artist, early, spectator := roomFixture(t, true)
	late := l.JoinPlayer("Late guesser")
	late.Connected, late.AccountID, late.State = true, "late-guesser", Ready
	l.RegisterLeaguePlayer(late)
	early.State = Ready
	if err := l.HandleEvent(EventTypeStart, nil, artist); err != nil {
		t.Fatal(err)
	}
	l.Synchronized(func() {
		l.wordChoice = []string{"canvas"}
		if err := l.selectWord(0); err != nil {
			t.Fatal(err)
		}
		l.roundEndTime = time.Now().Add(55 * time.Second).UnixMilli()
	})
	guess := func(player *Player, word string) error {
		payload, _ := json.Marshal(Event{Type: EventTypeMessage, Data: word})
		return l.HandleEvent(EventTypeMessage, payload, player)
	}
	if err := guess(early, "wrong answer"); err != nil {
		t.Fatal(err)
	}
	l.Synchronized(func() {
		if early.Score != 0 {
			t.Fatal("incorrect guess earned points")
		}
	})
	if err := guess(early, "canvas"); err != nil {
		t.Fatal(err)
	}
	var firstReward int
	l.Synchronized(func() { firstReward = early.Score })
	if err := guess(early, "canvas"); err != nil {
		t.Fatal(err)
	}
	if err := guess(spectator, "canvas"); err == nil {
		t.Fatal("spectator guess was accepted")
	}
	l.Synchronized(func() { l.roundEndTime = time.Now().Add(5 * time.Second).UnixMilli() })
	if err := guess(late, "canvas"); err != nil {
		t.Fatal(err)
	}
	l.Synchronized(func() {
		if firstReward <= late.Score || late.Score <= 0 {
			t.Fatalf("early reward %d must exceed late reward %d", firstReward, late.Score)
		}
		if early.Score != firstReward || spectator.Score != 0 {
			t.Fatal("duplicate or spectator guess earned points")
		}
		if want := (early.Score + late.Score) / 2; artist.Score != want || artist.LastScore != want {
			t.Fatalf("drawer earned %d, want %d at turn end", artist.Score, want)
		}
	})
}
