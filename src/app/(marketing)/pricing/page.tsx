"use client";

import React, { useState } from "react";
import MagicBar from "@/components/marketing/MagicBar";
import Header from "@/components/marketing/Header";
import PricingSection from "@/components/marketing/PricingSection";
import FAQ from "@/components/marketing/FAQ";
import FinalCTA from "@/components/marketing/FinalCTA";
import Footer from "@/components/marketing/Footer";
import WhatsAppWidget from "@/components/marketing/WhatsAppWidget";
import CalendlyModal from "@/components/marketing/CalendlyModal";

export default function PricingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [demoModalOpen, setDemoModalOpen] = useState(false);

  return (
    <main>
      {/* Top Announcement Bar */}
      <MagicBar isMenuOpen={isMenuOpen} />

      {/* Sticky Header Navigation */}
      <Header onMenuToggle={(open) => setIsMenuOpen(open)} />

      {/* Dedicated VaChat Pricing Section */}
      <PricingSection />

      {/* Pricing FAQs */}
      <FAQ />

      {/* Bottom Conversion CTA Banner */}
      <FinalCTA />

      {/* Footer */}
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
