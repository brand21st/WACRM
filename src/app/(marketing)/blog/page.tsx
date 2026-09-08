"use client";

import React, { useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { Search, Calendar, Clock, ArrowRight, Sparkles, BookOpen, Tag, CheckCircle2, Mail } from "lucide-react";
import Header from "@/components/marketing/Header";
import Footer from "@/components/marketing/Footer";
import MagicBar from "@/components/marketing/MagicBar";
import FinalCTA from "@/components/marketing/FinalCTA";
import WhatsAppWidget from "@/components/marketing/WhatsAppWidget";
import { getAllPosts, getFeaturedPost, BlogPost } from "@/lib/blog/posts";

const CATEGORIES = [
  "All",
  "WhatsApp Marketing",
  "AI & Voice Automation",
  "Shopify & E-Commerce",
  "Guides & Best Practices",
] as const;

export default function BlogIndexPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const allPosts = useMemo(() => getAllPosts(), []);
  const featuredPost = useMemo(() => getFeaturedPost(), []);

  const filteredPosts = useMemo(() => {
    return allPosts.filter((post) => {
      const matchesCategory =
        selectedCategory === "All" || post.category === selectedCategory;
      const matchesSearch =
        post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        post.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        post.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [allPosts, selectedCategory, searchQuery]);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (newsletterEmail.trim()) {
      setSubscribed(true);
      setNewsletterEmail("");
    }
  };

  return (
    <div className="marketing-page-wrapper">
      <MagicBar isMenuOpen={isMenuOpen} />
      <Header onMenuToggle={(open) => setIsMenuOpen(open)} />

      <main className="blog-main-wrapper">
        {/* Blog Hero Section */}
        <section className="blog-hero-section">
          <div className="wr">
            <div className="blog-hero-content">
              <div className="blog-hero-pill">
                <Sparkles className="w-4 h-4 text-[#008744]" />
                <span>Insights, Playbooks &amp; Growth Strategies</span>
              </div>
              <h1 className="blog-hero-title">
                The <span className="vachat-brand-text">WhatsApp Growth</span> Hub
              </h1>
              <p className="blog-hero-subtitle">
                Actionable guides, conversion teardowns, and tactical CRM workflows to help you scale revenue on WhatsApp.
              </p>

              {/* Search Bar */}
              <div className="blog-search-container">
                <div className="blog-search-wrapper">
                  <Search className="blog-search-icon" />
                  <input
                    type="text"
                    placeholder="Search articles by topic, keywords, or feature..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="blog-search-input"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="blog-search-clear"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Category Pills */}
              <div className="blog-category-chips-wrapper" role="tablist" aria-label="Article categories">
                {CATEGORIES.map((cat) => {
                  const isActive = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`blog-category-chip ${isActive ? "active" : ""}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Featured Post Banner (Visible when on 'All' and no search filter) */}
        {selectedCategory === "All" && !searchQuery && featuredPost && (
          <section className="blog-featured-section">
            <div className="wr">
              <div className="blog-section-tag">
                <BookOpen className="w-4 h-4 text-[#008744]" />
                <span>Featured Masterclass</span>
              </div>
              <div className="blog-featured-card">
                <div className="blog-featured-content">
                  <div className="blog-card-meta">
                    <span className="blog-category-tag">{featuredPost.category}</span>
                    <span className="blog-meta-divider">•</span>
                    <span className="blog-meta-item flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {featuredPost.readTime}
                    </span>
                    <span className="blog-meta-divider">•</span>
                    <span className="blog-meta-item flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {featuredPost.publishedAt}
                    </span>
                  </div>

                  <h2 className="blog-featured-title">
                    <Link href={`/blog/${featuredPost.slug}`} className="hover:text-[#008744] transition-colors">
                      {featuredPost.title}
                    </Link>
                  </h2>

                  <p className="blog-featured-excerpt">{featuredPost.excerpt}</p>

                  <div className="blog-featured-footer">
                    <div className="blog-author-info">
                      <Image
                        src={featuredPost.author.avatar}
                        alt={featuredPost.author.name}
                        width={42}
                        height={42}
                        className="blog-author-avatar"
                      />
                      <div>
                        <div className="blog-author-name">{featuredPost.author.name}</div>
                        <div className="blog-author-role">{featuredPost.author.role}</div>
                      </div>
                    </div>

                    <Link href={`/blog/${featuredPost.slug}`} className="blog-read-btn">
                      <span>Read Article</span>
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Articles Grid */}
        <section className="blog-grid-section">
          <div className="wr">
            <div className="blog-grid-header flex justify-between items-center mb-8">
              <h2 className="blog-grid-title">
                {selectedCategory === "All" ? "Latest Articles" : selectedCategory}
              </h2>
              <span className="blog-grid-count">
                Showing {filteredPosts.length} article{filteredPosts.length === 1 ? "" : "s"}
              </span>
            </div>

            {filteredPosts.length === 0 ? (
              <div className="blog-empty-state">
                <div className="blog-empty-icon">🔍</div>
                <h3>No articles found</h3>
                <p>We couldn&apos;t find any posts matching &ldquo;{searchQuery}&rdquo;. Try another search term or category.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCategory("All");
                  }}
                  className="blog-empty-reset-btn"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="blog-cards-grid">
                {filteredPosts.map((post) => (
                  <article key={post.slug} className="blog-card">
                    <div className="blog-card-inner">
                      <div className="blog-card-top">
                        <div className="blog-card-meta">
                          <span className="blog-category-tag">{post.category}</span>
                          <span className="blog-meta-item flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {post.readTime}
                          </span>
                        </div>

                        <h3 className="blog-card-title">
                          <Link href={`/blog/${post.slug}`}>
                            {post.title}
                          </Link>
                        </h3>

                        <p className="blog-card-excerpt">{post.excerpt}</p>
                      </div>

                      <div className="blog-card-bottom">
                        <div className="blog-card-tags">
                          {post.tags.slice(0, 2).map((t) => (
                            <span key={t} className="blog-tag-pill">
                              <Tag className="w-2.5 h-2.5" />
                              {t}
                            </span>
                          ))}
                        </div>

                        <div className="blog-card-footer">
                          <div className="blog-card-author">
                            <Image
                              src={post.author.avatar}
                              alt={post.author.name}
                              width={32}
                              height={32}
                              className="blog-author-avatar-sm"
                            />
                            <div className="blog-author-name-sm">{post.author.name}</div>
                          </div>

                          <Link href={`/blog/${post.slug}`} className="blog-card-link" aria-label={`Read ${post.title}`}>
                            <span>Read</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Newsletter Capture Section */}
        <section className="blog-newsletter-section">
          <div className="wr">
            <div className="blog-newsletter-box">
              <div className="blog-newsletter-content">
                <div className="blog-newsletter-icon-wrap">
                  <Mail className="w-6 h-6 text-[#008744]" />
                </div>
                <h3 className="blog-newsletter-title">Join 15,000+ Growth Leaders</h3>
                <p className="blog-newsletter-desc">
                  Get our bi-weekly breakdown of high-performing WhatsApp automations, Shopify tips, and copy templates. No spam, ever.
                </p>

                {subscribed ? (
                  <div className="blog-newsletter-success">
                    <CheckCircle2 className="w-5 h-5 text-[#008744]" />
                    <span>You&apos;re in! Check your inbox for our 2026 WhatsApp Playbook.</span>
                  </div>
                ) : (
                  <form onSubmit={handleSubscribe} className="blog-newsletter-form">
                    <input
                      type="email"
                      required
                      placeholder="Enter your work email..."
                      value={newsletterEmail}
                      onChange={(e) => setNewsletterEmail(e.target.value)}
                      className="blog-newsletter-input"
                    />
                    <button type="submit" className="blog-newsletter-btn">
                      Subscribe Free
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Final Conversion CTA */}
        <FinalCTA />
      </main>

      <Footer />
      <WhatsAppWidget />
    </div>
  );
}
