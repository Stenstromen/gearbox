//go:build darwin

package main

import (
	"context"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stenstromen/gearbox/config"
)

func TestNormalizeEndpoint(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{in: "", wantErr: true},
		{in: "not a url", wantErr: true},
		{in: "ftp://example.com/rpc", wantErr: true},
		{in: "http://127.0.0.1:9091", want: "http://127.0.0.1:9091/transmission/rpc"},
		{in: "http://127.0.0.1:9091/", want: "http://127.0.0.1:9091/transmission/rpc"},
		{in: "https://daemon.example/custom/rpc", want: "https://daemon.example/custom/rpc"},
		{in: " https://daemon.example/transmission/rpc/ ", want: "https://daemon.example/transmission/rpc"},
	}
	for _, test := range tests {
		got, err := normalizeEndpoint(test.in)
		if test.wantErr {
			if err == nil {
				t.Fatalf("normalizeEndpoint(%q) expected an error", test.in)
			}
			continue
		}
		if err != nil {
			t.Fatalf("normalizeEndpoint(%q): %v", test.in, err)
		}
		if got != test.want {
			t.Fatalf("normalizeEndpoint(%q) = %q, want %q", test.in, got, test.want)
		}
	}
}

func TestNewClientFromEnvRequiresURL(t *testing.T) {
	t.Setenv(envURL, "")
	t.Setenv(envUsername, "user")
	t.Setenv(envPassword, "secret")
	if _, err := NewClientFromEnv(); err == nil {
		t.Fatal("expected missing TRANSMISSION_URL to fail")
	}
}

func TestListTorrents(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/transmission/rpc" {
			t.Errorf("path = %s", r.URL.Path)
		}
		user, pass, ok := r.BasicAuth()
		if !ok || user != "user" || pass != "secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"method":"torrent-get"`) || !strings.Contains(string(body), `"uploadRatio"`) || !strings.Contains(string(body), `"isFinished"`) {
			t.Errorf("body = %s", body)
		}
		if r.Header.Get("X-Transmission-Session-Id") != "session" {
			w.Header().Set("X-Transmission-Session-Id", "session")
			w.WriteHeader(http.StatusConflict)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"arguments": {
				"torrents": [
					{"id":2,"name":"Beta","percentDone":1,"peersConnected":0,"rateDownload":0,"rateUpload":10,"status":6,"isFinished":false,"totalSize":100,"errorString":"","uploadRatio":2.5},
					{"id":3,"name":"Complete","percentDone":1,"peersConnected":0,"rateDownload":0,"rateUpload":0,"status":0,"isFinished":true,"totalSize":100,"errorString":"","uploadRatio":2},
					{"id":4,"name":"Paused","percentDone":0.2,"peersConnected":0,"rateDownload":0,"rateUpload":0,"status":0,"isFinished":false,"totalSize":100,"errorString":"","uploadRatio":0},
					{"id":1,"name":"Alpha","percentDone":0.5,"peersConnected":3,"rateDownload":2048,"rateUpload":512,"status":4,"isFinished":false,"totalSize":4096,"errorString":"tracker down","uploadRatio":0.25}
				]
			},
			"result": "success"
		}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "user", "secret")
	if err != nil {
		t.Fatal(err)
	}
	torrents, err := client.ListTorrents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2 (session retry)", calls)
	}
	if len(torrents) != 4 {
		t.Fatalf("len = %d", len(torrents))
	}
	if torrents[0].Name != "Alpha" || torrents[0].Status != "Downloading" || torrents[0].PeersConnected != 3 {
		t.Fatalf("first torrent = %+v", torrents[0])
	}
	if torrents[0].Error != "tracker down" || torrents[0].RateDownload != 2048 || torrents[0].UploadRatio != 0.25 {
		t.Fatalf("first torrent rates/error = %+v", torrents[0])
	}
	if torrents[1].Name != "Beta" || torrents[1].Status != "Seeding" || torrents[1].PercentDone != 1 {
		t.Fatalf("second torrent = %+v", torrents[1])
	}
	if torrents[2].Name != "Complete" || torrents[2].Status != "Seeding complete" {
		t.Fatalf("finished torrent = %+v", torrents[2])
	}
	if torrents[3].Name != "Paused" || torrents[3].Status != "Stopped" {
		t.Fatalf("stopped torrent = %+v", torrents[3])
	}
}

