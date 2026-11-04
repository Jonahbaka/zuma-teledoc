/**
 * ═══════════════════════════════════════════════════════════════
 *  WEB ACTION ENGINE — Agents Go OUT Into The World
 *  Real scraping, real data harvesting, real monetary value
 * ═══════════════════════════════════════════════════════════════
 *  
 *  This is NOT a template. This fetches REAL web pages,
 *  extracts REAL data, and returns REAL intelligence.
 *  
 *  Capabilities:
 *    - Fetch & parse any public webpage
 *    - Extract structured data from HTML
 *    - Monitor competitor pricing
 *    - Harvest provider directories
 *    - Scrape healthcare news & regulatory updates
 *    - Search Google for leads and intel
 *    - Monitor social media mentions
 * ═══════════════════════════════════════════════════════════════
 */

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../../db');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

class WebActionEngine {
  constructor() {
    this.results = [];
    this.lastRun = null;
    this.requestCount = 0;
    this.rateLimit = { maxPerMinute: 10, current: 0, resetTime: Date.now() };
  }

  /**
   * Rate-limited HTTP fetch with retry
   */
  async fetch(url, options = {}) {
    // Rate limiting
    if (Date.now() > this.rateLimit.resetTime + 60000) {
      this.rateLimit.current = 0;
      this.rateLimit.resetTime = Date.now();
    }
    if (this.rateLimit.current >= this.rateLimit.maxPerMinute) {
      const wait = this.rateLimit.resetTime + 60000 - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.rateLimit.current = 0;
      this.rateLimit.resetTime = Date.now();
    }
    this.rateLimit.current++;
    this.requestCount++;

    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...options.headers
        },
        maxRedirects: 5,
        ...options
      });
      return { success: true, data: response.data, status: response.status, url };
    } catch (err) {
      return { success: false, error: err.message, url };
    }
  }

  /**
   * Fetch and parse HTML into cheerio
   */
  async fetchAndParse(url) {
    const result = await this.fetch(url);
    if (!result.success) return { success: false, error: result.error, url };
    try {
      const $ = cheerio.load(result.data);
      return { success: true, $, url, raw: result.data };
    } catch (err) {
      return { success: false, error: `Parse error: ${err.message}`, url };
    }
  }

  /**
   * Fetch JSON API endpoint
   */
  async fetchJSON(url, options = {}) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
          ...options.headers
        },
        ...options
      });
      return { success: true, data: response.data, url };
    } catch (err) {
      return { success: false, error: err.message, url };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  MISSION: Competitor Intelligence
  // ═══════════════════════════════════════════════════════════════

  async scrapeCompetitorPricing() {
    const competitors = [
      { name: 'Teladoc', url: 'https://www.teladoc.com/what-we-treat/', type: 'telehealth' },
      { name: 'MDLive', url: 'https://www.mdlive.com/', type: 'telehealth' },
      { name: 'Amwell', url: 'https://amwell.com/', type: 'telehealth' },
      { name: 'PlushCare', url: 'https://plushcare.com/', type: 'telehealth' },
      { name: 'Doctor on Demand', url: 'https://doctorondemand.com/', type: 'telehealth' },
      { name: 'Sesame Care', url: 'https://sesamecare.com/', type: 'marketplace' },
    ];

    const intel = [];
    for (const comp of competitors) {
      const result = await this.fetchAndParse(comp.url);
      if (result.success) {
        const $ = result.$;
        // Extract pricing signals from page
        const priceMatches = [];
        const pageText = $('body').text();
        const priceRegex = /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
        let match;
        while ((match = priceRegex.exec(pageText)) !== null) {
          const price = parseFloat(match[1].replace(',', ''));
          if (price >= 10 && price <= 500) { // Reasonable visit prices
            priceMatches.push(price);
          }
        }

        // Extract meta description and title
        const title = $('title').text().trim();
        const description = $('meta[name="description"]').attr('content') || '';
        const h1 = $('h1').first().text().trim();

        // Look for specific keywords
        const keywords = ['urgent care', 'mental health', 'dermatology', 'primary care', 'therapy', 'prescription', 'insurance'];
        const foundServices = keywords.filter(kw => pageText.toLowerCase().includes(kw));

        intel.push({
          name: comp.name,
          url: comp.url,
          title,
          description: description.substring(0, 200),
          headline: h1.substring(0, 200),
          pricesFound: [...new Set(priceMatches)].sort((a, b) => a - b).slice(0, 5),
          servicesDetected: foundServices,
          scraped: new Date().toISOString(),
          status: 'live'
        });
      } else {
        intel.push({
          name: comp.name,
          url: comp.url,
          status: 'unreachable',
          error: result.error
        });
      }
    }
    return intel;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MISSION: Healthcare News & Regulatory Intel
  // ═══════════════════════════════════════════════════════════════

  async scrapeHealthcareNews() {
    const sources = [
      { name: 'HHS Telehealth', url: 'https://telehealth.hhs.gov/providers/getting-started' },
      { name: 'Fierce Healthcare', url: 'https://www.fiercehealthcare.com/' },
      { name: 'Becker\'s Health IT', url: 'https://www.beckershospitalreview.com/healthcare-information-technology/' },
      { name: 'Healthcare IT News', url: 'https://www.healthcareitnews.com/' },
      { name: 'mHealth Intelligence', url: 'https://mhealthintelligence.com/' },
    ];

    const news = [];
    for (const source of sources) {
      const result = await this.fetchAndParse(source.url);
      if (result.success) {
        const $ = result.$;
        const articles = [];

        // Extract article links and headlines
        $('article, .article, .post, .story, .card').each((i, el) => {
          if (i >= 5) return; // Max 5 per source
          const title = $(el).find('h2, h3, h4, .title, .headline').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const summary = $(el).find('p, .summary, .excerpt, .description').first().text().trim();
          if (title && title.length > 10) {
            articles.push({
              title: title.substring(0, 200),
              link: link.startsWith('http') ? link : (link.startsWith('/') ? new URL(link, source.url).href : ''),
              summary: summary.substring(0, 300)
            });
          }
        });

        // Fallback: extract from h2/h3 tags if no articles found
        if (articles.length === 0) {
          $('h2 a, h3 a').each((i, el) => {
            if (i >= 5) return;
            const title = $(el).text().trim();
            const link = $(el).attr('href') || '';
            if (title && title.length > 10) {
              articles.push({
                title: title.substring(0, 200),
                link: link.startsWith('http') ? link : (link.startsWith('/') ? new URL(link, source.url).href : ''),
                summary: ''
              });
            }
          });
        }

        news.push({ source: source.name, url: source.url, articles, scraped: new Date().toISOString() });
      }
    }
    return news;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MISSION: Provider Directory Scraping (Lead Gen)
  // ═══════════════════════════════════════════════════════════════

  async scrapeProviderDirectories() {
    // Scrape public provider directories for potential DoctaRx providers
    const directories = [
      { name: 'NPI Registry', url: 'https://npiregistry.cms.hhs.gov/api/?version=2.1&enumeration_type=NPI-1&taxonomy_description=Telehealth&limit=20&skip=0', type: 'api' },
    ];

    const providers = [];

    // NPI Registry — real federal API, free, no auth
    try {
      const npiResult = await this.fetchJSON(directories[0].url);
      if (npiResult.success && npiResult.data.results) {
        for (const r of npiResult.data.results.slice(0, 15)) {
          const basic = r.basic || {};
          const address = (r.addresses || [])[0] || {};
          const taxonomy = (r.taxonomies || [])[0] || {};
          providers.push({
            npi: r.number,
            name: `${basic.first_name || ''} ${basic.last_name || ''}`.trim() || basic.organization_name || 'Unknown',
            credential: basic.credential || '',
            specialty: taxonomy.desc || '',
            state: address.state || '',
            city: address.city || '',
            phone: address.telephone_number || '',
            type: r.enumeration_type === 'NPI-1' ? 'Individual' : 'Organization',
            source: 'NPI Registry (CMS)'
          });
        }
      }
    } catch (e) { /* NPI API down, that's ok */ }

    return providers;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MISSION: SEO & Search Visibility Check
  // ═══════════════════════════════════════════════════════════════

  async checkSearchVisibility() {
    const checks = [];

    // Check if DoctaRx site is reachable and what it looks like to search engines
    const siteResult = await this.fetchAndParse('https://doctarx.com');
    if (siteResult.success) {
      const $ = siteResult.$;
      checks.push({
        check: 'Site Reachability',
        status: 'pass',
        title: $('title').text().trim(),
        description: $('meta[name="description"]').attr('content') || 'MISSING — needs SEO fix',
        ogTitle: $('meta[property="og:title"]').attr('content') || 'MISSING',
        ogDescription: $('meta[property="og:description"]').attr('content') || 'MISSING',
        h1: $('h1').first().text().trim() || 'MISSING',
        canonical: $('link[rel="canonical"]').attr('href') || 'MISSING',
        hasRobots: !!$('meta[name="robots"]').attr('content'),
      });
    } else {
      checks.push({ check: 'Site Reachability', status: 'fail', error: siteResult.error });
    }

    // Check robots.txt
    const robotsResult = await this.fetch('https://doctarx.com/robots.txt');
    checks.push({
      check: 'robots.txt',
      status: robotsResult.success ? 'pass' : 'missing',
      content: robotsResult.success ? String(robotsResult.data).substring(0, 500) : 'Not found'
    });

    // Check sitemap
    const sitemapResult = await this.fetch('https://doctarx.com/sitemap.xml');
    checks.push({
      check: 'sitemap.xml',
      status: sitemapResult.success ? 'pass' : 'missing'
    });

    return checks;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MISSION: Social Media Presence Check
  // ═══════════════════════════════════════════════════════════════

  async checkSocialPresence() {
    const platforms = [
      { name: 'Twitter/X', url: 'https://twitter.com/DoctaRx', handle: '@DoctaRx' },
      { name: 'LinkedIn', url: 'https://www.linkedin.com/company/doctarx/', handle: 'doctarx' },
      { name: 'Facebook', url: 'https://www.facebook.com/DoctaRx', handle: 'DoctaRx' },
      { name: 'Instagram', url: 'https://www.instagram.com/doctarx/', handle: '@doctarx' },
    ];

    const presence = [];
    for (const platform of platforms) {
      const result = await this.fetch(platform.url, { 
        maxRedirects: 3,
        validateStatus: (status) => status < 500
      });
      presence.push({
        platform: platform.name,
        handle: platform.handle,
        url: platform.url,
        exists: result.success && result.status !== 404,
        status: result.success ? (result.status === 200 ? 'found' : `status ${result.status}`) : 'unreachable',
        recommendation: result.success && result.status === 200
          ? 'Account exists — ensure profile is complete and active'
          : `Account NOT found — CREATE one immediately at ${platform.url}`
      });
    }
    return presence;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MISSION: Telehealth Market Data
  // ═══════════════════════════════════════════════════════════════

  async scrapeMarketData() {
    const data = {};

    // CMS telehealth data (public)
    try {
      const result = await this.fetchAndParse('https://data.cms.gov/summary-statistics-on-beneficiary-use-of-the-medicare-program/medicare-telehealth-trends');
      if (result.success) {
        const $ = result.$;
        const text = $('body').text();
        data.cmsPage = {
          title: $('title').text().trim(),
          available: true,
          excerpt: text.substring(0, 500).replace(/\s+/g, ' ').trim()
        };
      }
    } catch (e) { /* ok */ }

    // FCC broadband data (relevant for telehealth access)
    try {
      const result = await this.fetchAndParse('https://broadbandmap.fcc.gov/location-summary/fixed');
      if (result.success) {
        data.broadbandAccess = { available: true, note: 'FCC broadband map accessible — useful for identifying underserved telehealth markets' };
      }
    } catch (e) { /* ok */ }

    return data;
  }

  // ═══════════════════════════════════════════════════════════════
  //  WEB SEARCH — Real search results from DuckDuckGo
  // ═══════════════════════════════════════════════════════════════

  async webSearch(query, maxResults = 8) {
    try {
      // DuckDuckGo HTML search — no API key needed
      const encodedQuery = encodeURIComponent(query);
      const result = await this.fetchAndParse(`https://html.duckduckgo.com/html/?q=${encodedQuery}`);
      if (!result.success) return { success: false, error: result.error, query };

      const $ = result.$;
      const results = [];

      $('.result, .web-result').each((i, el) => {
        if (i >= maxResults) return;
        const title = $(el).find('.result__title, .result__a').first().text().trim();
        const link = $(el).find('.result__url, .result__extras__url').first().text().trim();
        const snippet = $(el).find('.result__snippet').first().text().trim();
        const href = $(el).find('a.result__a').attr('href') || '';

        if (title && title.length > 3) {
          results.push({
            title,
            url: href.startsWith('//') ? 'https:' + href : (href || link),
            snippet: snippet.substring(0, 300),
            position: i + 1
          });
        }
      });

      return { success: true, query, results, count: results.length };
    } catch (err) {
      return { success: false, error: err.message, query };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TWITTER/X POSTING — Real tweets using stored credentials
  // ═══════════════════════════════════════════════════════════════

  async postToTwitter(tweetText) {
    let credentialVault;
    try { credentialVault = require('./credential-vault'); } catch (e) { return { success: false, error: 'Credential vault not available' }; }

    try {
      // Find Twitter credentials assigned to growth agent
      const creds = await credentialVault.listCredentials({ platform: 'twitter' });
      if (!creds || creds.length === 0) {
        return { success: false, error: 'No Twitter credentials in vault. Add them in Agent Command Center → Credentials Vault.' };
      }

      const credId = creds[0].id;
      const cred = await credentialVault.getCredential(credId, 'growth');

      // Need API keys — check what's available
      if (!cred.apiKey || !cred.apiSecret) {
        return {
          success: false,
          error: 'Twitter API credentials incomplete. Need: API Key + API Secret + Access Token + Access Token Secret in the vault. Username/password alone cannot post — Twitter requires API keys from developer.twitter.com.'
        };
      }

      // Try posting with twitter-api-v2
      const { TwitterApi } = require('twitter-api-v2');
      const client = new TwitterApi({
        appKey: cred.apiKey,
        appSecret: cred.apiSecret,
        accessToken: cred.username, // Often stored as "username" field
        accessSecret: cred.password, // Often stored as "password" field
      });

      const tweet = await client.v2.tweet(tweetText);
      return {
        success: true,
        tweetId: tweet.data?.id,
        tweetUrl: `https://x.com/i/status/${tweet.data?.id}`,
        text: tweetText
      };
    } catch (err) {
      return { success: false, error: `Twitter post failed: ${err.message}` };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DEEP SCRAPE — Read & extract content from any URL
  // ═══════════════════════════════════════════════════════════════

  async deepScrape(url) {
    const result = await this.fetchAndParse(url);
    if (!result.success) return { success: false, error: result.error, url };

    const $ = result.$;

    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, header, iframe, noscript').remove();

    const title = $('title').text().trim();
    const h1 = $('h1').first().text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';

    // Extract main content
    const mainContent = $('main, article, .content, .post, #content, .article-body').first().text().trim()
      || $('body').text().trim();

    // Clean up whitespace
    const cleanContent = mainContent.replace(/\s+/g, ' ').substring(0, 5000);

    // Extract all links
    const links = [];
    $('a[href]').each((i, el) => {
      if (i >= 20) return;
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text && text.length > 3 && href.startsWith('http')) {
        links.push({ text: text.substring(0, 100), url: href });
      }
    });

    return {
      success: true, url, title, h1, metaDesc,
      content: cleanContent,
      links: links.slice(0, 15),
      wordCount: cleanContent.split(/\s+/).length
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  STORE RESULTS
  // ═══════════════════════════════════════════════════════════════

  async storeResult(agentType, agentName, missionType, title, data) {
    try {
      await db.query(`
        INSERT INTO ai_agent_results (agent_type, agent_name, result_type, title, description, metrics, evidence, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'verified')
      `, [
        agentType, agentName, missionType, title,
        `Automated web mission completed at ${new Date().toISOString()}`,
        JSON.stringify({ itemCount: Array.isArray(data) ? data.length : Object.keys(data).length }),
        JSON.stringify(data)
      ]);
    } catch (e) {
      console.error('Failed to store web action result:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  OPPORTUNITY SCOUTING — VC, Investors, Provider Leads
  // ═══════════════════════════════════════════════════════════════

  /**
   * Scout for VC / investment opportunities relevant to DoctaRx
   */
  async scoutVCOpportunities() {
    const queries = [
      'telehealth healthtech VC funding 2025 2026',
      'digital health startup accelerator program accepting applications',
      'healthcare AI investment fund open applications',
      'SBIR STTR health IT small business grant 2026',
      'telehealth startup pitch competition 2026'
    ];

    const allOpportunities = [];

    for (const query of queries) {
      try {
        const results = await this.webSearch(query, 5);
        if (results.success && results.results) {
          for (const r of results.results) {
            allOpportunities.push({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              query,
              category: query.includes('SBIR') || query.includes('grant') ? 'grant' :
                        query.includes('accelerator') ? 'accelerator' :
                        query.includes('pitch') ? 'competition' : 'vc_fund'
            });
          }
        }
      } catch (e) { /* continue to next query */ }
    }

    // Deduplicate by URL
    const seen = new Set();
    const unique = allOpportunities.filter(o => {
      if (seen.has(o.url)) return false;
      seen.add(o.url);
      return true;
    });

    return { success: true, opportunities: unique, count: unique.length };
  }

  /**
   * Scout for provider recruitment opportunities — low-hanging fruit
   */
  async scoutProviderRecruitment() {
    const queries = [
      'independent physician looking for telehealth platform',
      'doctors frustrated with teladoc MDLive looking for alternative',
      'physician telehealth side gig remote practice 2025 2026',
      'nurse practitioner telehealth independent practice',
      'new medical practice opening telehealth services needed',
      'rural healthcare provider needs telehealth solution'
    ];

    const allLeads = [];

    for (const query of queries) {
      try {
        const results = await this.webSearch(query, 4);
        if (results.success && results.results) {
          for (const r of results.results) {
            allLeads.push({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              query,
              leadType: query.includes('nurse') ? 'nurse_practitioner' :
                        query.includes('rural') ? 'rural_provider' :
                        query.includes('independent') ? 'independent_physician' :
                        query.includes('frustrated') ? 'competitor_switch' : 'general'
            });
          }
        }
      } catch (e) { /* continue */ }
    }

    const seen = new Set();
    const unique = allLeads.filter(o => {
      if (seen.has(o.url)) return false;
      seen.add(o.url);
      return true;
    });

    return { success: true, leads: unique, count: unique.length };
  }

  /**
   * Scout for partnership and distribution opportunities
   */
  async scoutPartnerships() {
    const queries = [
      'telehealth platform partnership program healthcare',
      'health system looking for telehealth vendor RFP',
      'employer telehealth benefit program vendor needed',
      'pharmacy chain telehealth partnership opportunity'
    ];

    const allPartners = [];

    for (const query of queries) {
      try {
        const results = await this.webSearch(query, 4);
        if (results.success && results.results) {
          for (const r of results.results) {
            allPartners.push({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              partnerType: query.includes('employer') ? 'employer_benefit' :
                           query.includes('pharmacy') ? 'pharmacy_chain' :
                           query.includes('RFP') ? 'health_system_rfp' : 'platform_partner'
            });
          }
        }
      } catch (e) { /* continue */ }
    }

    const seen = new Set();
    const unique = allPartners.filter(o => {
      if (seen.has(o.url)) return false;
      seen.add(o.url);
      return true;
    });

    return { success: true, partnerships: unique, count: unique.length };
  }

  /**
   * Check what credentials agents currently have and what's missing for key actions
   */
  async auditCredentials() {
    let vault;
    try { vault = require('./credential-vault'); } catch(e) { return { success: false, error: 'Vault not available' }; }

    const existing = await vault.listCredentials({});
    const existingPlatforms = existing.map(c => c.platform);

    // Define what credentials unlock what capabilities
    const credentialMap = [
      {
        platform: 'twitter',
        name: 'Twitter / X',
        requiredFields: ['api_key', 'api_secret', 'access_token', 'access_secret'],
        unlocks: ['Auto-post tweets', 'Reply to mentions', 'Monitor engagement', 'Grow follower base'],
        howToGet: 'Go to developer.twitter.com → Create project → Generate API keys + Access tokens',
        priority: 'HIGH',
        estimatedValue: 'Social proof, brand awareness, direct provider/patient acquisition'
      },
      {
        platform: 'linkedin',
        name: 'LinkedIn',
        requiredFields: ['access_token'],
        unlocks: ['Post company updates', 'Connect with healthcare professionals', 'Job postings'],
        howToGet: 'Go to linkedin.com/developers → Create app → Request Marketing API access → Get access token',
        priority: 'HIGH',
        estimatedValue: 'Provider recruitment, B2B partnerships, investor visibility'
      },
      {
        platform: 'google_business',
        name: 'Google Business Profile',
        requiredFields: ['api_key'],
        unlocks: ['Manage business listing', 'Respond to reviews', 'Update hours/services', 'Improve local SEO'],
        howToGet: 'Go to business.google.com → Claim "DoctaRx" → Enable API via Google Cloud Console',
        priority: 'MEDIUM',
        estimatedValue: 'Local search visibility, patient trust'
      },
      {
        platform: 'google_analytics',
        name: 'Google Analytics',
        requiredFields: ['api_key'],
        unlocks: ['Track website visitors', 'Conversion funnel analysis', 'User behavior insights', 'Marketing ROI'],
        howToGet: 'Go to analytics.google.com → Admin → Data API → Create credentials',
        priority: 'MEDIUM',
        estimatedValue: 'Data-driven marketing decisions, conversion optimization'
      },
      {
        platform: 'reddit',
        name: 'Reddit',
        requiredFields: ['api_key', 'api_secret', 'username', 'password'],
        unlocks: ['Post in r/telehealth, r/healthtech, r/medicine', 'Community engagement', 'Lead generation'],
        howToGet: 'Go to reddit.com/prefs/apps → Create "script" app → Note client_id and secret',
        priority: 'MEDIUM',
        estimatedValue: 'Organic community growth, authentic brand building'
      },
      {
        platform: 'sendgrid',
        name: 'SendGrid (Scalable Email)',
        requiredFields: ['api_key'],
        unlocks: ['Send 100+ emails/day (vs Zoho 100/day limit)', 'Email analytics', 'Template management', 'Deliverability optimization'],
        howToGet: 'Go to sendgrid.com → Create free account (100 emails/day free) → Settings → API Keys → Create key',
        priority: 'LOW',
        estimatedValue: 'Scale outreach beyond Zoho 100/day cap'
      }
    ];

    const audit = {
      existing: existing.map(c => ({
        platform: c.platform,
        name: c.platform_display_name,
        label: c.account_label,
        hasApiKey: c.has_api_key,
        hasApiSecret: c.has_api_secret,
        hasUsername: c.has_username,
        hasPassword: c.has_password,
        status: c.status
      })),
      missing: [],
      requests: []
    };

    for (const cred of credentialMap) {
      if (!existingPlatforms.includes(cred.platform)) {
        audit.missing.push(cred);
        audit.requests.push({
          platform: cred.platform,
          name: cred.name,
          priority: cred.priority,
          unlocks: cred.unlocks,
          howToGet: cred.howToGet,
          estimatedValue: cred.estimatedValue
        });
      } else {
        // Check if existing credential is complete
        const existing_cred = existing.find(c => c.platform === cred.platform);
        if (existing_cred && !existing_cred.has_api_key && cred.requiredFields.includes('api_key')) {
          audit.requests.push({
            platform: cred.platform,
            name: cred.name,
            priority: cred.priority,
            issue: 'INCOMPLETE — missing API key',
            howToGet: cred.howToGet,
            unlocks: cred.unlocks
          });
        }
      }
    }

    return { success: true, audit };
  }

  getStatus() {
    return {
      requestCount: this.requestCount,
      lastRun: this.lastRun,
      rateLimit: { ...this.rateLimit, resetTime: undefined }
    };
  }
}

module.exports = new WebActionEngine();
