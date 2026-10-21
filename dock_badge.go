//go:build darwin

package main

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// dockBadge is the macOS Dock badge. Nil means the count is not shown.
type dockBadge interface {
	SetBadge(label string) error
	RemoveBadge() error
}

// setDock shows the number of active downloads on the Dock icon.
func (s *TransmissionService) setDock(badge dockBadge) {
	s.badgeMu.Lock()
	s.badge = badge
	s.badgeMu.Unlock()
}

// ServiceStartup keeps the Dock badge current while the app is running,
// including when the window is hidden and the list is not refreshing.
func (s *TransmissionService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.badgeMu.Lock()
	enabled := s.badge != nil
	s.badgeMu.Unlock()
	if !enabled {
		return nil
	}
	go s.watchDownloads(ctx)
	return nil
}

func (s *TransmissionService) watchDownloads(ctx context.Context) {
	s.refreshDownloadBadge(ctx)
	timer := time.NewTimer(s.refreshInterval())
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			s.refreshDownloadBadge(ctx)
			timer.Reset(s.refreshInterval())
		}
	}
}

func (s *TransmissionService) refreshDownloadBadge(ctx context.Context) {
	client, err := s.rpc()
	if err != nil {
		s.syncDownloadBadge(0)
		return
	}
	torrents, err := client.ListTorrents(ctx)
	if err != nil {
		s.syncDownloadBadge(0)
		return
	}
	s.syncDownloadBadge(activeDownloads(torrents))
}

func (s *TransmissionService) refreshInterval() time.Duration {
	const fallback = 5 * time.Second
	if s.store == nil {
		return fallback
	}
	prefs, err := s.store.Preferences()
	if err != nil || prefs.RefreshSeconds < 1 {
		return fallback
	}
	return time.Duration(prefs.RefreshSeconds) * time.Second
}

// activeDownloads counts torrents Transmission is downloading now.
// Queued, stopped, verifying, and seeding torrents are not included.
func activeDownloads(torrents []Torrent) int {
	count := 0
	for _, torrent := range torrents {
		if torrent.Status == "Downloading" {
			count++
		}
	}
	return count
}

// syncDownloadBadge sets the Dock badge to count, or clears it at zero.
// A failed update is retried on the next refresh.
func (s *TransmissionService) syncDownloadBadge(count int) {
	if count < 0 {
		count = 0
	}
	s.badgeMu.Lock()
	defer s.badgeMu.Unlock()
	if s.badge == nil || (s.badgeApplied != nil && *s.badgeApplied == count) {
		return
	}
	var err error
	if count == 0 {
		err = s.badge.RemoveBadge()
	} else {
		err = s.badge.SetBadge(strconv.Itoa(count))
	}
	if err != nil {
		if err.Error() != s.badgeErr {
			log.Printf("dock badge: %v", err)
			s.badgeErr = err.Error()
		}
		return
	}
	s.badgeErr = ""
	applied := count
	s.badgeApplied = &applied
}
