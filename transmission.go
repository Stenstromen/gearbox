//go:build darwin

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/stenstromen/gearbox/config"
	"github.com/stenstromen/gearbox/keychain"
)

const (
	envURL      = "TRANSMISSION_URL"
	envUsername = "TRANSMISSION_USERNAME"
	envPassword = "TRANSMISSION_PASSWORD"

	maxRPCBody = 8 << 20
)

// Torrent is the slice of a Transmission torrent shown in the list.
type Torrent struct {
	ID             int     `json:"id"`
	Name           string  `json:"name"`
	PercentDone    float64 `json:"percentDone"`
	PeersConnected int     `json:"peersConnected"`
	RateDownload   int64   `json:"rateDownload"`
	RateUpload     int64   `json:"rateUpload"`
	UploadRatio    float64 `json:"uploadRatio"`
	Status         string  `json:"status"`
	TotalSize      int64   `json:"totalSize"`
	Error          string  `json:"error"`
}

// Settings is the connection form. The password itself stays in the keychain.
type Settings struct {
	URL            string `json:"url"`
	Username       string `json:"username"`
	HasPassword    bool   `json:"hasPassword"`
	RefreshSeconds int    `json:"refreshSeconds"`
}

// SettingsInput is a preferences save. An empty password keeps the saved one.
type SettingsInput struct {
	URL            string `json:"url"`
	Username       string `json:"username"`
	Password       string `json:"password"`
	ClearPassword  bool   `json:"clearPassword"`
	RefreshSeconds int    `json:"refreshSeconds"`
}

// TransmissionService lists torrents on a remote Transmission daemon.
type TransmissionService struct {
	mu        sync.Mutex
	client    *Client
	store     *config.Store
	err       error
	openError string
}

// NewTransmissionService loads saved preferences, falling back to the environment
// until a URL has been saved.
func NewTransmissionService() *TransmissionService {
	store, err := config.Open("")
	service := &TransmissionService{store: store, err: err}
	if err == nil {
		_ = service.reloadClient()
	}
	return service
}

// Endpoint returns the RPC URL the service is using.
func (s *TransmissionService) Endpoint() string {
	client, err := s.rpc()
	if err != nil {
		return ""
	}
	return client.endpoint
}

// GetSettings returns the preferences form values.
func (s *TransmissionService) GetSettings() (Settings, error) {
	if s.err != nil {
		return Settings{}, s.err
	}
	prefs, err := s.store.Preferences()
	if err != nil {
		return Settings{}, err
	}
	secret, err := keychain.Get()
	if err != nil {
		return Settings{}, err
	}
	settings := Settings{
		URL:            prefs.URL,
		Username:       prefs.Username,
		HasPassword:    secret != "",
		RefreshSeconds: prefs.RefreshSeconds,
	}
	if settings.URL == "" {
		settings.URL = strings.TrimSpace(os.Getenv(envURL))
		settings.Username = os.Getenv(envUsername)
		if os.Getenv(envPassword) != "" {
			settings.HasPassword = true
		}
	}
	return settings, nil
}

// SaveSettings stores the connection settings and reconnects.
// The password is written to the keychain and is not saved in the JSON file.
func (s *TransmissionService) SaveSettings(input SettingsInput) error {
	if s.err != nil {
		return s.err
	}
	prefs := config.Preferences{
		URL:            input.URL,
		Username:       input.Username,
		RefreshSeconds: input.RefreshSeconds,
	}.Normalize()
	if _, err := normalizeEndpoint(prefs.URL); err != nil {
		return err
	}
	if err := s.store.Save(prefs); err != nil {
		return err
	}
	if strings.TrimSpace(input.Password) != "" {
		if err := keychain.Set(input.Password); err != nil {
			return err
		}
	} else if input.ClearPassword {
		if err := keychain.Delete(); err != nil {
			return err
		}
	} else if err := keepEnvPassword(); err != nil {
		return err
	}
	return s.reloadClient()
}

