"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Share2,
  Check,
  Sparkles,
  ArrowRight,
  BookOpen,
  MessageCircle,
} from "lucide-react";
import Header from "@/components/marketing/Header";
import Footer from "@/components/marketing/Footer";
import MagicBar from "@/components/marketing/MagicBar";
import FinalCTA from "@/components/marketing/FinalCTA";
import WhatsAppWidget from "@/components/marketing/WhatsAppWidget";
import { getPostBySlug, getRelatedPosts } from "@/lib/blog/posts";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

export default function BlogPostPage() {
  const params = useParams();
  const slug = Array.isArray(params?.slug) ? params.slug[0] : (params?.slug as string);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const post = getPostBySlug(slug);

  if (!post) {
    return (
      <div className="marketing-page-wrapper">
        <MagicBar isMenuOpen={isMenuOpen} />
        <Header onMenuToggle={(open) => setIsMenuOpen(open)} />
        <main className="wr py-28 text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Article Not Found</h1>
          <p className="text-slate-600 mb-8">The requested article could not be found or has been moved.</p>
          <Link href="/blog" className="vachat-pricing-btn inline-flex max-w-xs mx-auto">
            <span>Back to All Articles</span>
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const relatedPosts = getRelatedPosts(post.slug, post.category, 3);
  const currentUrl = typeof window !== "undefined" ? window.location.href : "";

  const handleCopyLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareOnWhatsApp = () => {
    const text = encodeURIComponent(`Check out this article: "${post.title}"\n${currentUrl}`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
  };

  const shareOnTwitter = () => {
    const text = encodeURIComponent(`"${post.title}" via @vachat\n${currentUrl}`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, "_blank");
  };

  const shareOnLinkedIn = () => {
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(currentUrl)}`, "_blank");
  };

  return (
    <div className="marketing-page-wrapper">
      <MagicBar isMenuOpen={isMenuOpen} />
      <Header onMenuToggle={(open) => setIsMenuOpen(open)} />

      <main className="article-page-wrapper">
        {/* Breadcrumb & Navigation Bar */}
        <div className="article-top-bar">
          <div className="wr">
            <Link href="/blog" className="article-back-link">
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Articles</span>
            </Link>
          </div>
        </div>

        {/* Article Hero & Header */}
        <header className="article-header-section">
          <div className="wr article-header-container">
            <div className="article-meta-badges">
              <span className="blog-category-tag">{post.category}</span>
              <span className="blog-meta-divider">•</span>
              <span className="blog-meta-item flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {post.readTime}
              </span>
              <span className="blog-meta-divider">•</span>
              <span className="blog-meta-item flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {post.publishedAt}
              </span>
            </div>

            <h1 className="article-main-title">{post.title}</h1>
            <p className="article-main-excerpt">{post.excerpt}</p>

            {/* Author & Share Bar */}
            <div className="article-author-share-bar">
              <div className="article-author-card">
                <Image
                  src={post.author.avatar}
                  alt={post.author.name}
                  width={48}
                  height={48}
                  className="article-author-img"
                />
                <div>
                  <div className="article-author-name">{post.author.name}</div>
                  <div className="article-author-role">{post.author.role}</div>
                </div>
              </div>

              <div className="article-share-actions">
                <span className="article-share-label">Share:</span>
                <button
                  type="button"
                  onClick={shareOnWhatsApp}
                  className="article-share-btn wa-share"
                  title="Share on WhatsApp"
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={shareOnTwitter}
                  className="article-share-btn twitter-share"
                  title="Share on X / Twitter"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
                </button>
                <button
                  type="button"
                  onClick={shareOnLinkedIn}
                  className="article-share-btn linkedin-share"
                  title="Share on LinkedIn"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"></path></svg>
                </button>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="article-share-btn copy-share"
                  title="Copy link"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Share2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Article Body Content */}
        <div className="wr article-body-container">
          <article className="article-prose">
            {/* Introduction */}
            <div className="article-intro-box">
              <p className="article-lead-text">{post.content.introduction}</p>
            </div>

            {/* Content Sections */}
            {post.content.sections.map((sec, idx) => (
              <section key={idx} className="article-content-section">
                <h2 className="article-section-heading">{sec.heading}</h2>

                {sec.paragraphs.map((p, pIdx) => (
                  <p key={pIdx} className="article-paragraph">
                    {p}
                  </p>
                ))}

                {/* Key Takeaways Box */}
                {sec.keyTakeaways && sec.keyTakeaways.length > 0 && (
                  <div className="article-takeaways-box">
                    <div className="article-takeaways-header">
                      <Sparkles className="w-4 h-4 text-[#008744]" />
                      <span>Key Takeaways</span>
                    </div>
                    <ul className="article-takeaways-list">
                      {sec.keyTakeaways.map((item, tIdx) => (
                        <li key={tIdx} className="article-takeaway-item">
                          <span className="takeaway-bullet">✓</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Quote Callout */}
                {sec.quote && (
                  <blockquote className="article-quote-callout">
                    <p>&ldquo;{sec.quote}&rdquo;</p>
                  </blockquote>
                )}

                {/* Code or Template Snippet Box */}
                {sec.codeOrTemplate && (
                  <div className="article-template-box">
                    <div className="article-template-label">
                      <span>{sec.codeOrTemplate.label}</span>
                    </div>
                    <pre className="article-template-code">
                      <code>{sec.codeOrTemplate.content}</code>
                    </pre>
                  </div>
                )}
              </section>
            ))}

            {/* Conclusion */}
            <div className="article-conclusion-box">
              <h3 className="article-conclusion-title">Summary &amp; Next Steps</h3>
              <p>{post.content.conclusion}</p>
            </div>

            {/* In-Article Conversion Card */}
            <div className="article-cta-box">
              <div className="article-cta-badge">
                <Sparkles className="w-4 h-4" />
                <span>Ready to scale your WhatsApp revenue?</span>
              </div>
              <h3 className="article-cta-title">Start Automating with VaChat Today</h3>
              <p className="article-cta-subtitle">
                Join high-growth D2C brands automating support, broadcasts, and cart recovery in one unified platform.
              </p>
              <div className="article-cta-actions">
                <a href={APP_SIGNUP} className="vachat-pricing-btn">
                  <span>Start Free Trial</span>
                  <ArrowRight className="w-4 h-4 ml-2" />
                </a>
              </div>
            </div>
          </article>
        </div>

        {/* Related Posts */}
        {relatedPosts.length > 0 && (
          <section className="article-related-section">
            <div className="wr">
              <div className="article-related-header">
                <div className="blog-section-tag">
                  <BookOpen className="w-4 h-4 text-[#008744]" />
                  <span>Continue Reading</span>
                </div>
                <h2 className="article-related-title">Recommended Articles</h2>
              </div>

              <div className="blog-cards-grid">
                {relatedPosts.map((rPost) => (
                  <article key={rPost.slug} className="blog-card">
                    <div className="blog-card-inner">
                      <div className="blog-card-top">
                        <div className="blog-card-meta">
                          <span className="blog-category-tag">{rPost.category}</span>
                          <span className="blog-meta-item flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {rPost.readTime}
                          </span>
                        </div>
                        <h3 className="blog-card-title">
                          <Link href={`/blog/${rPost.slug}`}>{rPost.title}</Link>
                        </h3>
                        <p className="blog-card-excerpt">{rPost.excerpt}</p>
                      </div>

                      <div className="blog-card-bottom">
                        <div className="blog-card-footer">
                          <div className="blog-card-author">
                            <Image
                              src={rPost.author.avatar}
                              alt={rPost.author.name}
                              width={30}
                              height={30}
                              className="blog-author-avatar-sm"
                            />
                            <div className="blog-author-name-sm">{rPost.author.name}</div>
                          </div>
                          <Link href={`/blog/${rPost.slug}`} className="blog-card-link">
                            <span>Read</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        <FinalCTA />
      </main>

      <Footer />
      <WhatsAppWidget />
    </div>
  );
}
