"use client";

import React, { useState } from "react";
import MagicBar from "@/components/marketing/MagicBar";
import Header from "@/components/marketing/Header";
import Hero from "@/components/marketing/Hero";
import ShopifyConversionFeatures from "@/components/marketing/ShopifyConversionFeatures";
import SalesJourneyBanner from "@/components/marketing/SalesJourneyBanner";
import SalesAssistantSection from "@/components/marketing/SalesAssistantSection";
import WhyWhatsApp from "@/components/marketing/WhyWhatsApp";
import TickerBar from "@/components/marketing/TickerBar";
import Testimonials from "@/components/marketing/Testimonials";
import Onboarding from "@/components/marketing/Onboarding";
import PricingSection from "@/components/marketing/PricingSection";
import FAQ from "@/components/marketing/FAQ";
import FinalCTA from "@/components/marketing/FinalCTA";
import Footer from "@/components/marketing/Footer";
import WhatsAppWidget from "@/components/marketing/WhatsAppWidget";
import CalendlyModal from "@/components/marketing/CalendlyModal";

export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [demoModalOpen, setDemoModalOpen] = useState(false);

  return (
    <main>
      {/* Top Announcement Bar */}
      <MagicBar isMenuOpen={isMenuOpen} />

      {/* Sticky Header Navigation */}
      <Header onMenuToggle={(open) => setIsMenuOpen(open)} />

      {/* Hero Section */}
      <Hero onOpenDemo={() => setDemoModalOpen(true)} />

      {/* 5 Core Shopify + WhatsApp Conversion Features */}
      <ShopifyConversionFeatures />

      {/* Conversion Funnel Journey Flow */}
      <SalesJourneyBanner />

      {/* Built for Shopify Growth AI Assistant Section */}
      <SalesAssistantSection />

      {/* Why WhatsApp Stats Section */}
      <WhyWhatsApp />

      {/* Infinite Green Ticker Bar */}
      <TickerBar />

      {/* Testimonials */}
      <Testimonials />

      {/* Onboarding in 10 Minutes */}
      <Onboarding />

      {/* VaChat Dark Premium Pricing Section */}
      <PricingSection />

      {/* Interactive FAQ Accordion */}
      <FAQ />

      {/* Final Bottom Conversion CTA Banner */}
      <FinalCTA />

      {/* Multi-Column Footer */}
      <Footer />

      {/* Floating Live WhatsApp Support Button */}
      <WhatsAppWidget />

      {/* Calendly Live Demo Modal */}
      <CalendlyModal
        isOpen={demoModalOpen}
        onClose={() => setDemoModalOpen(false)}
      />
    </main>
  );
}
