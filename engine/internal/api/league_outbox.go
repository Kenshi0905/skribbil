package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/scribble-rs/scribble.rs/internal/game"
)

type eventOutbox struct {
	queue     chan game.LeagueEvent
	directory string
	url       string
	secret    string
}

var outboxOnce sync.Once
var outboxInstance *eventOutbox

func leagueOutbox() *eventOutbox {
	outboxOnce.Do(func() {
		dir := os.Getenv("SKRIBBIL_OUTBOX_DIR")
		if dir == "" {
			dir = ".data/engine-outbox"
		}
		outboxInstance = &eventOutbox{queue: make(chan game.LeagueEvent, 256), directory: dir, url: os.Getenv("SKRIBBIL_EVENTS_URL"), secret: os.Getenv("SKRIBBIL_ENGINE_SECRET")}
		go outboxInstance.persist()
		go outboxInstance.deliver()
	})
	return outboxInstance
}

func (o *eventOutbox) enqueue(event game.LeagueEvent) bool {
	select {
	case o.queue <- event:
		return true
	default:
		log.Printf("CRITICAL engine outbox full; match %s requires audit", event.MatchID)
		return false
	}
}

func (o *eventOutbox) persist() {
	for event := range o.queue {
		data, err := json.Marshal(event)
		if err != nil {
			log.Printf("CRITICAL cannot encode engine event %s: %v", event.EventID, err)
			continue
		}
		// Retry storage failures without blocking game goroutines. Capacity is
		// bounded; overflow explicitly invalidates automatic ranked settlement.
		for {
			if err = os.MkdirAll(o.directory, 0700); err == nil {
				name := filepath.Join(o.directory, time.Now().UTC().Format("20060102T150405.000000000")+"-"+event.EventID+".json")
				err = writeOutboxFile(name, data)
			}
			if err == nil {
				break
			}
			log.Printf("CRITICAL engine outbox storage unavailable: %v", err)
			time.Sleep(time.Second)
		}
	}
}

func writeOutboxFile(name string, data []byte) error {
	f, err := os.OpenFile(name+".tmp", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(name+".tmp", name)
}

func (o *eventOutbox) deliver() {
	client := &http.Client{Timeout: 5 * time.Second}
	for {
		if o.url != "" {
			o.deliverPending(client)
		}
		time.Sleep(2 * time.Second)
	}
}

func (o *eventOutbox) deliverPending(client *http.Client) {
	entries, err := os.ReadDir(o.directory)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		name := filepath.Join(o.directory, entry.Name())
		data, err := os.ReadFile(name)
		if err != nil {
			return
		}
		request, err := http.NewRequest(http.MethodPost, o.url, bytes.NewReader(data))
		if err != nil {
			return
		}
		mac := hmac.New(sha256.New, []byte(o.secret))
		mac.Write(data)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Skribbil-Signature", hex.EncodeToString(mac.Sum(nil)))
		response, err := client.Do(request)
		if err != nil {
			return
		}
		response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			log.Printf("engine event delivery deferred: HTTP %d", response.StatusCode)
			return
		}
		if err = os.Remove(name); err != nil {
			return
		}
	}
}
