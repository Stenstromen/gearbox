//go:build darwin

package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestActiveDownloads(t *testing.T) {
	torrents := []Torrent{
		{Status: "Downloading"},
		{Status: "Queued to download"},
		{Status: "Downloading"},
		{Status: "Seeding"},
		{Status: "Stopped"},
		{Status: "Verifying"},
		{Status: "Seeding complete"},
	}
	if got := activeDownloads(torrents); got != 2 {
		t.Fatalf("activeDownloads = %d, want 2", got)
	}
}

func TestListTorrentsSetsDockBadge(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"arguments": {
				"torrents": [
					{"id":1,"name":"Alpha","status":4,"isFinished":false},
					{"id":2,"name":"Queued","status":3,"isFinished":false},
					{"id":3,"name":"Beta","status":4,"isFinished":false},
					{"id":4,"name":"Seed","status":6,"isFinished":false}
				]
			},
			"result": "success"
		}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	badge := &fakeBadge{}
	service := &TransmissionService{client: client, badge: badge}
	if _, err := service.ListTorrents(context.Background()); err != nil {
		t.Fatal(err)
	}
	if badge.label != "2" || badge.removed {
		t.Fatalf("badge = %q removed=%v, want 2", badge.label, badge.removed)
	}
}

func TestListTorrentsClearsDockBadge(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"arguments": {
				"torrents": [
					{"id":1,"name":"Seed","status":6,"isFinished":false}
				]
			},
			"result": "success"
		}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "", "")
	if err != nil {
		t.Fatal(err)
	}
	badge := &fakeBadge{}
	service := &TransmissionService{client: client, badge: badge}
	if _, err := service.ListTorrents(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !badge.removed || badge.label != "" {
		t.Fatalf("badge = %q removed=%v, want cleared", badge.label, badge.removed)
	}
}

func TestListTorrentsFailureClearsDockBadge(t *testing.T) {
	badge := &fakeBadge{}
	service := &TransmissionService{badge: badge}
	if _, err := service.ListTorrents(context.Background()); err == nil {
		t.Fatal("expected an error without a Transmission URL")
	}
	if !badge.removed {
		t.Fatal("expected the dock badge to be cleared")
	}
}

type fakeBadge struct {
	label   string
	removed bool
}

func (f *fakeBadge) SetBadge(label string) error {
	f.label = label
	f.removed = false
	return nil
}

func (f *fakeBadge) RemoveBadge() error {
	f.label = ""
	f.removed = true
	return nil
}
