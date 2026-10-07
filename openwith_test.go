//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRequestFromTorrentFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Movie.TORRENT")
	if err := os.WriteFile(path, []byte("d8:announce4:teste"), 0o600); err != nil {
		t.Fatal(err)
	}
	request, err := requestFromTorrentFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(request.Metainfo) != 1 || request.Metainfo[0] == "" || !request.Start || request.URL != "" {
		t.Fatalf("request = %#v", request)
	}

	if _, err := requestFromTorrentFile(filepath.Join(dir, "notes.txt")); err == nil {
		t.Fatal("expected a non-torrent file to be rejected")
	}
}

func TestRequestFromTorrentFileTooLarge(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "huge.torrent")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxTorrentBytes + 1); err != nil {
		t.Fatal(err)
	}
	file.Close()
	if _, err := requestFromTorrentFile(path); err == nil {
		t.Fatal("expected an oversized torrent to be rejected")
	}
}

func TestRequestFromMagnet(t *testing.T) {
	request, err := requestFromMagnet("  magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567 ")
	if err != nil {
		t.Fatal(err)
	}
	if !request.Start || request.URL == "" || len(request.Metainfo) != 0 {
		t.Fatalf("request = %#v", request)
	}
	if _, err := requestFromMagnet("https://example.com/file.torrent"); err == nil {
		t.Fatal("expected an http url to be rejected")
	}
	if _, err := requestFromMagnet("magnet:?xt=urn:sha1:nope"); err == nil {
		t.Fatal("expected a magnet without a btih hash to be rejected")
	}
}