func TestGetTorrent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		text := string(body)
		if !strings.Contains(text, `"ids":[7]`) || !strings.Contains(text, `"availability"`) || !strings.Contains(text, `"magnetLink"`) || !strings.Contains(text, `"peers"`) || !strings.Contains(text, `"trackerStats"`) || !strings.Contains(text, `"files"`) || !strings.Contains(text, `"fileStats"`) || !strings.Contains(text, `"isFinished"`) {
			t.Errorf("body = %s", text)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"arguments": {
				"torrents": [{
					"id": 7,
					"name": "Gamma",
					"status": 6,
					"errorString": "",
					"percentDone": 1,
					"haveValid": 3000,
					"haveUnchecked": 24,
					"availability": [1, 0, 2, 0],
					"uploadedEver": 9000,
					"uploadRatio": 3,
					"downloadedEver": 3000,
					"secondsDownloading": 120,
					"secondsSeeding": 30,
					"eta": -1,
					"activityDate": 1700000000,
					"totalSize": 4096,
					"pieceCount": 4,
					"pieceSize": 1024,
					"downloadDir": "/downloads",
					"hashString": "abc123",
					"addedDate": 1600000000,
					"magnetLink": "magnet:?xt=urn:btih:abc123",
					"peers": [
						{"address":"10.0.0.8","port":51413,"clientName":"Transmission 4.0","flagStr":"DEI","isEncrypted":true,"progress":0.5,"rateToClient":2048,"rateToPeer":512},
						{"address":"2001:db8::1","port":6881,"clientName":"qBittorrent 4.6","flagStr":"U","isEncrypted":false,"progress":1,"rateToClient":0,"rateToPeer":0}
					],
					"trackerStats": [
						{"announce":"https://backup.example/announce","tier":1,"hasAnnounced":true,"lastAnnounceSucceeded":false,"lastAnnounceResult":"Could not connect to tracker","lastAnnounceTime":1700000000,"seederCount":-1,"leecherCount":-1,"downloadCount":-1},
						{"announce":"udp://tracker.example:1337","tier":0,"hasAnnounced":true,"lastAnnounceSucceeded":true,"lastAnnounceResult":"Success","lastAnnouncePeerCount":80,"lastAnnounceTime":1700000000,"nextAnnounceTime":1700000600,"hasScraped":true,"lastScrapeSucceeded":true,"lastScrapeTime":1700000100,"seederCount":233,"leecherCount":103,"downloadCount":524}
					],
					"files": [
						{"name":"Movie/video.mkv","length":4000,"bytesCompleted":1000},
						{"name":"Movie/subs/en.srt","length":100,"bytesCompleted":0},
						{"name":"readme.txt","length":20,"bytesCompleted":20}
					],
					"fileStats": [
						{"bytesCompleted":2000},
						{"bytesCompleted":100},
						{"bytesCompleted":20}
					]
				}]
			},
			"result": "success"
		}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/transmission/rpc", "", "")
	if err != nil {
		t.Fatal(err)
	}
	info, err := client.GetTorrent(context.Background(), 7)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "Gamma" || info.Status != "Seeding" || info.Have != 3024 {
		t.Fatalf("info = %+v", info)
	}
	if math.Abs(info.Availability-0.5) > 1e-9 {
		t.Fatalf("availability = %v", info.Availability)
	}
	if info.SecondsActive != 150 || info.ETA != -1 || info.PieceCount != 4 || info.DownloadDir != "/downloads" {
		t.Fatalf("info = %+v", info)
	}
	if info.HashString != "abc123" || info.MagnetLink != "magnet:?xt=urn:btih:abc123" || info.UploadRatio != 3 {
		t.Fatalf("info = %+v", info)
	}
	if len(info.Peers) != 2 {
		t.Fatalf("peers = %+v", info.Peers)
	}
	if !info.Peers[0].Encrypted || info.Peers[0].Address != "10.0.0.8:51413" || info.Peers[0].FlagStr != "DEI" || info.Peers[0].RateToClient != 2048 || info.Peers[0].ClientName != "Transmission 4.0" {
		t.Fatalf("first peer = %+v", info.Peers[0])
	}
	if info.Peers[1].Encrypted || info.Peers[1].Address != "[2001:db8::1]:6881" || info.Peers[1].Progress != 1 {
		t.Fatalf("second peer = %+v", info.Peers[1])
	}
	if len(info.Trackers) != 2 || info.Trackers[0].Announce != "udp://tracker.example:1337" || info.Trackers[0].Tier != 0 || info.Trackers[0].SeederCount != 233 {
		t.Fatalf("trackers = %+v", info.Trackers)
	}
	if info.Trackers[1].LastAnnounceSucceeded || info.Trackers[1].DownloadCount != -1 {
		t.Fatalf("second tracker = %+v", info.Trackers[1])
	}
	if len(info.Files) != 3 || info.Files[0].Name != "Movie/video.mkv" || info.Files[0].Size != 4000 || info.Files[0].Have != 2000 {
		t.Fatalf("files = %+v", info.Files)
	}
	if info.Files[1].Have != 100 || info.Files[2].Name != "readme.txt" || info.Files[2].Have != 20 {
		t.Fatalf("files = %+v", info.Files)
	}
}

func TestSetSortPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	store, err := config.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(config.Preferences{
		URL:            "http://127.0.0.1:9091/transmission/rpc",
		Username:       "me",
		RefreshSeconds: 9,
		Sort:           "name",
	}); err != nil {
		t.Fatal(err)
	}
	service := &TransmissionService{store: store}
	if err := service.SetSort("ratio"); err != nil {
		t.Fatal(err)
	}
	prefs, err := store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.Sort != "ratio" || prefs.URL != "http://127.0.0.1:9091/transmission/rpc" || prefs.Username != "me" || prefs.RefreshSeconds != 9 {
		t.Fatalf("prefs = %+v", prefs)
	}
	if err := service.SetSort("nope"); err == nil {
		t.Fatal("expected unknown sort to be rejected")
	}
	prefs, err = store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.Sort != "ratio" {
		t.Fatalf("sort = %q", prefs.Sort)
	}
	if err := service.SetSort("-size"); err != nil {
		t.Fatal(err)
	}
	prefs, err = store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.Sort != "-size" {
		t.Fatalf("sort = %q", prefs.Sort)
	}
	if err := service.SetSort("-nope"); err == nil {
		t.Fatal("expected unknown reversed sort to be rejected")
	}
}

func TestSwarmAvailability(t *testing.T) {
	tests := []struct {
		name   string
		pieces []float64
		want   float64
	}{
		{name: "unknown", pieces: nil, want: -1},
		{name: "peer has every piece", pieces: []float64{1, 3, 1, 2}, want: 1},
		{name: "we have every piece", pieces: []float64{-1, -1, -1, -1}, want: 1},
		{name: "seed fills what we already have", pieces: []float64{-1, -1, -1, 1}, want: 1},
		{name: "half the pieces", pieces: []float64{1, 0, 2, 0}, want: 0.5},
		{name: "only our pieces", pieces: []float64{-1, -1, 0, 0}, want: 0.5},
		{name: "nobody", pieces: []float64{0, 0, 0, 0}, want: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := swarmAvailability(test.pieces)
			if math.Abs(got-test.want) > 1e-9 {
				t.Fatalf("availability = %v, want %v", got, test.want)
			}
		})
	}
}

func TestGetTorrentNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"arguments":{"torrents":[]},"result":"success"}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/transmission/rpc", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetTorrent(context.Background(), 4); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("error = %v", err)
	}
}

func TestListTorrentsRPCError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"result":"no such method"}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/transmission/rpc", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.ListTorrents(context.Background()); err == nil || !strings.Contains(err.Error(), "no such method") {
		t.Fatalf("error = %v", err)
	}
}

func TestListTorrentsUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/transmission/rpc", "user", "wrong")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.ListTorrents(context.Background()); err == nil || !strings.Contains(err.Error(), "authentication") {
		t.Fatalf("error = %v", err)
	}
}