func keepEnvPassword() error {
	secret, err := keychain.Get()
	if err != nil || secret != "" {
		return err
	}
	envPassword := os.Getenv(envPassword)
	if envPassword == "" {
		return nil
	}
	return keychain.Set(envPassword)
}

func (s *TransmissionService) reloadClient() error {
	prefs, err := s.store.Preferences()
	if err != nil {
		return err
	}
	endpoint := prefs.URL
	username := prefs.Username
	password, err := keychain.Get()
	if err != nil {
		return err
	}
	if endpoint == "" {
		endpoint = strings.TrimSpace(os.Getenv(envURL))
		username = os.Getenv(envUsername)
		password = os.Getenv(envPassword)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if endpoint == "" {
		s.client = nil
		return nil
	}
	client, err := NewClient(endpoint, username, password)
	if err != nil {
		s.client = nil
		return err
	}
	s.client = client
	return nil
}

func (s *TransmissionService) rpc() (*Client, error) {
	if s.err != nil {
		return nil, s.err
	}
	s.mu.Lock()
	client := s.client
	s.mu.Unlock()
	if client == nil {
		return nil, fmt.Errorf("set the Transmission URL in Preferences")
	}
	return client, nil
}

// ListTorrents fetches every torrent from the configured daemon.
func (s *TransmissionService) ListTorrents(ctx context.Context) ([]Torrent, error) {
	client, err := s.rpc()
	if err != nil {
		return nil, err
	}
	return client.ListTorrents(ctx)
}

// TorrentInfo is the inspector snapshot for one torrent.
type TorrentInfo struct {
	ID             int           `json:"id"`
	Name           string        `json:"name"`
	Status         string        `json:"status"`
	Error          string        `json:"error"`
	PercentDone    float64       `json:"percentDone"`
	Have           int64         `json:"have"`
	Availability   float64       `json:"availability"`
	UploadedEver   int64         `json:"uploadedEver"`
	UploadRatio    float64       `json:"uploadRatio"`
	DownloadedEver int64         `json:"downloadedEver"`
	SecondsActive  int64         `json:"secondsActive"`
	ETA            int64         `json:"eta"`
	ActivityDate   int64         `json:"activityDate"`
	TotalSize      int64         `json:"totalSize"`
	PieceCount     int           `json:"pieceCount"`
	PieceSize      int64         `json:"pieceSize"`
	DownloadDir    string        `json:"downloadDir"`
	HashString     string        `json:"hashString"`
	AddedDate      int64         `json:"addedDate"`
	MagnetLink     string        `json:"magnetLink"`
	Peers          []Peer        `json:"peers"`
	Trackers       []Tracker     `json:"trackers"`
	Files          []TorrentFile `json:"files"`
}

// TorrentFile is one file inside a torrent.
// Name is the path relative to the torrent, with "/" between folders.
type TorrentFile struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	Have int64  `json:"have"`
}

// Tracker is one announce URL and its latest announce and scrape result.
// Tier is Transmission's zero-based tier.
type Tracker struct {
	Announce              string `json:"announce"`
	Tier                  int    `json:"tier"`
	HasAnnounced          bool   `json:"hasAnnounced"`
	LastAnnounceTime      int64  `json:"lastAnnounceTime"`
	LastAnnounceSucceeded bool   `json:"lastAnnounceSucceeded"`
	LastAnnounceResult    string `json:"lastAnnounceResult"`
	LastAnnouncePeerCount int    `json:"lastAnnouncePeerCount"`
	NextAnnounceTime      int64  `json:"nextAnnounceTime"`
	HasScraped            bool   `json:"hasScraped"`
	LastScrapeTime        int64  `json:"lastScrapeTime"`
	LastScrapeSucceeded   bool   `json:"lastScrapeSucceeded"`
	LastScrapeResult      string `json:"lastScrapeResult"`
	SeederCount           int    `json:"seederCount"`
	LeecherCount          int    `json:"leecherCount"`
	DownloadCount         int    `json:"downloadCount"`
}

