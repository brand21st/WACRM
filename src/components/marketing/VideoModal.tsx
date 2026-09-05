"use client";

import React, { useEffect, useRef } from "react";

export interface VideoModalProps {
  isOpen: boolean;
  videoSrc: string;
  title?: string;
  poster?: string;
  onClose: () => void;
}

export default function VideoModal({
  isOpen,
  videoSrc,
  title = "Platform Video",
  poster,
  onClose,
}: VideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {
          // Autoplay policy fallback
        });
      }
    } else {
      document.body.style.overflow = "";
      if (videoRef.current) {
        videoRef.current.pause();
      }
    }

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="video-modal-overlay open"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="video-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="video-modal-header">
          <div className="video-modal-title-group">
            <span className="video-modal-badge">HD Demo</span>
            <h3 className="video-modal-title">{title}</h3>
          </div>
          <button
            type="button"
            className="video-modal-close"
            onClick={onClose}
            aria-label="Close Video Modal"
          >
            &times;
          </button>
        </div>

        <div className="video-modal-player-wrap">
          <video
            ref={videoRef}
            src={videoSrc}
            poster={poster}
            controls
            autoPlay
            playsInline
            className="video-modal-element"
          >
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    </div>
  );
}