func TestDownloadLocationUsesSessionDefault(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		text := string(body)
		calls = append(calls, text)
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(text, `"session-get"`) {
			_, _ = io.WriteString(w, `{"arguments":{"download-dir":"/downloads/complete"},"result":"success"}`)
			return
		}
		_, _ = io.WriteString(w, `{"arguments":{"path":"/downloads/complete","size-bytes":158000000000},"result":"success"}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/transmission/rpc", "", "")
	if err != nil {
		t.Fatal(err)
	}
	location, err := client.DownloadLocation(context.Background(), "  ")
	if err != nil {
		t.Fatal(err)
	}
	if location.Path != "/downloads/complete" || location.FreeBytes != 158000000000 {
		t.Fatalf("location = %+v", location)
	}
	if len(calls) != 2 || !strings.Contains(calls[0], `"download-dir"`) || !strings.Contains(calls[1], `"path":"/downloads/complete"`) {
		t.Fatalf("calls = %#v", calls)
	}
}

func TestDownloadLocationKeepsPathWhenFreeSpaceFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"result":"unable to get free space"}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/transmission/rpc", "", "")
	if err != nil {
		t.Fatal(err)
	}
	location, err := client.DownloadLocation(context.Background(), "/media/incoming")
	if err != nil {
		t.Fatal(err)
	}
	if location.Path != "/media/incoming" || location.FreeBytes != -1 {
		t.Fatalf("location = %+v", location)
	}
}

func TestAddTorrent(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		text := string(body)
		calls = append(calls, text)
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(text, "magnet:?xt=urn:btih:dup") {
			_, _ = io.WriteString(w, `{"arguments":{"torrent-duplicate":{"id":3,"name":"Dup"}},"result":"success"}`)
			return
		}
		_, _ = io.WriteString(w, `{"arguments":{"torrent-added":{"id":9,"name":"New"}},"result":"success"}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/transmission/rpc", "", "")
	if err != nil {
		t.Fatal(err)
	}
	err = client.AddTorrent(context.Background(), AddTorrentRequest{
		Metainfo:  []string{"AQID"},
		URL:       "https://files.example/movie.torrent",
		Directory: "/downloads/complete",
		Start:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 || !strings.Contains(calls[0], `"metainfo":"AQID"`) || !strings.Contains(calls[0], `"paused":false`) || !strings.Contains(calls[0], `"download-dir":"/downloads/complete"`) {
		t.Fatalf("first add = %s", calls)
	}
	if !strings.Contains(calls[1], `"filename":"https://files.example/movie.torrent"`) {
		t.Fatalf("second add = %s", calls[1])
	}
	err = client.AddTorrent(context.Background(), AddTorrentRequest{URL: "magnet:?xt=urn:btih:dup", Start: false})
	if err == nil || !strings.Contains(err.Error(), "already added: Dup") {
		t.Fatalf("duplicate error = %v", err)
	}
	if !strings.Contains(calls[2], `"paused":true`) {
		t.Fatalf("paused add = %s", calls[2])
	}
	if err := client.AddTorrent(context.Background(), AddTorrentRequest{URL: "not a torrent"}); err == nil {
		t.Fatal("expected an invalid URL to fail")
	}
	if err := client.AddTorrent(context.Background(), AddTorrentRequest{}); err == nil {
		t.Fatal("expected an empty request to fail")
	}
}

func TestStartStopRemove(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls = append(calls, string(body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"arguments":{},"result":"success"}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/transmission/rpc", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := client.StartTorrent(context.Background(), 4); err != nil {
		t.Fatal(err)
	}
	if err := client.StopTorrent(context.Background(), 4); err != nil {
		t.Fatal(err)
	}
	if err := client.RemoveTorrent(context.Background(), 4, true); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 3 || !strings.Contains(calls[0], `"torrent-start"`) || !strings.Contains(calls[0], `"ids":[4]`) {
		t.Fatalf("start = %s", calls)
	}
	if !strings.Contains(calls[1], `"torrent-stop"`) {
		t.Fatalf("stop = %s", calls[1])
	}
	if !strings.Contains(calls[2], `"torrent-remove"`) || !strings.Contains(calls[2], `"delete-local-data":true`) {
		t.Fatalf("remove = %s", calls[2])
	}
}