// Peer is one connected peer on a torrent.
type Peer struct {
	Encrypted    bool    `json:"encrypted"`
	RateToPeer   int64   `json:"rateToPeer"`
	RateToClient int64   `json:"rateToClient"`
	Progress     float64 `json:"progress"`
	FlagStr      string  `json:"flagStr"`
	Address      string  `json:"address"`
	ClientName   string  `json:"clientName"`
}

// GetTorrent returns the inspector fields for one torrent.
func (s *TransmissionService) GetTorrent(ctx context.Context, id int) (TorrentInfo, error) {
	client, err := s.rpc()
	if err != nil {
		return TorrentInfo{}, err
	}
	return client.GetTorrent(ctx, id)
}

// DownloadLocation is the folder new torrents use and the free space there.
// FreeBytes is -1 when the daemon cannot report free space.
type DownloadLocation struct {
	Path      string `json:"path"`
	FreeBytes int64  `json:"freeBytes"`
}

// AddTorrentRequest adds torrent files, a magnet link, or an http(s) URL.
type AddTorrentRequest struct {
	Metainfo  []string `json:"metainfo"`
	URL       string   `json:"url"`
	Directory string   `json:"directory"`
	Start     bool     `json:"start"`
}

// DownloadLocation returns the default download directory when path is empty.
func (s *TransmissionService) DownloadLocation(ctx context.Context, path string) (DownloadLocation, error) {
	client, err := s.rpc()
	if err != nil {
		return DownloadLocation{}, err
	}
	return client.DownloadLocation(ctx, path)
}

// TakeOpenError returns a failed Open With add, then clears it.
func (s *TransmissionService) TakeOpenError() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	message := s.openError
	s.openError = ""
	return message
}

func (s *TransmissionService) rememberOpenError(err error) {
	if err == nil {
		return
	}
	s.mu.Lock()
	s.openError = err.Error()
	s.mu.Unlock()
}

// AddTorrent sends one or more torrents to the daemon.
func (s *TransmissionService) AddTorrent(ctx context.Context, request AddTorrentRequest) error {
	client, err := s.rpc()
	if err != nil {
		return err
	}
	return client.AddTorrent(ctx, request)
}

// StartTorrent resumes one torrent.
func (s *TransmissionService) StartTorrent(ctx context.Context, id int) error {
	client, err := s.rpc()
	if err != nil {
		return err
	}
	return client.StartTorrent(ctx, id)
}

// StopTorrent pauses one torrent.
func (s *TransmissionService) StopTorrent(ctx context.Context, id int) error {
	client, err := s.rpc()
	if err != nil {
		return err
	}
	return client.StopTorrent(ctx, id)
}

// RemoveTorrent drops one torrent from the daemon.
// deleteData also removes the downloaded files.
func (s *TransmissionService) RemoveTorrent(ctx context.Context, id int, deleteData bool) error {
	client, err := s.rpc()
	if err != nil {
		return err
	}
	return client.RemoveTorrent(ctx, id, deleteData)
}

// Client talks to Transmission's classic JSON-RPC endpoint.
// That dialect is understood by Transmission 2.x through 4.x.
type Client struct {
	endpoint  string
	username  string
	password  string
	http      *http.Client
	sessionID string
	mu        sync.Mutex
}

// NewClientFromEnv builds a client from TRANSMISSION_URL, TRANSMISSION_USERNAME,
// and TRANSMISSION_PASSWORD. The URL is required. Credentials may be empty when
// the daemon does not require authentication.
func NewClientFromEnv() (*Client, error) {
	return NewClient(os.Getenv(envURL), os.Getenv(envUsername), os.Getenv(envPassword))
}

// NewClient builds a client for one Transmission RPC endpoint.
func NewClient(endpoint, username, password string) (*Client, error) {
	normalized, err := normalizeEndpoint(endpoint)
	if err != nil {
		return nil, err
	}
	return &Client{
		endpoint: normalized,
		username: username,
		password: password,
		http:     &http.Client{Timeout: 20 * time.Second},
	}, nil
}

