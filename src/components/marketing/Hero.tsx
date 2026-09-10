"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";


const BUSINESS_TARGETS = [
  "Local Businesses",
  "Online Merchants",
  "WhatsApp-Based Businesses",
  "Shopify Stores",
  "WordPress Sites",
  "Local Sellers",
];

interface HeroProps {
  onOpenDemo?: () => void;
  onWatchVideo?: () => void;
}

export default function Hero({ onOpenDemo, onWatchVideo }: HeroProps) {
  const [targetIndex, setTargetIndex] = useState(0);
  const [animationState, setAnimationState] = useState<"entering" | "active" | "exiting">("active");

  useEffect(() => {
    const interval = setInterval(() => {
      // Step 1: Start exit transition (slide up + fade out)
      setAnimationState("exiting");

      setTimeout(() => {
        // Step 2: Update text and set to enter state
        setTargetIndex((prev) => (prev + 1) % BUSINESS_TARGETS.length);
        setAnimationState("entering");

        // Step 3: Trigger active transition (slide into place)
        requestAnimationFrame(() => {
          setTimeout(() => {
            setAnimationState("active");
          }, 30);
        });
      }, 350);
    }, 2800);

    return () => clearInterval(interval);
  }, []);

  const handleDemoClick = () => {
    if (onWatchVideo) {
      onWatchVideo();
    } else if (onOpenDemo) {
      onOpenDemo();
    }
  };

  return (
    <section className="hero-section">
      <div className="wr hero-inner">
        <div className="hero-content">
          {/* Top Badge Pill */}
          <span className="badge-pill">
            <span>✨</span> — <span>AI-Powered WhatsApp Automation</span>
          </span>

          {/* Dynamic H1 Headline */}
          <h1 className="hero-title">
            <span className="hero-title-prefix">WhatsApp AI Chat for</span>{" "}
            <span className="hero-rotator-container" aria-live="polite">
              <span className={`hero-rotator-text ${animationState}`}>
                {BUSINESS_TARGETS[targetIndex]}
              </span>
            </span>
          </h1>

          {/* Subheadline */}
          <p className="hero-subtitle">
            Automate customer support, capture leads 24/7, and close sales on autopilot with human-like AI conversational agents built directly into WhatsApp.
          </p>

          {/* Feature Highlights Pills */}
          <div
            className="hero-feature-pills"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 12px",
              justifyContent: "center",
              margin: "8px 0 24px 0",
            }}
          >
            {[
              "Instant AI Responses",
              "24/7 Lead Capture",
              "Automated FAQs & Catalogs",
              "1-Click WhatsApp Checkout",
              "🌐 Malayalam, English, Tamil, Hindi, Kannada",
              "Zero-Code Setup",
            ].map((item, idx) => (
              <span
                key={idx}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "13px",
                  fontWeight: 500,
                  padding: "5px 12px",
                  borderRadius: "9999px",
                  backgroundColor: "rgba(3, 207, 101, 0.09)",
                  color: "#0f5132",
                  border: "1px solid rgba(3, 207, 101, 0.25)",
                }}
              >
                <span style={{ color: "#03cf65", marginRight: "6px", fontWeight: "bold" }}>•</span> {item}
              </span>
            ))}
          </div>

        </div>

        {/* Hero Visual Banner Image */}
        <div
          className="hero-visual-wrapper"
          style={{ position: "relative", cursor: (onWatchVideo || onOpenDemo) ? "pointer" : "default" }}
          onClick={handleDemoClick}
          role={(onWatchVideo || onOpenDemo) ? "button" : undefined}
          tabIndex={(onWatchVideo || onOpenDemo) ? 0 : undefined}
          aria-label="Play Product Video Demo"
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && (onWatchVideo || onOpenDemo)) {
              handleDemoClick();
            }
          }}
        >
          <Image
            src="/images/hero-banner.png"
            alt="AI-Powered WhatsApp Platform for Local Businesses & Online Merchants Demo"
            className="hero-visual-img"
            width={1024}
            height={675}
            priority
            style={{ width: "100%", height: "auto" }}
          />
        </div>
      </div>
    </section>
  );
}
