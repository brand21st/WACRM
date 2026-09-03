"use client";

import React from "react";
import Image from "next/image";

interface VideoSectionProps {
  onPlayVideo: (videoId: string) => void;
}

export default function VideoSection({ onPlayVideo }: VideoSectionProps) {
  return (
    <section className="video-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">Platform Overview</h2>
          <p className="section-subtitle">In 3 Minutes</p>
        </div>

        <div
          className="video-container"
          onClick={() => onPlayVideo("Cpvd4yOePWM")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onPlayVideo("Cpvd4yOePWM");
          }}
          aria-label="Play Overview Video"
        >
          <Image
            src="https://img.youtube.com/vi/Cpvd4yOePWM/maxresdefault.jpg"
            alt="Video Preview"
            className="video-thumbnail"
            width={960}
            height={540}
            style={{ width: "100%", height: "auto" }}
          />
          <div className="video-play-btn">
            <svg viewBox="0 0 24 24">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