func normalizeEndpoint(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("Transmission URL is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("Transmission URL must be an absolute URL such as http://127.0.0.1:9091/transmission/rpc")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("Transmission URL must use http or https")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if parsed.Path == "" {
		parsed.Path = "/transmission/rpc"
	}
	return parsed.String(), nil
}

type rpcRequest struct {
	Method    string `json:"method"`
	Arguments any    `json:"arguments,omitempty"`
}

type rpcResponse struct {
	Result    string          `json:"result"`
	Arguments json.RawMessage `json:"arguments"`
}

type rpcTorrent struct {
	ID             int     `json:"id"`
	Name           string  `json:"name"`
	PercentDone    float64 `json:"percentDone"`
	PeersConnected int     `json:"peersConnected"`
	RateDownload   int64   `json:"rateDownload"`
	RateUpload     int64   `json:"rateUpload"`
	UploadRatio    float64 `json:"uploadRatio"`
	Status         int     `json:"status"`
	IsFinished     bool    `json:"isFinished"`
	TotalSize      int64   `json:"totalSize"`
	ErrorString    string  `json:"errorString"`
}

// ListTorrents requests every torrent and the fields the list view needs.
func (c *Client) ListTorrents(ctx context.Context) ([]Torrent, error) {
	var arguments struct {
		Torrents []rpcTorrent `json:"torrents"`
	}
	err := c.call(ctx, "torrent-get", map[string]any{
		"fields": []string{
			"id",
			"name",
			"percentDone",
			"peersConnected",
			"rateDownload",
			"rateUpload",
			"uploadRatio",
			"status",
			"isFinished",
			"totalSize",
			"errorString",
		},
	}, &arguments)
	if err != nil {
		return nil, err
	}

	torrents := make([]Torrent, 0, len(arguments.Torrents))
	for _, item := range arguments.Torrents {
		torrents = append(torrents, Torrent{
			ID:             item.ID,
			Name:           item.Name,
			PercentDone:    item.PercentDone,
			PeersConnected: item.PeersConnected,
			RateDownload:   item.RateDownload,
			RateUpload:     item.RateUpload,
			UploadRatio:    item.UploadRatio,
			Status:         statusLabel(item.Status, item.IsFinished),
			TotalSize:      item.TotalSize,
			Error:          item.ErrorString,
		})
	}
	slices.SortFunc(torrents, func(a, b Torrent) int {
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return torrents, nil
}

type rpcTorrentInfo struct {
	ID                 int           `json:"id"`
	Name               string        `json:"name"`
	Status             int           `json:"status"`
	IsFinished         bool          `json:"isFinished"`
	ErrorString        string        `json:"errorString"`
	PercentDone        float64       `json:"percentDone"`
	HaveValid          int64         `json:"haveValid"`
	HaveUnchecked      int64         `json:"haveUnchecked"`
	Availability       []float64     `json:"availability"`
	UploadedEver       int64         `json:"uploadedEver"`
	UploadRatio        float64       `json:"uploadRatio"`
	DownloadedEver     int64         `json:"downloadedEver"`
	SecondsDownloading int64         `json:"secondsDownloading"`
	SecondsSeeding     int64         `json:"secondsSeeding"`
	ETA                int64         `json:"eta"`
	ActivityDate       int64         `json:"activityDate"`
	TotalSize          int64         `json:"totalSize"`
	PieceCount         int           `json:"pieceCount"`
	PieceSize          int64         `json:"pieceSize"`
	DownloadDir        string        `json:"downloadDir"`
	HashString         string        `json:"hashString"`
	AddedDate          int64         `json:"addedDate"`
	MagnetLink         string        `json:"magnetLink"`
	Peers              []rpcPeer     `json:"peers"`
	TrackerStats       []rpcTracker  `json:"trackerStats"`
	Files              []rpcFile     `json:"files"`
	FileStats          []rpcFileStat `json:"fileStats"`
}

type rpcFile struct {
	Name           string `json:"name"`
	Length         int64  `json:"length"`
	BytesCompleted int64  `json:"bytesCompleted"`
}

type rpcFileStat struct {
	BytesCompleted int64 `json:"bytesCompleted"`
}

type rpcTracker struct {
	Announce              string `json:"announce"`
	Tier                  int    `json:"tier"`
	HasAnnounced          bool   `json:"hasAnnounced"`
	LastAnnounceTime      int64  `json:"lastAnnounceTime"`
	LastAnnounceSucceeded bool   `json:"lastAnnounceSucceeded"`
	LastAnnounceResult    string `json:"lastAnnounceResult"`
	LastAnnouncePeerCount int    `json:"lastAnnouncePeerCount"`
	NextAnnounceTime      int64  `json:"nextAnnounceTime"`
	HasScraped            bool   `json:"hasScraped"`
	LastScrapeTime        int64  `json:"lastScrapeTime"`
	LastScrapeSucceeded   bool   `json:"lastScrapeSucceeded"`
	LastScrapeResult      string `json:"lastScrapeResult"`
	SeederCount           int    `json:"seederCount"`
	LeecherCount          int    `json:"leecherCount"`
	DownloadCount         int    `json:"downloadCount"`
}

type rpcPeer struct {
	Address      string  `json:"address"`
	ClientName   string  `json:"clientName"`
	FlagStr      string  `json:"flagStr"`
	IsEncrypted  bool    `json:"isEncrypted"`
	Port         int     `json:"port"`
	Progress     float64 `json:"progress"`
	RateToClient int64   `json:"rateToClient"`
	RateToPeer   int64   `json:"rateToPeer"`
}

// GetTorrent requests the fields shown in the inspector.
// Availability is the fraction of pieces held by at least one connected peer.
// Transmission reports that per piece, so an empty array means it is unknown.
func (c *Client) GetTorrent(ctx context.Context, id int) (TorrentInfo, error) {
	var arguments struct {
		Torrents []rpcTorrentInfo `json:"torrents"`
	}
	err := c.call(ctx, "torrent-get", map[string]any{
		"ids": []int{id},
		"fields": []string{
			"id",
			"name",
			"status",
			"isFinished",
			"errorString",
			"percentDone",
			"haveValid",
			"haveUnchecked",
			"availability",
			"uploadedEver",
			"uploadRatio",
			"downloadedEver",
			"secondsDownloading",
			"secondsSeeding",
			"eta",
			"activityDate",
			"totalSize",
			"pieceCount",
			"pieceSize",
			"downloadDir",
			"hashString",
			"addedDate",
			"magnetLink",
			"peers",
			"trackerStats",
			"files",
			"fileStats",
		},
	}, &arguments)
	if err != nil {
		return TorrentInfo{}, err
	}
	if len(arguments.Torrents) == 0 {
		return TorrentInfo{}, fmt.Errorf("torrent %d was not found", id)
	}
	item := arguments.Torrents[0]
	return TorrentInfo{
		ID:             item.ID,
		Name:           item.Name,
		Status:         statusLabel(item.Status, item.IsFinished),
		Error:          item.ErrorString,
		PercentDone:    item.PercentDone,
		Have:           item.HaveValid + item.HaveUnchecked,
		Availability:   swarmAvailability(item.Availability),
		UploadedEver:   item.UploadedEver,
		UploadRatio:    item.UploadRatio,
		DownloadedEver: item.DownloadedEver,
		SecondsActive:  item.SecondsDownloading + item.SecondsSeeding,
		ETA:            item.ETA,
		ActivityDate:   item.ActivityDate,
		TotalSize:      item.TotalSize,
		PieceCount:     item.PieceCount,
		PieceSize:      item.PieceSize,
		DownloadDir:    item.DownloadDir,
		HashString:     item.HashString,
		AddedDate:      item.AddedDate,
		MagnetLink:     item.MagnetLink,
		Peers:          mapPeers(item.Peers),
		Trackers:       mapTrackers(item.TrackerStats),
		Files:          mapFiles(item.Files, item.FileStats),
	}, nil
}

func mapFiles(files []rpcFile, stats []rpcFileStat) []TorrentFile {
	mapped := make([]TorrentFile, 0, len(files))
	for i, file := range files {
		have := file.BytesCompleted
		if i < len(stats) {
			have = stats[i].BytesCompleted
		}
		mapped = append(mapped, TorrentFile{
			Name: file.Name,
			Size: file.Length,
			Have: have,
		})
	}
	return mapped
}

func mapTrackers(items []rpcTracker) []Tracker {
	trackers := make([]Tracker, 0, len(items))
	for _, item := range items {
		trackers = append(trackers, Tracker{
			Announce:              item.Announce,
			Tier:                  item.Tier,
			HasAnnounced:          item.HasAnnounced,
			LastAnnounceTime:      item.LastAnnounceTime,
			LastAnnounceSucceeded: item.LastAnnounceSucceeded,
			LastAnnounceResult:    item.LastAnnounceResult,
			LastAnnouncePeerCount: item.LastAnnouncePeerCount,
			NextAnnounceTime:      item.NextAnnounceTime,
			HasScraped:            item.HasScraped,
			LastScrapeTime:        item.LastScrapeTime,
			LastScrapeSucceeded:   item.LastScrapeSucceeded,
			LastScrapeResult:      item.LastScrapeResult,
			SeederCount:           item.SeederCount,
			LeecherCount:          item.LeecherCount,
			DownloadCount:         item.DownloadCount,
		})
	}
	slices.SortFunc(trackers, func(a, b Tracker) int {
		if a.Tier != b.Tier {
			return a.Tier - b.Tier
		}
		return strings.Compare(a.Announce, b.Announce)
	})
	return trackers
}

func mapPeers(items []rpcPeer) []Peer {
	peers := make([]Peer, 0, len(items))
	for _, item := range items {
		peers = append(peers, Peer{
			Encrypted:    item.IsEncrypted,
			RateToPeer:   item.RateToPeer,
			RateToClient: item.RateToClient,
			Progress:     item.Progress,
			FlagStr:      item.FlagStr,
			Address:      peerAddress(item.Address, item.Port),
			ClientName:   item.ClientName,
		})
	}
	return peers
}

func peerAddress(address string, port int) string {
	if address == "" || port <= 0 {
		return address
	}
	if strings.Contains(address, ":") {
		return fmt.Sprintf("[%s]:%d", address, port)
	}
	return fmt.Sprintf("%s:%d", address, port)
}

func swarmAvailability(pieces []float64) float64 {
	if len(pieces) == 0 {
		return -1
	}
	var present float64
	for _, count := range pieces {
		if count > 0 {
			present++
		}
	}
	return present / float64(len(pieces))
}

func (c *Client) DownloadLocation(ctx context.Context, path string) (DownloadLocation, error) {
	dir := strings.TrimSpace(path)
	if dir == "" {
		var session struct {
			DownloadDir string `json:"download-dir"`
		}
		if err := c.call(ctx, "session-get", map[string]any{"fields": []string{"download-dir"}}, &session); err != nil {
			return DownloadLocation{}, err
		}
		dir = session.DownloadDir
	}
	free, err := c.freeSpace(ctx, dir)
	if err != nil {
		return DownloadLocation{Path: dir, FreeBytes: -1}, nil
	}
	return DownloadLocation{Path: dir, FreeBytes: free}, nil
}

func (c *Client) freeSpace(ctx context.Context, path string) (int64, error) {
	var arguments struct {
		SizeBytes int64 `json:"size-bytes"`
	}
	if err := c.call(ctx, "free-space", map[string]any{"path": path}, &arguments); err != nil {
		return 0, err
	}
	return arguments.SizeBytes, nil
}

func (c *Client) AddTorrent(ctx context.Context, request AddTorrentRequest) error {
	directory := strings.TrimSpace(request.Directory)
	sources := make([]map[string]any, 0, len(request.Metainfo)+1)
	for _, meta := range request.Metainfo {
		meta = strings.TrimSpace(meta)
		if meta == "" {
			continue
		}
		sources = append(sources, map[string]any{"metainfo": meta})
	}
	link := strings.TrimSpace(request.URL)
	if link != "" {
		if !validTorrentURL(link) {
			return fmt.Errorf("enter a magnet link or an http(s) URL")
		}
		sources = append(sources, map[string]any{"filename": link})
	}
	if len(sources) == 0 {
		return fmt.Errorf("choose a torrent file or enter a URL")
	}
	var duplicates []string
	for _, source := range sources {
		args := map[string]any{"paused": !request.Start}
		for key, value := range source {
			args[key] = value
		}
		if directory != "" {
			args["download-dir"] = directory
		}
		var added struct {
			Added     *rpcAddedTorrent `json:"torrent-added"`
			Duplicate *rpcAddedTorrent `json:"torrent-duplicate"`
		}
		if err := c.call(ctx, "torrent-add", args, &added); err != nil {
			return err
		}
		if added.Duplicate != nil {
			name := added.Duplicate.Name
			if name == "" {
				name = "torrent"
			}
			duplicates = append(duplicates, name)
		}
	}
	if len(duplicates) > 0 {
		return fmt.Errorf("already added: %s", strings.Join(duplicates, ", "))
	}
	return nil
}

func validTorrentURL(value string) bool {
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "magnet:?") {
		return strings.Contains(lower, "xt=urn:btih:") || strings.Contains(lower, "xt=urn:btmh:")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}

type rpcAddedTorrent struct {
	Name string `json:"name"`
}

func (c *Client) StartTorrent(ctx context.Context, id int) error {
	return c.call(ctx, "torrent-start", map[string]any{"ids": []int{id}}, nil)
}

func (c *Client) StopTorrent(ctx context.Context, id int) error {
	return c.call(ctx, "torrent-stop", map[string]any{"ids": []int{id}}, nil)
}

func (c *Client) RemoveTorrent(ctx context.Context, id int, deleteData bool) error {
	return c.call(ctx, "torrent-remove", map[string]any{
		"ids":               []int{id},
		"delete-local-data": deleteData,
	}, nil)
}

func (c *Client) call(ctx context.Context, method string, args any, out any) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	payload, err := json.Marshal(rpcRequest{Method: method, Arguments: args})
	if err != nil {
		return err
	}

	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if c.sessionID != "" {
			req.Header.Set("X-Transmission-Session-Id", c.sessionID)
		}
		if c.username != "" || c.password != "" {
			req.SetBasicAuth(c.username, c.password)
		}

		resp, err := c.http.Do(req)
		if err != nil {
			return fmt.Errorf("reach transmission: %w", err)
		}

		if id := resp.Header.Get("X-Transmission-Session-Id"); id != "" {
			c.sessionID = id
		}
		if resp.StatusCode == http.StatusConflict {
			resp.Body.Close()
			continue
		}

		body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxRPCBody))
		resp.Body.Close()
		if readErr != nil {
			return readErr
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return fmt.Errorf("transmission authentication failed")
		}
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("transmission returned HTTP %d", resp.StatusCode)
		}

		var envelope rpcResponse
		if err := json.Unmarshal(body, &envelope); err != nil {
			return fmt.Errorf("decode transmission response: %w", err)
		}
		if envelope.Result != "success" {
			if envelope.Result == "" {
				return fmt.Errorf("transmission returned an empty result")
			}
			return fmt.Errorf("transmission: %s", envelope.Result)
		}
		if out == nil || len(envelope.Arguments) == 0 {
			return nil
		}
		if err := json.Unmarshal(envelope.Arguments, out); err != nil {
			return fmt.Errorf("decode transmission arguments: %w", err)
		}
		return nil
	}
	return fmt.Errorf("transmission rejected the session id")
}

func statusLabel(code int, finished bool) string {
	switch code {
	case 0:
		if finished {
			return "Seeding complete"
		}
		return "Stopped"
	case 1:
		return "Queued to verify"
	case 2:
		return "Verifying"
	case 3:
		return "Queued to download"
	case 4:
		return "Downloading"
	case 5:
		return "Queued to seed"
	case 6:
		return "Seeding"
	default:
		return "Unknown"
	}
}
