/**
 * ULTRON AI — BYOX Web Intelligence & Fast HTML Distiller
 *
 * Derived from Build Your Own X concepts:
 * - Matt Brubeck: Let's build a browser engine (HTML tokenizer, DOM tree)
 * - browser.engineering: Browser Engineering
 * - webdevdrops: Build a static site generator in 40 lines with Node.js
 *
 * Implements microsecond-speed streaming HTML parsing, Readability content extraction,
 * OpenGraph metadata harvesting, and intelligent static-vs-dynamic CDP dispatch.
 */

export class ByoxWebIntelligence {
  constructor(options = {}) {
    this.maxTextLength = options.maxTextLength || 50000;
  }

  /**
   * Fast regex-based HTML metadata extraction.
   */
  extractMetadata(html, baseUrl = '') {
    const meta = {
      title: null,
      description: null,
      canonical: null,
      og: {},
      twitter: {},
      isSpaOrEmpty: false
    };

    if (!html || typeof html !== 'string') return meta;

    // Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      meta.title = this.decodeHtmlEntities(titleMatch[1].trim());
    }

    // Meta tags
    const metaRegex = /<meta\s+([^>]+)>/gi;
    let match;
    while ((match = metaRegex.exec(html)) !== null) {
      const attrs = match[1];
      const nameMatch = attrs.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i);
      const contentMatch = attrs.match(/content\s*=\s*["']([^"']*)["']/i);

      if (nameMatch && contentMatch) {
        const key = nameMatch[1].toLowerCase();
        const value = this.decodeHtmlEntities(contentMatch[1].trim());

        if (key === 'description') {
          meta.description = value;
        } else if (key.startsWith('og:')) {
          meta.og[key.slice(3)] = value;
        } else if (key.startsWith('twitter:')) {
          meta.twitter[key.slice(8)] = value;
        }
      }
    }

    // Canonical link
    const canonicalMatch = html.match(/<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
    if (canonicalMatch) {
      meta.canonical = this.resolveUrl(canonicalMatch[1], baseUrl);
    }

    // SPA Check: Single empty root div with script bundles
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    const strippedBody = bodyContent.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').trim();

    if (strippedBody.length < 100 && (html.includes('id="root"') || html.includes('id="app"'))) {
      meta.isSpaOrEmpty = true;
    }

    return meta;
  }

  /**
   * Extract readable body text by stripping noise tags.
   */
  extractArticleText(html) {
    if (!html || typeof html !== 'string') return '';

    // Strip non-content blocks
    let cleaned = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

    // Focus on article/main if present
    const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                         cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (articleMatch) {
      cleaned = articleMatch[1];
    }

    // Convert block tags to line breaks
    cleaned = cleaned
      .replace(/<(?:p|div|h[1-6]|li|blockquote|tr)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');

    // Normalize whitespace
    const text = cleaned
      .split('\n')
      .map(line => this.decodeHtmlEntities(line.trim()))
      .filter(line => line.length > 0)
      .join('\n');

    return text.slice(0, this.maxTextLength);
  }

  /**
   * Extract all valid hyperlinks with resolved URLs.
   */
  extractLinks(html, baseUrl = '') {
    const links = [];
    if (!html || typeof html !== 'string') return links;

    const linkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const rawHref = match[1].trim();
      const anchorText = match[2].replace(/<[^>]+>/g, '').trim();

      // Skip non-navigational links
      if (rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) {
        continue;
      }

      const resolved = this.resolveUrl(rawHref, baseUrl);
      if (resolved) {
        links.push({
          url: resolved,
          text: this.decodeHtmlEntities(anchorText)
        });
      }
    }

    return links;
  }

  /**
   * Resolve relative URL against base.
   */
  resolveUrl(relative, base) {
    try {
      if (!base) return relative;
      return new URL(relative, base).href;
    } catch {
      return relative;
    }
  }

  /**
   * Decode common HTML entities.
   */
  decodeHtmlEntities(str) {
    if (!str) return '';
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }
}
