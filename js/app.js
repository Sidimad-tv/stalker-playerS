// Main App Logic

document.addEventListener('DOMContentLoaded', () => {
    const screens = {
        login: document.getElementById('login-screen'),
        loading: document.getElementById('loading-screen'),
        menu: document.getElementById('main-menu'),
        player: document.getElementById('player-screen')
    };

    const ui = {
        portalInput: document.getElementById('portal-url'),
        macInput: document.getElementById('mac-address'),
        usernameInput: document.getElementById('username'),
        passwordInput: document.getElementById('password'),
        connectBtn: document.getElementById('connect-btn'),
        statusMsg: document.getElementById('status-message'),
        channelList: document.getElementById('channel-list'),
        videoPlayer: document.getElementById('video-player'),
        previewPlayer: document.getElementById('preview-player'),
        epgChannelName: document.getElementById('epg-channel-name'),
        epgProgramTitle: document.getElementById('epg-program-title'),
        epgProgramTime: document.getElementById('epg-program-time'),
        epgProgramDesc: document.getElementById('epg-program-desc'),
        channelSearch: document.getElementById('channel-search'),
        infoBanner: document.getElementById('info-banner'),
        bannerLogo: document.getElementById('banner-logo'),
        bannerChannelNumber: document.getElementById('banner-channel-number'),
        bannerChannelName: document.getElementById('banner-channel-name'),
        bannerProgramTitle: document.getElementById('banner-program-title'),
        bannerProgramTime: document.getElementById('banner-program-time'),
        bannerProgressBar: document.getElementById('banner-progress-bar'),
        bannerResolution: document.getElementById('banner-resolution'),
        bannerCurrentTime: document.getElementById('banner-current-time'),
        loadingMessage: document.getElementById('loading-message'),
        // New UI Elements
        modeTv: document.getElementById('mode-tv'),
        modeVod: document.getElementById('mode-vod'),
        modeSettings: document.getElementById('mode-settings'),
        categoryList: document.getElementById('category-list'),
        listTitle: document.getElementById('list-title'),
        playerLoader: document.getElementById('player-loader'),
        // Movie Grid UI
        tvViewContainer: document.getElementById('tv-view-container'),
        movieViewContainer: document.getElementById('movie-view-container'),
        movieGrid: document.getElementById('movie-grid'),
        movieSearch: document.getElementById('movie-search'),
        previewFsBtn: document.getElementById('preview-fs-btn')
    };

    let stalkerClient = null;
    let hlsInstance = null; // hls.js instance for fullscreen player
    let mpegtsPlayer = null;
    let previewHls = null; // hls.js instance for preview player
    let previewMpegts = null;
    let selectedChannel = null; // Currently selected channel
    let channelsData = []; // Store channel data
    let controlsTimeout = null; // Timer for auto-hiding player controls

    let currentMode = 'tv'; // 'tv' or 'vod'
    let currentCategoryId = 'all';
    let categoriesData = [];

    // Navigation state
    let currentFocus = ui.portalInput; // Starting focus

    // Initial focus set
    ui.portalInput.focus();

    // Load saved credentials
    if (localStorage.getItem('portal_url')) {
        ui.portalInput.value = localStorage.getItem('portal_url');
    }
    if (localStorage.getItem('mac_address')) {
        ui.macInput.value = localStorage.getItem('mac_address');
    }
    if (localStorage.getItem('username')) {
        ui.usernameInput.value = localStorage.getItem('username');
    }
    if (localStorage.getItem('password')) {
        ui.passwordInput.value = localStorage.getItem('password');
    }

    // Auto-login only on app startup
    if (!window.hasTriedAutoLogin && ui.portalInput.value && ui.macInput.value) {
        window.hasTriedAutoLogin = true;
        showScreen('loading');
        handleConnect();
    } else {
        ui.portalInput.focus();
    }

    // Event Listeners
    ui.connectBtn.addEventListener('click', handleConnect);

    // Mode Switchers
    ui.modeTv.addEventListener('click', () => switchMode('tv'));
    ui.modeVod.addEventListener('click', () => switchMode('vod'));
    ui.modeSettings.addEventListener('click', () => {
        showScreen('login');
        if (previewHls) {
            previewHls.destroy();
            previewHls = null;
        }
        if (previewMpegts) {
            previewMpegts.destroy();
            previewMpegts = null;
        }
        ui.previewPlayer.src = '';
    });

    // Search functionality
    ui.channelSearch.addEventListener('input', filterChannels);
    ui.movieSearch.addEventListener('input', filterChannels); 

    // Remote Control Key Handling
    document.addEventListener('keydown', handleKeyInput);

    // Fullscreen button from preview
    ui.previewFsBtn.addEventListener('click', function() {
        if (selectedChannel) {
            goFullscreen(selectedChannel.url);
        }
    });

    async function handleConnect() {
        const url = ui.portalInput.value;
        const username = ui.usernameInput.value;
        const password = ui.passwordInput.value;

        let mac = ui.macInput.value.toUpperCase().replace(/[^A-F0-9]/g, '');
        if (mac.length === 12) mac = mac.match(/.{2}/g).join(':');
        ui.macInput.value = mac;

        if (!url) {
            showStatus("Please enter a Portal URL", "error");
            return;
        }

        if (!mac) {
            showStatus("Please enter a MAC Address", "error");
            return;
        }

        showStatus("Connecting...", "info");

        stalkerClient = new StalkerClient(url, mac);

        try {
            await stalkerClient.authenticate(username, password);

            // Save credentials on success
            localStorage.setItem('portal_url', url);
            localStorage.setItem('mac_address', mac);
            localStorage.setItem('username', username);
            localStorage.setItem('password', password);

            showStatus("Connected! Loading data...", "success");

            // Initial Load
            await loadCategories();

        } catch (err) {
            showStatus("Connection failed: " + err.message, "error");
            if (!screens.loading.classList.contains('hidden')) {
                showScreen('login');
            }
        }
    }

    async function switchMode(mode) {
        if (currentMode === mode) return;

        currentMode = mode;

        // Update UI Tabs
        ui.modeTv.classList.toggle('active', mode === 'tv');
        ui.modeVod.classList.toggle('active', mode === 'vod');

        // Toggle Views
        if (mode === 'tv') {
            ui.tvViewContainer.classList.remove('hidden');
            ui.movieViewContainer.classList.add('hidden');
        } else {
            ui.tvViewContainer.classList.add('hidden');
            ui.movieViewContainer.classList.remove('hidden');
        }

        // Reset Category
        currentCategoryId = 'all';
        selectedChannel = null;

        // Reload Categories & Content
        showScreen('loading');
        await loadCategories();
    }

    async function loadCategories() {
        try {
            ui.listTitle.textContent = currentMode === 'tv' ? 'Channels' : 'Movies';

            let categories = [];
            if (currentMode === 'tv') {
                categories = await stalkerClient.getGenres();
            } else {
                categories = await stalkerClient.getVodCategories();
            }

            // Prepend "All"
            categories.unshift({ id: 'all', title: 'All', alias: 'All' });

            renderCategories(categories);

            // Select "All" by default and load content
            selectCategory('all');

        } catch (err) {
            console.error("Failed to load categories", err);
            showStatus("Failed to load categories", "error");
        }
    }

    function renderCategories(categories) {
        categoriesData = categories;
        ui.categoryList.innerHTML = '';

        categories.forEach((cat, index) => {
            const li = document.createElement('li');
            li.className = 'category-item';
            li.textContent = cat.title;
            li.dataset.id = cat.id;
            li.tabIndex = 0;

            if (cat.id === currentCategoryId) {
                li.classList.add('selected');
            }

            li.onclick = () => selectCategory(cat.id);
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') selectCategory(cat.id);
            });

            ui.categoryList.appendChild(li);
        });
    }

    async function selectCategory(catId) {
        currentCategoryId = catId;

        // Update UI
        const items = ui.categoryList.querySelectorAll('.category-item');
        items.forEach(i => {
            if (i.dataset.id == catId) i.classList.add('selected');
            else i.classList.remove('selected');
        });

        await loadContent();
    }

    async function loadContent() {
        try {
            let data = [];
            if (currentMode === 'tv') {
                data = await stalkerClient.getChannels(currentCategoryId);
                renderChannelList(data);
            } else {
                data = await stalkerClient.getVodList(currentCategoryId);
                renderMovieList(data);
            }

            showScreen('menu');
        } catch (err) {
            console.error(err);
            showStatus("Failed to load content", "error");
        }
    }

    function renderChannelList(channels) {
        channelsData = channels; 
        ui.channelList.innerHTML = '';

        if (channels.length === 0) {
            ui.channelList.innerHTML = '<div style="padding:20px; color:#666;">No content found</div>';
            return;
        }

        channels.forEach((ch, index) => {
            const li = document.createElement('li');
            li.className = 'channel-item';
            li.tabIndex = 0;
            li.dataset.url = ch.url;
            li.dataset.index = index;

            if (ch.logo) {
                const img = document.createElement('img');
                img.src = ch.logo;
                img.className = 'channel-logo';
                img.alt = '';
                img.onerror = function () { this.style.display = 'none'; };
                li.appendChild(img);
            }

            const info = document.createElement('span');
            info.className = 'channel-info';
            info.textContent = ch.number ? `${ch.number}. ${ch.name}` : ch.name;
            li.appendChild(info);

            li.onclick = () => handleChannelClick(ch, li);

            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleChannelClick(ch, li);
            });

            ui.channelList.appendChild(li);
        });
    }

    function renderMovieList(movies) {
        channelsData = movies; 
        ui.movieGrid.innerHTML = '';

        if (movies.length === 0) {
            ui.movieGrid.innerHTML = '<div style="padding:20px; color:#666;">No movies found</div>';
            return;
        }

        movies.forEach((movie, index) => {
            const card = document.createElement('div');
            card.className = 'movie-card';
            card.tabIndex = 0;
            card.dataset.url = movie.url; 
            card.dataset.index = index;

            const poster = document.createElement('img');
            poster.src = movie.logo || 'images/no-poster.png'; 
            poster.className = 'movie-poster';
            poster.alt = movie.name;
            poster.onerror = function () { this.src = 'https://via.placeholder.com/300x450?text=No+Poster'; }; 

            const info = document.createElement('div');
            info.className = 'movie-info';
            const title = document.createElement('div');
            title.className = 'movie-title';
            title.textContent = movie.name;

            info.appendChild(title);
            card.appendChild(poster);
            card.appendChild(info);

            card.onclick = () => handleChannelClick(movie, card); 

            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleChannelClick(movie, card);
            });

            ui.movieGrid.appendChild(card);
        });
    }

    function filterChannels() {
        const query = (currentMode === 'tv' ? ui.channelSearch.value : ui.movieSearch.value).toLowerCase().trim();

        if (!query) {
            if (currentMode === 'tv') renderChannelList(channelsData);
            else renderMovieList(channelsData);
            return;
        }

        const filtered = channelsData.filter(ch =>
            ch.name.toLowerCase().includes(query) ||
            (ch.number && ch.number.toString().includes(query))
        );

        if (currentMode === 'tv') renderChannelList(filtered);
        else renderMovieList(filtered);
    }

    function handleChannelClick(channel, element) {
        if (selectedChannel && selectedChannel.url === channel.url) {
            goFullscreen(channel.url);
        } else {
            if (currentMode === 'tv') {
                selectChannel(channel, element);
            } else {
                goFullscreen(channel.url);
            }
        }
    }

    function selectChannel(channel, element) {
        const allItems = ui.channelList.querySelectorAll('.channel-item');
        allItems.forEach(item => item.classList.remove('selected'));
        element.classList.add('selected');

        selectedChannel = channel;
        updateEpgInfo(channel);
        playPreview(channel.url);
    }

    function updateEpgInfo(channel) {
        ui.epgChannelName.textContent = channel.name || '';

        if (currentMode === 'vod') {
            ui.epgProgramTitle.textContent = channel.year ? `Year: ${channel.year}` : '';
            ui.epgProgramTime.textContent = channel.rating ? `Rating: ${channel.rating}` : '';
            ui.epgProgramDesc.textContent = channel.description || '';
        } else {
            if (channel.epg) {
                ui.epgProgramTitle.textContent = channel.epg.title || '';
                ui.epgProgramTime.textContent = channel.epg.time || '';
                ui.epgProgramDesc.textContent = channel.epg.description || '';
            } else {
                ui.epgProgramTitle.textContent = 'No program info available';
                ui.epgProgramTime.textContent = '';
                ui.epgProgramDesc.textContent = '';
            }
        }
    }

    function getProxiedUrl(url) {
        var isCrossOrigin = url.indexOf(location.protocol + '//' + location.host) !== 0 && url.indexOf('//' + location.host) === -1;
        if (!isCrossOrigin) return url;
        var sgBase = window.location.hostname.indexOf('vercel') !== -1 ? '/api/stalker/stream-get' : 'https://stalker-p.vercel.app/api/stalker/stream-get';
        var token = (stalkerClient && stalkerClient.token) || '';
        return sgBase + '?url=' + encodeURIComponent(url) + (token ? '&token=' + encodeURIComponent(token) : '');
    }

    function isMpegTs(url) {
        return url.indexOf('.ts') !== -1 || url.indexOf('extension=ts') !== -1;
    }

    // ==========================================
    // FAST FIREFOX PREVIEW PLAYER IMPLEMENTATION
    // ==========================================
    async function playPreview(url) {
        if (previewHls) {
            previewHls.destroy();
            previewHls = null;
        }
        if (previewMpegts) {
            previewMpegts.destroy();
            previewMpegts = null;
        }

        ui.previewFsBtn.classList.remove('hidden');

        try {
            const cleanUrl = await stalkerClient.createLink(url);
            const proxiedUrl = getProxiedUrl(cleanUrl);

            console.log('Playing preview:', proxiedUrl);

            ui.previewPlayer.muted = false;
            ui.previewPlayer.crossOrigin = 'anonymous';

            var isMpegtsAvailable = typeof mpegts !== 'undefined' &&
                (typeof mpegts.isSupported === 'function' ? mpegts.isSupported() : mpegts.isSupported);

            if (isMpegTs(cleanUrl) && isMpegtsAvailable) {
                console.log("Using live-optimized mpegts.js for preview");
                
                // CRITICAL FIX: Changing 'mpegts' type to 'mse' and adding latency limits
                previewMpegts = mpegts.createPlayer({
                    type: 'mse', 
                    isLive: true,
                    url: proxiedUrl
                }, {
                    enableWorker: true,
                    lazyLoad: false,
                    liveBufferLatencyChaser: true 
                });
                
                previewMpegts.attachMediaElement(ui.previewPlayer);
                previewMpegts.load();
                previewMpegts.play().catch(e => console.log('Preview play caught'));
            } else if (isMpegTs(cleanUrl)) {
                ui.previewPlayer.src = proxiedUrl;
                ui.previewPlayer.play().catch(e => console.log('Preview play caught'));
            } else if (Hls.isSupported()) {
                previewHls = new Hls({ debug: false, enableWorker: true });
                previewHls.loadSource(proxiedUrl);
                previewHls.attachMedia(ui.previewPlayer);
                previewHls.on(Hls.Events.MANIFEST_PARSED, function () {
                    ui.previewPlayer.play().catch(e => console.log('Preview play caught'));
                });
            } else if (ui.previewPlayer.canPlayType('application/vnd.apple.mpegurl')) {
                ui.previewPlayer.src = proxiedUrl;
            }
        } catch (e) {
            console.error('Preview error:', e);
        }
    }

    function goFullscreen(url) {
        ui.previewFsBtn.classList.add('hidden');
        if (previewHls) { previewHls.destroy(); previewHls = null; }
        if (previewMpegts) { previewMpegts.destroy(); previewMpegts = null; }
        ui.previewPlayer.pause();
        ui.previewPlayer.src = '';

        playChannel(url);
    }

    async function playChannel(url) {
        try {
            const cleanUrl = await stalkerClient.createLink(url);
            showScreen('player');

            if (typeof webOS !== 'undefined' && webOS.service && webOS.service.request) {
                webOS.service.request("luna://com.webos.applicationManager", {
                    method: "launch",
                    parameters: {
                        id: "com.webos.app.photovideo",
                        params: { target: cleanUrl, type: "video" }
                    },
                    onSuccess: function (res) { console.log("Launched webOS player:", res); },
                    onFailure: function (err) { playWithHtml5(cleanUrl); }
                });
            } else {
                playWithHtml5(cleanUrl);
            }

            currentFocus = null;
            showStatus("Playing...", "success");
        } catch (e) {
            showStatus("Error playing video: " + e.message, "error");
        }
    }

    // =============================================
    // FAST FIREFOX FULLSCREEN PLAYER IMPLEMENTATION
    // =============================================
    function playWithHtml5(url) {
        const video = ui.videoPlayer;
        video.crossOrigin = 'anonymous';
        const proxiedUrl = getProxiedUrl(url);

        ui.playerLoader.classList.remove('hidden');

        if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
        if (mpegtsPlayer) { mpegtsPlayer.destroy(); mpegtsPlayer = null; }

        if (isMpegTs(url) && typeof mpegts !== 'undefined' && mpegts.isSupported()) {
            console.log("Using live-optimized mpegts.js for fullscreen");
            var mpegtsFallback = false;
            
            // CRITICAL FIX: Direct memory segment parsing to remove the 50 second lag
            mpegtsPlayer = mpegts.createPlayer({
                type: 'mse', 
                isLive: true,
                url: proxiedUrl
            }, {
                enableWorker: true,
                lazyLoad: false,
                liveBufferLatencyChaser: true
            });
            
            mpegtsPlayer.attachMediaElement(video);
            mpegtsPlayer.load();
            mpegtsPlayer.play().catch(function (e) {
                console.error('mpegts error:', e);
                mpegtsFallback = true;
            });

            mpegtsPlayer.on(mpegts.Events.ERROR, function(errorType, errorDetail, errorInfo) {
                if (mpegtsFallback) return;
                if (errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
                    mpegtsFallback = true;
                    if (mpegtsPlayer) { mpegtsPlayer.destroy(); mpegtsPlayer = null; }
                    video.src = proxiedUrl;
                    video.play().catch(e => console.log('Fallback failed'));
                }
            });

        } else if (isMpegTs(url)) {
            video.src = proxiedUrl;
            video.play().catch(e => console.log('Native video error'));
        } else if (Hls.isSupported()) {
            hlsInstance = new Hls({ debug: false, enableWorker: true, lowLatencyMode: true });
            hlsInstance.loadSource(proxiedUrl);
            hlsInstance.attachMedia(video);
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
                video.play().catch(e => console.log('HLS play error'));
            });
        } else {
            video.src = proxiedUrl;
            video.play().catch(e => console.log('Direct playback error'));
        }

        const onPlaying = () => {
            ui.playerLoader.classList.add('hidden');
            video.removeEventListener('playing', onPlaying);
            video.removeEventListener('error', onError);
        };
        const onError = () => {
            ui.playerLoader.classList.add('hidden');
            video.removeEventListener('playing', onPlaying);
            video.removeEventListener('error', onError);
        };

        video.addEventListener('playing', onPlaying);
        video.addEventListener('error', onError);
    }

    function stopPlayer() {
        if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
        if (mpegtsPlayer) { mpegtsPlayer.destroy(); mpegtsPlayer = null; }
        ui.videoPlayer.pause();
        ui.videoPlayer.src = '';
        showScreen('menu');
        if (typeof restoreFocusToChannel === 'function') restoreFocusToChannel();
        if (selectedChannel) {
            playPreview(selectedChannel.url);
        }
    }

    function showStatus(msg, type) {
        ui.statusMsg.textContent = msg;
        ui.statusMsg.style.color = type === 'error' ? 'red' : 'green';
        if (!screens.loading.classList.contains('hidden')) {
            ui.loadingMessage.textContent = msg;
        }
    }

    function showScreen(screenName) {
        Object.values(screens).forEach(s => s.classList.add('hidden'));
        screens[screenName].classList.remove('hidden');
    }

    function handleKeyInput(e) {
        if (!screens.player.classList.contains('hidden')) {
            if (typeof showInfoBanner === 'function') showInfoBanner();
        }

        const isMenuVisible = !screens.menu.classList.contains('hidden');
        const activeEl = document.activeElement;

        switch (e.keyCode) {
            case 461: // WebOS Back button
                if (!screens.player.classList.contains('hidden')) {
                    e.preventDefault();
                    stopPlayer();
                } else if (isMenuVisible) {
                    if (activeEl.classList.contains('channel-item') || activeEl.classList.contains('movie-card')) {
                        const currentCat = ui.categoryList.querySelector('.category-item.selected');
                        if (currentCat) currentCat.focus();
                    } else if (activeEl.classList.contains('category-item') || activeEl.classList.contains('mode-btn')) {
                        e.preventDefault();
                        showScreen('login');
                        if (previewHls) { previewHls.destroy(); previewHls = null; }
                        if (previewMpegts) { previewMpegts.destroy(); previewMpegts = null; }
                        ui.previewPlayer.src = '';
                    } else {
                        e.preventDefault();
                        showScreen('login');
                    }
                } else if (!screens.loading.classList.contains('hidden')) {
                    e.preventDefault();
                    showScreen('login');
                } else if (!screens.login.classList.contains('hidden')) {
                    // Allowed out to escape application structure if channels data empty
                }
                break;
            case 38: // Up
                if (isMenuVisible) {
                    e.preventDefault();
                    if (document.activeElement === ui.channelSearch) {
                        ui.modeTv.focus();
                    } else if (document.activeElement && document.activeElement.classList.contains('channel-item')) {
                        const prev = document.activeElement.previousElementSibling;
                        if (prev) {
                            prev.focus();
                            prev.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        } else {
                            ui.channelSearch.focus();
                        }
                    }
                }
                break;
        }
    }
});
