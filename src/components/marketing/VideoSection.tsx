"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";

export interface VideoItem {
  id: string;
  title: string;
  shortTitle: string;
  tag: string;
  icon: string;
  duration: string;
  description: string;
  videoSrc: string;
  poster: string;
  highlights: string[];
}

export const PLATFORM_VIDEOS: VideoItem[] = [
  {
    id: "dashboard",
    title: "Live CRM & Operations Dashboard",
    shortTitle: "VaChat CRM Dashboard",
    tag: "Unified Command Center",
    icon: "📊",
    duration: "0:10",
    description:
      "Monitor incoming WhatsApp chats, track new contact growth, observe deal pipeline values, and view message delivery performance in real time.",
    videoSrc: "/videos/this_my_vachat_dashbord_create.mp4",
    poster: "/videos/thumb_dashboard.jpg",
    highlights: ["Real-time conversation metrics", "Deal pipeline values", "Message volume analytics"],
  },
  {
    id: "shopify-calling",
    title: "Boost Shopify Sales with AI WhatsApp Calling",
    shortTitle: "Shopify Sales & Voice AI",
    tag: "Voice AI & Inbound Calling",
    icon: "📞",
    duration: "0:10",
    description:
      "Engage high-intent shoppers with conversational AI voice calls, automatic call recording and transcription, and instant WhatsApp checkout assistance.",
    videoSrc: "/videos/other_variant.mp4",
    poster: "/videos/thumb_other_variant.jpg",
    highlights: ["AI WhatsApp voice calling", "Automatic call recording", "Frictionless checkout flow"],
  },
];

interface VideoSectionProps {
  onPlayVideo?: (video: { src: string; title: string; poster?: string }) => void;
}

export default function VideoSection({ onPlayVideo }: VideoSectionProps) {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentVideo =
    PLATFORM_VIDEOS.find((v) => v.id === activeTab) || PLATFORM_VIDEOS[0];

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  }, [activeTab]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const handleOpenModal = (video: VideoItem) => {
    if (onPlayVideo) {
      onPlayVideo({
        src: video.videoSrc,
        title: video.title,
        poster: video.poster,
      });
    }
  };

  return (
    <section id="demo-videos" className="video-section">
      <div className="wr">
        {/* Section Header */}
        <div className="section-header" style={{ marginBottom: "32px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--color-primary-dark, #009e46)",
              backgroundColor: "rgba(3, 207, 101, 0.1)",
              padding: "5px 14px",
              borderRadius: "9999px",
              marginBottom: "12px",
            }}
          >
            🎥 Interactive Platform Walkthrough
          </span>
          <h2 className="section-title">See VaChat in Action</h2>
          <p className="section-subtitle">
            Explore how modern Shopify merchants use VaChat to manage customer conversations,
            automate sales pipelines, and drive revenue.
          </p>
        </div>

        {/* Video Selector Tabs */}
        <div className="video-tabs-bar" role="tablist" aria-label="Platform Video Demos">
          {PLATFORM_VIDEOS.map((item) => {
            const isActive = item.id === activeTab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(item.id)}
                className={`video-tab-btn ${isActive ? "active" : ""}`}
              >
                <span className="video-tab-icon">{item.icon}</span>
                <span className="video-tab-label">{item.shortTitle}</span>
                <span className="video-tab-duration">{item.duration}</span>
              </button>
            );
          })}
        </div>

        {/* Modern Browser/Device Video Showcase Player */}
        <div className="video-device-frame">
          {/* Top Frame Window Bar */}
          <div className="video-frame-topbar">
            <div className="video-frame-dots">
              <span className="dot dot-red"></span>
              <span className="dot dot-yellow"></span>
              <span className="dot dot-green"></span>
            </div>
            <div className="video-frame-address">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>vachat.in/platform/{currentVideo.id}</span>
            </div>
            <button
              type="button"
              className="video-expand-action-btn"
              onClick={() => handleOpenModal(currentVideo)}
              title="Watch full screen in HD"
              aria-label="Open Fullscreen Video Modal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
              <span>Full Screen</span>
            </button>
          </div>

          {/* Main Video Viewport */}
          <div className="video-viewport" onClick={togglePlay}>
            <video
              ref={videoRef}
              key={currentVideo.videoSrc}
              src={currentVideo.videoSrc}
              poster={currentVideo.poster}
              autoPlay
              muted={isMuted}
              loop
              playsInline
              className="video-element"
            />

            {/* Play/Pause Center Indicator */}
            {!isPlaying && (
              <div className="video-paused-overlay">
                <div className="video-play-pulse-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                </div>
              </div>
            )}

            {/* Bottom In-Player Controls Overlay */}
            <div
              className="video-overlay-controls"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="video-control-left">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="video-btn-icon"
                  aria-label={isPlaying ? "Pause" : "Play"}
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" rx="1"></rect>
                      <rect x="14" y="4" width="4" height="16" rx="1"></rect>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  )}
                </button>

                <button
                  type="button"
                  onClick={toggleMute}
                  className="video-btn-icon"
                  aria-label={isMuted ? "Unmute audio" : "Mute audio"}
                  title={isMuted ? "Unmute audio" : "Mute audio"}
                >
                  {isMuted ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0a7 7 0 0 1-.11 1.23"></path>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"></polygon>
                      <line x1="23" y1="9" x2="17" y2="15"></line>
                      <line x1="17" y1="9" x2="23" y2="15"></line>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"></polygon>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                    </svg>
                  )}
                </button>

                <span className="video-current-title-badge">
                  {currentVideo.shortTitle}
                </span>
              </div>

              <div className="video-control-right">
                <button
                  type="button"
                  onClick={() => handleOpenModal(currentVideo)}
                  className="video-zoom-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    <line x1="11" y1="8" x2="11" y2="14"></line>
                    <line x1="8" y1="11" x2="14" y2="11"></line>
                  </svg>
                  <span>Open Fullscreen Lightbox</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Dual Video Cards Row Below Showcase */}
        <div className="video-cards-grid">
          {PLATFORM_VIDEOS.map((item) => {
            const isSelected = item.id === activeTab;
            return (
              <div
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`video-preview-card ${isSelected ? "selected" : ""}`}
                role="button"
                tabIndex={0}
                data-video-src={item.videoSrc}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setActiveTab(item.id);
                }}
              >
                <div className="video-card-thumb-wrap">
                  <Image
                    src={item.poster}
                    alt={item.title}
                    width={280}
                    height={158}
                    className="video-card-thumb"
                  />
                  <div className="video-card-badge-duration">
                    <span>{item.duration}</span>
                  </div>
                  <div className="video-card-overlay-btn">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  </div>
                </div>

                <div className="video-card-body">
                  <div className="video-card-topline">
                    <span className="video-card-tag">{item.tag}</span>
                    {isSelected && <span className="video-card-active-pill">Now Playing</span>}
                  </div>
                  <h3 className="video-card-title">{item.title}</h3>
                  <p className="video-card-desc">{item.description}</p>
                  <div className="video-card-highlights">
                    {item.highlights.map((h, i) => (
                      <span key={i} className="video-card-highlight-pill">
                        ✓ {h}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
