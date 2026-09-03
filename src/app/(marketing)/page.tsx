"use client";

import React, { useState } from "react";
import MagicBar from "@/components/marketing/MagicBar";
import Header from "@/components/marketing/Header";
import Hero from "@/components/marketing/Hero";
import LogosMarquee from "@/components/marketing/LogosMarquee";
import VideoSection from "@/components/marketing/VideoSection";
import BroadcastSection from "@/components/marketing/BroadcastSection";
import FeaturesSection from "@/components/marketing/FeaturesSection";
import WhyWhatsApp from "@/components/marketing/WhyWhatsApp";
import AdvancedGrid from "@/components/marketing/AdvancedGrid";
import TickerBar from "@/components/marketing/TickerBar";
import G2Awards from "@/components/marketing/G2Awards";
import Testimonials from "@/components/marketing/Testimonials";
import Onboarding from "@/components/marketing/Onboarding";
import FAQ from "@/components/marketing/FAQ";
import Footer from "@/components/marketing/Footer";
import WhatsAppWidget from "@/components/marketing/WhatsAppWidget";
import VideoModal from "@/components/marketing/VideoModal";
import CalendlyModal from "@/components/marketing/CalendlyModal";

export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [currentVideoId, setCurrentVideoId] = useState("Cpvd4yOePWM");
  const [demoModalOpen, setDemoModalOpen] = useState(false);

  const handlePlayVideo = (videoId: string) => {
    setCurrentVideoId(videoId);
    setVideoModalOpen(true);
  };

  return (
    <main>
      {/* Top Announcement Bar */}
      <MagicBar isMenuOpen={isMenuOpen} />

      {/* Sticky Header Navigation */}
      <Header onMenuToggle={(open) => setIsMenuOpen(open)} />

      {/* Hero Section */}
      <Hero onOpenDemo={() => setDemoModalOpen(true)} />

      {/* Partner Logos Infinite Marquee */}
      <LogosMarquee />

      {/* Video Overview Section */}
      <VideoSection onPlayVideo={handlePlayVideo} />

      {/* Broadcast Section */}
      <BroadcastSection />

      {/* Deep-Dive Feature Rows */}
      <FeaturesSection />

      {/* Why WhatsApp Stats Section */}
      <WhyWhatsApp />

      {/* Advanced Features 4-Card Grid */}
      <AdvancedGrid />

      {/* Infinite Green Ticker Bar */}
      <TickerBar />

      {/* G2 Awards Section */}
      <G2Awards />

      {/* Testimonials */}
      <Testimonials />

      {/* Onboarding in 10 Minutes */}
      <Onboarding />

      {/* Interactive FAQ Accordion */}
      <FAQ />

      {/* Multi-Column Footer */}
      <Footer />

      {/* Floating Live WhatsApp Support Button */}
      <WhatsAppWidget />

      {/* Lightbox Video Modal */}
      <VideoModal
        isOpen={videoModalOpen}
        videoId={currentVideoId}
        onClose={() => setVideoModalOpen(false)}
      />

      {/* Calendly Live Demo Modal */}
      <CalendlyModal
        isOpen={demoModalOpen}
        onClose={() => setDemoModalOpen(false)}
      />
    </main>
  );
}
