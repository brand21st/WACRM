"use client";

import React, { useState, useRef } from "react";
import Image from "next/image";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

interface FeatureItem {
  id: string;
  badge: string;
  emoji: string;
  title: string;
  description: string;
  subtext?: string;
  image?: string;
  imageAlt?: string;
  reverse?: boolean;
}

interface FeatureVideoPlayerProps {
  videoSrc: string;
  poster: string;
  title: string;
  badgeText?: string;
  onExpand?: () => void;
}

function FeatureVideoPlayer({
  videoSrc,
  poster,
  title,
  badgeText = "Shopify AI Calling Demo",
  onExpand,
}: FeatureVideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  return (
    <div
      className="feature-video-wrapper"
      onClick={togglePlay}
      role="button"
      tabIndex={0}
      aria-label={`Play ${title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") togglePlay();
      }}
    >
      <video
        ref={videoRef}
        src={videoSrc}
        poster={poster}
        autoPlay
        muted={isMuted}
        loop
        playsInline
        className="feature-video-element"
      />

      {/* Floating Top Badge */}
      <div className="feature-video-topbadge">
        <span className="feature-video-dot"></span>
        <span>{badgeText}</span>
      </div>

      {/* Center Paused Overlay */}
      {!isPlaying && (
        <div className="feature-video-pause-overlay">
          <div className="feature-video-pulse-btn">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
        </div>
      )}

      {/* Bottom Floating Toolbar */}
      <div
        className="feature-video-bottombar"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={togglePlay}
          className="feature-video-btn"
          aria-label={isPlaying ? "Pause Video" : "Play Video"}
        >
          {isPlaying ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"></rect>
              <rect x="14" y="4" width="4" height="16" rx="1"></rect>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={toggleMute}
          className="feature-video-btn"
          aria-label={isMuted ? "Unmute Audio" : "Mute Audio"}
        >
          {isMuted ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"></polygon>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"></polygon>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
          )}
        </button>

        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="feature-video-btn-expand"
            aria-label="Expand Fullscreen Lightbox"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
            <span>Full HD</span>
          </button>
        )}
      </div>
    </div>
  );
}


const features: FeatureItem[] = [
  {
    id: "ai-support",
    badge: "24/7 Sales Assistance",
    emoji: "🤖",
    title: "AI That Talks to Your Customers",
    description: "Let VaChat's AI answer questions, understand what customers need, recommend products, and guide them toward a purchase — 24/7.",
    subtext: "Instant responses that keep customer intent high, whether it's daytime browsing or midnight shopping.",
    reverse: false,
  },
  {
    id: "shopify-orders",
    badge: "Direct Catalog Integration",
    emoji: "🛍️",
    title: "Convert Conversations Into Shopify Orders",
    description: "Connect your Shopify store with VaChat and bring your products directly into the customer conversation. Help shoppers discover products faster and move from interest to purchase.",
    subtext: "Sync products, variants, and stock automatically so your AI always recommends available items.",
    image: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/2cbv2iqtg8phy296.webp",
    imageAlt: "Shopify product catalog in WhatsApp",
    reverse: true,
  },
  {
    id: "ai-calls",
    badge: "Conversational Voice AI",
    emoji: "📞",
    title: "AI-Powered WhatsApp Calls",
    description: "Give customers a more personal buying experience with AI-powered WhatsApp calls. Your AI can talk with customers, answer questions, and assist them through their buying journey.",
    subtext: "Natural, lifelike voice calling that handles high-intent purchase questions in real time.",
    image: "/images/ai_whatsapp_calling.png",
    imageAlt: "AI WhatsApp calling visual",
    reverse: false,
  },
  {
    id: "call-recording",
    badge: "Quality & Insights",
    emoji: "🎙️",
    title: "Record & Understand Calls",
    description: "Record WhatsApp calls to review conversations, understand customer requirements, and identify opportunities to improve your sales process.",
    subtext: "Actionable transcripts and summaries to continuously optimize your pitch and product recommendations.",
    reverse: true,
  },
  {
    id: "whatsapp-payments",
    badge: "Zero-Friction Checkout",
    emoji: "💳",
    title: "Make Payments Easier on WhatsApp",
    description: "Reduce friction at checkout with a convenient WhatsApp payment experience, helping customers move from product discovery to purchase faster.",
    subtext: "Complete transactions right inside the chat window without losing buyers to complicated external checkouts.",
    image: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/wrgtce58qaaq14xq.jpg?w=800&h=800&dpr=2",
    imageAlt: "WhatsApp payment checkout interface",
    reverse: false,
  },
];

interface ShopifyConversionFeaturesProps {
  onPlayVideo?: (video: { src: string; title: string; poster?: string }) => void;
}

export default function ShopifyConversionFeatures({ onPlayVideo }: ShopifyConversionFeaturesProps) {
  return (
    <section id="features" className="features-deep-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">Turn WhatsApp Conversations Into Shopify Customers</h2>
          <p className="section-subtitle">
            Your customers are already talking on WhatsApp. VaChat helps you turn those conversations into <strong>real Shopify orders</strong>.
          </p>
        </div>

        {features.map((feat) => (
          <div
            id={feat.id}
            className={`feature-row ${feat.reverse ? "reverse" : ""}`}
            key={feat.id}
          >
            <div className="feature-col-content">
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--color-primary-dark, #009e46)",
                  backgroundColor: "rgba(3, 207, 101, 0.1)",
                  padding: "4px 12px",
                  borderRadius: "9999px",
                  width: "fit-content",
                  marginBottom: "12px",
                }}
              >
                <span>{feat.emoji}</span> {feat.badge}
              </span>
              <h3 className="section-title" style={{ textAlign: "left", fontSize: "30px", marginBottom: "14px" }}>
                {feat.title}
              </h3>
              <p className="section-subtitle" style={{ textAlign: "left", marginBottom: feat.subtext ? "12px" : "24px", fontSize: "17px", lineHeight: "1.55" }}>
                {feat.description}
              </p>
              {feat.subtext && (
                <p style={{ color: "var(--color-text-secondary)", fontSize: "15px", lineHeight: "1.6", marginBottom: "28px" }}>
                  {feat.subtext}
                </p>
              )}
              <div>
                <a
                  href={APP_SIGNUP}
                  className="btn btn-primary"
                >
                  <span>Start Selling on WhatsApp</span>
                  <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                  </svg>
                </a>
              </div>
            </div>
            <div className="feature-row-visual">
              {feat.id === "ai-support" ? (
                <FeatureVideoPlayer
                  videoSrc="/videos/this_my_vachat_dashbord_create.mp4"
                  poster="/videos/thumb_dashboard.jpg"
                  title="VaChat CRM Dashboard & Analytics"
                  badgeText="Live VaChat CRM Dashboard Demo"
                  onExpand={() =>
                    onPlayVideo?.({
                      src: "/videos/this_my_vachat_dashbord_create.mp4",
                      title: "VaChat CRM Dashboard & Analytics",
                      poster: "/videos/thumb_dashboard.jpg",
                    })
                  }
                />
              ) : feat.id === "call-recording" ? (
                <FeatureVideoPlayer
                  videoSrc="/videos/other_variant.mp4"
                  poster="/videos/thumb_other_variant.jpg"
                  title={feat.title}
                  badgeText="WhatsApp Voice Calling & Recording"
                  onExpand={() =>
                    onPlayVideo?.({
                      src: "/videos/other_variant.mp4",
                      title: "Boost Shopify Sales with AI WhatsApp Calling",
                      poster: "/videos/thumb_other_variant.jpg",
                    })
                  }
                />
              ) : (
                <Image
                  src={feat.image!}
                  alt={feat.imageAlt || feat.title}
                  width={560}
                  height={420}
                  style={{ width: "100%", height: "auto", borderRadius: "12px", boxShadow: "0 10px 30px -10px rgba(0,0,0,0.08)" }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
