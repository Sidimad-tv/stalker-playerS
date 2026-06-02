class StalkerClient {
    constructor(portalUrl, mac) {
        // Ensure URL ends with /server/load.php or at least correct base
        // Common format: http://example.com/c/ -> http://example.com/c/server/load.php
        // Or: http://example.com/stalker_portal/c/ -> ...
        this.portalUrl = this._normalizeUrl(portalUrl);
        this.mac = mac;
        this.token = null;
        // Basic properties to mimic a STB
        this.params = {
            type: 'stb',
            action: '',
            handshake: '1', // default request
            token: '',
            // headers often needed by portals
            mac: mac,
            stb_type: 'MAG250',
            sn: '0000000000000', // Serial Number
            device_id: '00000000000000000000000000000000', // Sig?
            device_id2: '00000000000000000000000000000000',
            signature: '00000000000000000000000000000000',
            auth_second_step: 0,
            hw_version: '1.0',
            not_valid_token: 0
        };
        this.cookies = ""; // In browser we might rely on native cookies or custom header workaround if needed
        this.requestCount = 0; // Track request count to skip delay on first request
    }

    _normalizeUrl(url) {
        return url.replace(/\/+$/, "");
    }

    async _resolveBase(rawUrl) {
        const normalized = rawUrl.replace(/\/+$/, "");
        if (normalized.match(/\/[^/]+\.php$/)) return normalized;

        const urlObj = new URL(normalized);
        const origin = urlObj.origin;
        const path = urlObj.pathname.replace(/\/+$/, "");

        let candidates = [];
        if (path && path !== "/") {
            candidates.push(origin + path + "/server/load.php");
            candidates.push(origin + path + "/portal.php");
            candidates.push(origin + path + "/load.php");
            candidates.push(origin + path + "/c/portal.php");
        }
        candidates.push(origin + "/server/load.php");
        candidates.push(origin + "/portal.php");
        candidates.push(origin + "/stalker_portal/server/load.php");
        candidates.push(origin + "/c/portal.php");

        const seen = new Set();
        const uniq = [];
        for (const c of candidates) {
            if (!seen.has(c)) { seen.add(c); uniq.push(c); }
        }

        var hostname = window.location.hostname;
        var isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

        for (const c of uniq) {
            try {
                var testUrl = c + "?type=stb&prehash=0&action=handshake";
                var resp;
                if (isLocal) {
                    resp = await fetch(testUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
                } else {
                    resp = await fetch('/api/stalker/proxy?url=' + encodeURIComponent(testUrl) + '&mac=' + encodeURIComponent(this.mac), { signal: AbortSignal.timeout(8000) });
                }
                if (!resp.ok) continue;
                var text = await resp.text();
                var data = JSON.parse(text);
                var token = (data.js && data.js.token) || data.token;
                if (token) { console.log('[Stalker] Base resolved:', c); return c; }
            } catch(e) {}
        }

        return normalized + "/server/load.php";
    }

    async _request(action, extraParams = {}) {
        var urlObj = new URL(this.portalUrl);

        // Build query params (mac/token go in headers, not URL)
        var params = { action: action };
        for (var key in extraParams) {
            if (extraParams.hasOwnProperty(key)) params[key] = extraParams[key];
        }

        for (var key in params) {
            if (params.hasOwnProperty(key)) urlObj.searchParams.append(key, params[key]);
        }

        var requestUrl = urlObj.toString();
        console.log('[Stalker] Calling ' + action);

        this.requestCount++;

        try {
            // On live sites (Vercel/Netlify), proxy through Vercel to avoid CORS/mixed-content
            var hostname = window.location.hostname;
            var isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
            var response;
            if (!isLocal) {
                var proxyBase = hostname.indexOf('vercel') !== -1 ? '' : 'https://stalker-p.vercel.app';
                var proxyUrl = proxyBase + '/api/stalker/proxy?url=' + encodeURIComponent(requestUrl) + '&mac=' + encodeURIComponent(this.mac);
                if (this.token) proxyUrl += '&token=' + encodeURIComponent(this.token);
                response = await fetch(proxyUrl);
            } else {
                response = await fetch(requestUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': '*/*',
                        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
                        'X-User-Agent': 'Model: MAG200; Link: Ethernet',
                        'Cookie': 'mac=' + this.mac + '; stb_lang=en; timezone=Europe/London' + (this.token ? '; token=' + this.token : ''),
                        ...(this.token ? { 'Authorization': 'Bearer ' + this.token } : {}),
                    }
                });
            }

            if (!response.ok) {
                throw new Error('HTTP Error ' + response.status);
            }

            var text = await response.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                // Non-JSON response (e.g. XML wrapped in JS)
                if (text.startsWith('<')) return { js: text };
                return { js: text };
            }
        } catch (error) {
            console.error('[Stalker] Fetch Error:', error);
            throw new Error('Network error: ' + error.message);
        }
    }

    async authenticate(username, password) {
        try {
            // Step 0: Resolve portal API base URL (try multiple paths)
            this.portalUrl = await this._resolveBase(this.portalUrl);
            console.log("[Stalker] Portal URL:", this.portalUrl);

            // Step 1: Handshake to get token
            console.log("[Stalker] Starting handshake...");
            const handshake = await this._request('handshake', {
                'type': 'stb',
                'prehash': '0'
            });

            if (handshake && handshake.js && handshake.js.token) {
                this.token = handshake.js.token;
                console.log("[Stalker] Token acquired:", this.token);
            } else {
                console.log("[Stalker] Handshake response:", handshake);
                throw new Error("Failed to get token from handshake");
            }

            // Step 2: Get Profile (some portals need this)
            try {
                const profile = await this._request('get_profile', { 'type': 'stb' });
                if (profile && profile.js) {
                    console.log("[Stalker] Profile acquired");
                }
            } catch(e) {
                console.log("[Stalker] Profile skipped:", e.message);
            }

            return { success: true, message: "Authenticated" };
        } catch (err) {
            throw err;
        }
    }

    async getChannels(genreId = null) {
        const all = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const params = {
                type: 'itv',
                force_ch_link_check: 0,
                sortby: 'number',
                p: page,
            };
            if (genreId && genreId !== 'all') {
                params.genre = genreId;
            }

            const data = await this._request('get_ordered_list', params);
            console.log('[Stalker] get_ordered_list page', page, ':', data);

            if (data && data.js) {
                const list = Array.isArray(data.js) ? data.js : (data.js.data || []);
                list.forEach(function(ch) { all.push(ch); });

                const total = Number(data.total_items) || 0;
                const max = Number(data.max_page_items) || list.length;
                const totalPages = max > 0 ? Math.ceil(total / max) : 1;
                hasMore = page < totalPages && list.length > 0;
                page++;
                if (page > 20) hasMore = false;
            } else {
                hasMore = false;
            }
        }

        return all.map(function(ch) { return {
            id: ch.id,
            number: ch.number,
            name: ch.name,
            url: ch.cmd,
            logo: ch.logo || ch.logo_src || ch.tv_logo || null,
            genre_id: ch.tv_genre_id
        };});
    }

        const data = await this._request('get_ordered_list', params);

        if (data && data.js) {
            var list = Array.isArray(data.js) ? data.js : (data.js.data || []);
            return list.map(function(ch) { return {
                id: ch.id,
                number: ch.number,
                name: ch.name,
                url: ch.cmd,
                logo: ch.logo || ch.logo_src || ch.tv_logo || null,
                genre_id: ch.tv_genre_id
            };});
        }

        return [];
    }

    async getGenres() {
        const data = await this._request('get_genres', {
            'type': 'itv'
        });

        if (data && data.js) {
            // Sometimes it returns array directly or inside data
            const list = Array.isArray(data.js) ? data.js : (data.js.data || []);
            return list.map(g => ({
                id: g.id,
                title: g.title,
                alias: g.alias
            }));
        }
        return [];
    }

    async getVodCategories(type) {
        const data = await this._request('get_categories', {
            'type': type || 'vod'
        });

        if (data && data.js) {
            const list = Array.isArray(data.js) ? data.js : (data.js.data || []);
            return list.map(c => ({
                id: c.id,
                title: c.title,
                alias: c.alias
            }));
        }
        return [];
    }

    async getVodList(categoryId, type) {
        const all = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const params = {
                'type': type || 'vod',
                'p': page,
            };

            if (categoryId && categoryId !== 'all') {
                params.category = categoryId;
            }

            const data = await this._request('get_ordered_list', params);
            console.log('[Stalker] get_ordered_list ' + type + ' page', page, ':', data);

            if (data && data.js) {
                const list = Array.isArray(data.js) ? data.js : (data.js.data || []);
                list.forEach(function(m) { all.push(m); });

                const total = Number(data.total_items) || 0;
                const max = Number(data.max_page_items) || list.length;
                const totalPages = max > 0 ? Math.ceil(total / max) : 1;
                hasMore = page < totalPages && list.length > 0;
                page++;
                if (page > 20) hasMore = false;
            } else {
                hasMore = false;
            }
        }

        return all.map(m => ({
            id: m.id,
            name: m.name,
            url: m.cmd,
            logo: m.screenshot_uri || m.logo,
            description: m.description,
            year: m.year,
            genres: m.genres_str,
            rating: m.rating_imdb || m.rating_kinopoisk
        }));
    }

        const data = await this._request('get_ordered_list', params);

        if (data && data.js) {
            var list = Array.isArray(data.js) ? data.js : (data.js.data || []);
            return list.map(m => ({
                id: m.id,
                name: m.name,
                url: m.cmd,
                logo: m.screenshot_uri || m.logo,
                description: m.description,
                year: m.year,
                genres: m.genres_str,
                rating: m.rating_imdb || m.rating_kinopoisk
            }));
        }

        return [];
    }

    async createLink(cmd) {
        console.log("[Stalker] createLink called with:", cmd);
        var self = this;

        // Helper to strip ffmpeg/auto/ffrt/ff prefixes
        function stripPrefix(s) {
            var m = s.match(/^(?:ffmpeg|auto|ffrt|ff)\s+(.+)/i);
            return m ? m[1].trim() : s.trim();
        }

        // Rewrite localhost/127.0.0.1 in URLs to the portal host
        function rewriteLocalhost(s) {
            if (s.indexOf('localhost') === -1 && s.indexOf('127.0.0.1') === -1) return s;
            try {
                var pu = new URL(self.portal);
                s = s.replace(/\/\/localhost(:\d+)?/gi, '//' + pu.hostname + (pu.port ? ':' + pu.port : ''));
                s = s.replace(/\/\/127\.0\.0\.1(:\d+)?/gi, '//' + pu.hostname + (pu.port ? ':' + pu.port : ''));
            } catch(e) {}
            return s;
        }

        var url = stripPrefix(cmd);

        // If it's a direct HTTP stream that does NOT point at localhost, return it
        if (url && url.startsWith("http") && url.indexOf('localhost') === -1 && url.indexOf('127.0.0.1') === -1) {
            console.log("[Stalker] Direct URL:", url);
            return url;
        }

        // Call the portal's create_link API (required for localhost URLs and non-HTTP cmds)
        console.log("[Stalker] Calling create_link API for:", cmd);
        const linkData = await this._request('create_link', {
            'cmd': cmd,
            'type': 'itv'
        });

        console.log("[Stalker] create_link response:", linkData);

        // Try multiple response formats
        var allData = linkData;
        // Some portals wrap in js, others return top-level
        if (allData && allData.js) allData = allData.js;

        var streamUrl = null;
        if (typeof allData === 'string' && allData.startsWith('http')) {
            streamUrl = allData;
        } else if (typeof allData === 'object') {
            // Try various response properties
            streamUrl = allData.cmd || allData.url || allData.stream || '';
        }
        if (streamUrl) {
            streamUrl = stripPrefix(streamUrl);
            if (streamUrl.startsWith('http')) {
                console.log("[Stalker] Final stream URL:", streamUrl);
                return streamUrl;
            }
        }

        // Fallback: rewrite localhost in the original URL
        var fallback = rewriteLocalhost(url);
        console.warn("[Stalker] Falling back to:", fallback);
        return fallback;
    }
}

window.StalkerClient = StalkerClient;
