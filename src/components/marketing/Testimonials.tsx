import React from "react";
import Image from "next/image";

export default function Testimonials() {
  return (
    <section id="testimonials" className="testimonials-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">Loved by High-Growth Teams</h2>
          <p className="section-subtitle">See how modern brands drive 5X ROI with WhatsApp CRM</p>
        </div>

        <div className="testimonials-grid">
          {/* PhysicsWallah */}
          <div className="testimonial-card">
            <p className="testimonial-quote">
              &quot;The platform team has shown <strong>exceptional professionalism, reliability</strong> and a true commitment to customer satisfaction.&quot;
            </p>
            <div className="testimonial-author">
              <Image
                src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/qdndgnw992ontzy8.png?w=160&h=160&dpr=2"
                alt="PhysicsWallah Logo"
                className="author-avatar"
                width={48}
                height={48}
              />
              <div>
                <div className="author-name">Priyal Ostwal</div>
                <div className="author-role">Marketing Manager, PhysicsWallah</div>
              </div>
            </div>
          </div>

          {/* Cosco */}
          <div className="testimonial-card">
            <p className="testimonial-quote">
              &quot;Helped us increase our customer engagement dramatically. Our customer engagement increased from <strong>35% to 90%</strong> with Smart Retargeting.&quot;
            </p>
            <div className="testimonial-author">
              <Image
                src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/g1e4h3iwqt45n9mk.png?w=160&h=160&dpr=2"
                alt="Cosco Logo"
                className="author-avatar"
                width={48}
                height={48}
              />
              <div>
                <div className="author-name">Akash Jain</div>
                <div className="author-role">Business Executive, Cosco</div>
              </div>
            </div>
          </div>

          {/* AevyTV */}
          <div className="testimonial-card">
            <p className="testimonial-quote">
              &quot;Pivotal for our team. The <strong>personalised interactions and instant responses</strong> greatly improved our engagement rates, and more importantly our sales!&quot;
            </p>
            <div className="testimonial-author">
              <Image
                src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/0mvyk0b4akt8smrn.png?w=160&h=160&dpr=2"
                alt="AevyTV Logo"
                className="author-avatar"
                width={48}
                height={48}
              />
              <div>
                <div className="author-name">Achina Mayya</div>
                <div className="author-role">Founder &amp; CEO, AevyTV</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
