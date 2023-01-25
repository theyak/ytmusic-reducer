// ==UserScript==
// @name         Bypass thumb downed music on YouTube Music and set probabilities of track/artist playing
// @namespace    http://tampermonkey.net/
// @version      1
// @description  Automatically skips songs which have been thumbed down or reduced in play.
// @author       theyak
// @match        https://music.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @require      https://cdnjs.cloudflare.com/ajax/libs/toastify-js/1.12.0/toastify.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/ractive/1.4.1/ractive.min.js
// ==/UserScript==

/* global Toastify */
/* global Ractive */

// This script wouldn't be possible without the awesome Web Scrobbler project.
// https://github.com/web-scrobbler/web-scrobbler
// A lot of code contained here-in is from web-scrobbler.

// TODO: Can we somehow get reducer value into playlist?
// TODO: Not all track titles seem to be working. Figure that out.
// TODO: Merge

const skipInterval = 25;

const artistSelectors = [
    // Base selector, combining both new and old
    '.ytmusic-player-bar.byline [href*="channel/"]:not([href*="channel/MPREb_"]):not([href*="browse/MPREb_"])',

    // Old selector for self-uploaded music
    '.ytmusic-player-bar.byline [href*="feed/music_library_privately_owned_artist_detaila_"]',

    // New selector for self-uploaded music
    '.ytmusic-player-bar.byline [href*="browse/FEmusic_library_privately_owned_artist_detaila_"]',
];

const trackSelector = ".ytmusic-player-bar.title";
const idSelector = ".yt-uix-sessionlink";

const regex = {
    ytvideo: /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?.*v=))([^#&?]*).*/,
};

/**
 * Waits for an element to be available in the DOM
 *
 * @param  {String|Array} selectors Single selector or array of selectors
 * @param  {callback} Function to call when element is available
 * @param  {int} Time in milliseconds to wait between checks
 */
function waitForElement(selector, callback, timeout = 10) {
    const el = queryElements(selector);
    if (el) {
        callback(el);
    } else {
        setTimeout(() => waitForElement(selector, callback, timeout), timeout);
    }
}

/**
 * Return a text value of a first available element. If `selectors` is
 * a string, return the attribute value of an element matching by
 * the selector. If `selectors` is an array, return the attribute value of
 * a first element with the attribute available.
 *
 * @param  {String|Array} selectors Single selector or array of selectors
 * @param  {String} attr Attrubute to get
 * @param  {Object} [defaultValue=null] Fallback value
 * @return {Object} Text of element, if available, or default value
 */
function getAttrFromSelectors(selectors, attr, defaultValue = null) {
    const element = queryElements(selectors);

    if (element) {
        return element.getAttribute(attr);
    }

    return defaultValue;
}

/**
 * Return first available element from selector or selector list. If `selectors`
 * is a string, return Element with the selector. If `selectors` is
 * an array, return Element object matched by first valid selector.
 * @param  {String|Array} selectors Single selector or array of selectors
 * @return {Element|null} Element object
 */
function queryElements(selectors) {
    if (!selectors) {
        return null;
    }

    if (typeof selectors === "string") {
        return document.querySelector(selectors);
    }

    if (!Array.isArray(selectors)) {
        throw new TypeError(
            `Unknown type of selector: ${typeof selectors}`
        );
    }

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            return element;
        }
    }

    return null;
}

/**
 * A not so string hashing function, but good enough for our purposes.
 *
 * @param  {String}
 * @param  {int}
 * @return {String}
 */
const cyrb53 = (str, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
};

/**
 * Inject a stylesheet into the head of the application.
 *
 * @param  {String} URL of external stylesheet
 */
function injectStylesheet(url) {
    const head = document.getElementsByTagName("head");
    if (head && head.length) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = url;
        head[0].appendChild(link);
    }
}


/**
 * Parse given video URL and return video ID.
 * @param  {String} videoUrl Video URL
 * @return {String} Video ID
 */
function getYtVideoIdFromUrl(videoUrl) {
    if (!videoUrl) {
        return null;
    }

    const match = videoUrl.match(regex.ytvideo);
    if (match) {
        return match[7];
    }

    return null;
}


const getTrackArtist = () => {
    const artist = queryElements(artistSelectors);
    if (artist) {
        return artist.innerText.trim();
    }
    return null;
}

/**
 * Get the track name of the currently playing track
 */
const getTrackTitle = () => {
    const track = queryElements(trackSelector);
    if (track) {
        return track.innerText.trim();
    }
    return null;
}

/**
 * Get the internal Youtube ID for the currently playing track
 *
 * @return {String}
 */
const getTrackId = () => {
    const videoUrl = getAttrFromSelectors(idSelector, "href");

    if (videoUrl) {
        return getYtVideoIdFromUrl(videoUrl);
    }

    return null;
};

/**
 * Get ID of current artist
 *
 * @return {String|Boolean} Artist ID, false if not found.
 */
const getArtistId = () => {
    if (window.location.href.indexOf("channel") > 0) {
        const urlParts = window.location.href.split("/");
        return urlParts[urlParts.length - 1];
    }

    const byline = queryElements(".middle-controls .byline");
    if (!byline) {
        return false;
    }

    // It's most likely the first A tag
    const elements = byline.getElementsByTagName("A");
    for (let el of elements) {
        const href = el.getAttribute("href");
        if (href.indexOf("channel") === 0) {
            return href.slice(8);
        }
    }

    // Believe it or not, not all artists have an ID. We'll make one based on name.
    return cyrb53(getTrackArtist());
}

/**
 * Get artist name from artist page or current playing track
 */
const getArtist = () => {
    if (window.location.href.indexOf("channel") > 0) {
        const el = queryElements("#header .title");
        if (el) {
            return el.innerText.trim();
        }
    }

    return getTrackArtist();
}

/**
 * Check if currently playing a track
 *
 * @return {Boolean}
 */
function isPlaying() {
    const playButton = document.getElementById("play-pause-button");
    if (playButton) {
        const path = playButton.getElementsByTagName("path");
        if (path.length > 0) {
            const attribute = path[0].getAttribute("d");

            // Crazy thing that Google can change on a whim. Hopefully they don't.
            // This is the path for the Pause button, which displays when song is playing.
            if (attribute === "M9,19H7V5H9ZM17,5H15V19h2Z") {
                return true;
            }

            return false;
        }
    }
}

/**
 * Display message to user
 *
 * @param  {String} text
 */
function setStatusText(text) {
    Toastify({
        text,
        duration: 10000,
        close: true,
        gravity: "top",
        position: "right",
        stopOnFocus: true,
        style: {
            background: "linear-gradient(to right, #00b09b, #96c93d)",
            fontSize: "16px",
        },
    }).showToast();
}

let currentTrack = {
    id: null,
    title: null,
    artist: null,
    playing: false,
};

let reducers = {};


/**
 * A super simple modal component that tries to match the YouTube Music theme.
 *
 * @param  {String} Content to display on modal. HTML string is fine.
 * @param  {Object} Options for modal
 *    - minWidth, e.g., 300px, 50vw
 *    - maxWidth, e.g., 800px, 66%
 *    - buttons, e.g., [{label: String, onClick: function, focus: boolean}, ...]
 */
function YTMModal(text, opts = {}) {
    this.displayCount = 0;

    this.dispalyCount++;
    const background = document.createElement("div");
    background.style.position = "fixed";
    background.style.width = "100vw";
    background.style.height = "100vh";
    background.style.top = 0;
    background.style.left = 0;
    if (this.displayCount <= 1) {
        background.style.backgroundColor = "rgba(0, 0, 0, .85)";
    }

    const modal = document.createElement("div");
    modal.style.position = "absolute";
    modal.style.left = "50%";
    modal.style.top = "40%";
    modal.style.transform = "translate(-50%, -40%)";

    modal.style.border = "1px solid #383838";
    modal.style.backgroundColor = "#212121";
    modal.style.fontSize = "16px";
    modal.style.color = "#aaaaaa";
    modal.style.overflowY = "auto";
    modal.style.zIndex = 9999999 + this.displayCount;
    modal.style.minWidth = opts.minWidth || "200px";
    modal.style.maxWidth = opts.maxWidth || "80vw";
    modal.style.fontFamily = "roboto, sans-serif";
    background.appendChild(modal);

    const body = document.createElement("div");
    body.innerHTML = text;
    body.style.borderBottom = "1px solid #383838";
    body.style.padding = "16px";
    body.style.minHeight = "4rem";
    modal.appendChild(body);

    const buttons = document.createElement("div");
    buttons.style.padding = "16px";
    buttons.style.textAlign = "right";
    buttons.style.fontSize = "14px";

    if (opts.buttons) {
    } else {
        // Standard alert message
        opts.buttons = [{
            label: "OK",
            onClick: () => {},
        }];
    }

    let focusButton = null;
    for (let button of opts.buttons) {
        const element = document.createElement("button");

        // First button will be default focus. It may change
        // as we look through the buttons.
        if (!focusButton) {
            focusButton = element;
        }

        element.className = "paper-button";
        element.role = "button";
        element.innerHTML = button.label;
        element.addEventListener("click", (e) => {
            if (button.onClick) {
                button.onClick(e, modal);
            }

            // Close with a timeout to allow click handler to do its thing.
            // Useful if there is a form in the modal body.
            setTimeout(() => {
                background.remove();
                this.displayCount--;
            }, 1);
        });
        if (button.focus) {
            focusButton = element;
        }
        buttons.appendChild(element);
    }

    modal.appendChild(buttons);

    document.getElementsByTagName("body")[0].appendChild(background);

    if (focusButton) {
        focusButton.focus();
    }
}

/**
 * Display and handle events on reducers.
 * This is triggered by clicking on the percentage probablility of play in the player control.
 */
function displayReducers() {
    const modal = document.createElement("div");
    modal.id = "reducers-modal";
    modal.style.border = "1px solid #383838";
    modal.style.color = "white";
    modal.style.backgroundColor = "#212121";
    modal.style.position = "fixed";
    modal.style.inset = "2vh";
    modal.style.fontSize = "16px";
    modal.style.color = "#aaaaaa";
    modal.style.overflowY = "auto";
    modal.style.zIndex = "999999";
    const body = document.getElementsByTagName("body")[0];
    body.appendChild(modal);

    let ractive = new Ractive({
        target: modal,
        template: `
<a style="display:none" href="" id="export-anchor"></a>
<div style="display: grid; height: 100%; grid-template-rows: 1fr 64px; grid-template-columns: 1fr;">
  <div style="padding:16px;">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th style="cursor: default" id="reduce-title" on-click="@.fire('sortTitle')">Title</th>
          <th>Artist</th>
          <th>Reduction</th>
        </tr>
      </thead>
      <tbody>
        <tr><td style="border-top:1px solid #383838;" colspan="5"></td></tr>
        {{#each reducers:num}}
        <tr>
          <td>{{id}}</td><td>{{title}}</td><td>{{artist}}</td><td>{{value}}%</td>
          <td>
          <button on-click="@.fire("increase", {}, {num, id})">+</button>
          <button on-click="@.fire("decrease", {}, {num, id})">&minus;</button>
          <button on-click="@.fire("remove", {}, {num, id})">&#215;</button>
          </td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>
  <div style="padding:16px;border-top: 1px solid #383838;">
    <div style="display:flex; justify-content:space-between">
      <div>
        <button class="paper-button" role="button" on-click="@.fire('export')">Export</button>
        <button class="paper-button" role="button">Import/Merge</button>
      </div>
      <div>
        <button class="paper-button" role="button" on-click="@.fire('cancel')">Cancel</button>
        <button class="paper-button" role="button" on-click="@.fire('save')">Save</button>
      </div>
    </div>
  </div>
</div>
      `,
        data: {
            // Deep clone otherwise global reducers will get modified and cancel won't work.
            // Sorry, spread operator doesn't work as the arrays inside are still shallow cloned.
            reducers: Object.values(JSON.parse(JSON.stringify(reducers))),
            titleSort: 0,
            artistSort: 0,
        }
    });

    ractive.on({
        sortTitle: function() {
            const r = this.get("reducers");
            if (this.get("titleSort") <= 0) {
                r.sort((a, b) => a.title < b.title ? -1 : 1);
                this.set("titleSort", 1);
            } else {
                r.sort((a, b) => a.title < b.title ? 1 : -1);
                this.set("titleSort", -1);
            }
            this.set("reducers", r);
        },

        sortArtist: function() {
            const r = this.get("reducers");
            if (this.get("artistSort") <= 0) {
                r.sort((a, b) => a.artist < b.artist ? -1 : 1);
                this.set("artistSort", 1);
            } else {
                r.sort((a, b) => a.artist < b.artist ? 1 : -1);
                this.set("artistSort", -1);
            }
            this.set("reducers", r);
        },

        increase: function(context, data) {
            const valuePath = `reducers[${data.num}].value`;
            let value = parseInt(this.get(valuePath));

            if (value >= 100) {
                return;
            }

            value += skipInterval;
            if (value >= 100) {
                value = 100;
            }
            this.set(valuePath, value);
        },

        decrease: function(context, data) {
            const valuePath = `reducers[${data.num}].value`;
            const titlePath = `reducers[${data.num}].title`;
            let value = parseInt(this.get(valuePath));
            const title = this.get(titlePath);

            if (value <= skipInterval && title !== "*") {
                return;
            }

            if (value <= 0) {
                return;
            }

            value -= skipInterval;
            this.set(valuePath, value);
        },

        remove: function(context, data) {
            this.splice("reducers", data.num, 1);
        },

        export: function() {
            const blob = new Blob([JSON.stringify(this.get("reducers"), null, 2)], { type: "text/json" });
            const link = document.createElement("a");
            link.download = "ytmusic-reducers.json";
            link.href = window.URL.createObjectURL(blob);
            link.dataset.downloadurl = ["text/json", link.download, link.href].join(":");

            const evt = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
            });

            link.dispatchEvent(evt);
            window.URL.revokeObjectURL(link.href);
            link.remove();
        },

        cancel: function() {
            this.teardown();
            modal.remove();
        },

        save: function() {
            // Build new reducers object for the rest of the app
            let r = this.get("reducers");
            reducers = {};
            r.forEach((reducer) => {
                if (reducer.value < 100) {
                    reducers[reducer.id] = reducer;
                }
            });

            // Save reducers
            GM_setValue("reducers", JSON.stringify(reducers));

            this.teardown();
            modal.remove();
        }
    });
}


(function() {
    let last4 = "    ";
    let reducedValueEl = null;

    // Load previously saved reducers.
    reducers = GM_getValue("reducers");
    if (!reducers) {
        reducers = {};
    } else {
        reducers = JSON.parse(reducers);
    }

    const player = document.getElementsByTagName("ytmusic-player-bar")[0];
    if (!player) {
        console.log("Could not find Youtube player control.");
        return;
    }

    /**
     * Adds the up and down chevrons to the track component.
     *
     * @param  {Element} Element to place control after
     * @param  {String} Type of reducer, artist or track.
     */
    function appendReducers(el, type) {
        const control = document.createElement("div");
        control.style.padding = "8px 0px 8px 16px";
        control.style.outline = "none";
        control.reducerType = type;
        control.className = `reducer-control reducer-${type}`;

        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.alignItems = "center";

        // Chevron Up
        const up = document.createElement("div");
        up.style.cursor = "pointer";
        up.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 12" style="fill: #aaaaaa;"><path d="m12 6.879-7.061 7.06 2.122 2.122L12 11.121l4.939 4.94 2.122-2.122z"></path></svg>`;
        up.addEventListener("click", increase);
        wrapper.appendChild(up);

        // Label
        const value = document.createElement("div");
        value.className = "reducer-label";
        value.style.fontSize = "10px";
        value.style.color = "#aaaaaa";
        value.style.cursor = "pointer";
        value.innerText = "100%";
        value.addEventListener("click", () => displayReducers());
        wrapper.appendChild(value);

        // Chevron Down
        const down = document.createElement("div");
        down.style.cursor = "pointer";
        down.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 10 24 12" style="fill: #aaaaaa;"><path d="M16.939 7.939 12 12.879l-4.939-4.94-2.122 2.122L12 17.121l7.061-7.06z"></path></svg>`;
        down.addEventListener("click", reduce);
        wrapper.appendChild(down);

        control.appendChild(wrapper);
        el.after(control);

        control.valueEl = value;
        control.setValue = function(value) {
            control.valueEl.innerText = parseInt(value) + "%";
        }

        return control;
    }

    /**
     * Get the currently active track information.
     *
     * @return {Object}
     */
    function getCurrentTrack() {
        return {
            id: getTrackId(),
            title: getTrackTitle(),
            artist: getTrackArtist(),
        }
    }

    /**
     * Reduce the probability of playing the current track for future plays.
     */
    function reduce(e) {
        const control = e.target.closest(".reducer-control");

        // Artist reducer
        if (control.reducerType === "artist") {
            const id = getArtistId();
            const artist = getArtist();
            if (!id) {
                setStatusText(`Unable to find artist.`);
                return false;
            }

            let value = 100;
            if (reducers[id]) {
                value = parseInt(reducers[id].value);
                value -= skipInterval;
                if (value < 0) {
                    value = 0;
                }
                reducers[id].value = value;
            } else {
                value -= skipInterval;
                reducers[id] = {
                    id,
                    title: "*",
                    artist,
                    value,
                }
            }

            control.setValue(value);

            GM_setValue("reducers", JSON.stringify(reducers));
            setStatusText(`${artist} will play ${value}% of the time.`);
            return;
        }

        // Track reducer
        currentTrack = getCurrentTrack();

        let value = 100;
        if (reducers[currentTrack.id]) {
            value = parseInt(reducers[currentTrack.id].value);
        }

        if (value <= skipInterval) {
            return;
        }

        value -= skipInterval;

        reducers[currentTrack.id] = {
            id: currentTrack.id,
            title: currentTrack.title,
            artist: currentTrack.artist,
            value
        };

        GM_setValue("reducers", JSON.stringify(reducers));
        setStatusText(`${currentTrack.title} (${currentTrack.id}) will play ${value}% of the time.`);
        control.setValue(value);
    }

    /**
     * Increase the probability of playing the current track for future plays.
     */
    function increase(e) {
        currentTrack = getCurrentTrack();

        const control = e.target.closest(".reducer-control");

        // Artist reducer
        if (control.reducerType === "artist") {
            const id = getArtistId();
            const artist = getArtist();
            if (!reducers[id]) {
                return;
            }

            let value = parseInt(reducers[id].value);
            value += skipInterval;
            if (value >= 100) {
                value = 100;
                delete reducers[id];
            } else {
                reducers[id].value = value;
            }

            control.setValue(value);
            GM_setValue("reducers", JSON.stringify(reducers));
            setStatusText(`${artist} will play ${value}% of the time.`);
            return;
        }

        if (reducers[currentTrack.id]) {
            let value = parseInt(reducers[currentTrack.id].value)
            value += skipInterval;
            if (value >= 100) {
                value = 100;
                delete reducers[currentTrack.id];
            } else {
                reducers[currentTrack.id] = value;
            }
            GM_setValue("reducers", JSON.stringify(reducers));
            setStatusText(`${currentTrack.title} (${currentTrack.id}) will play ${value}% of the time.`);
            control.setValue(value);
        }
    }

    /**
     * Stuff for testing.
     * Please ignore.
     */
    document.addEventListener("keydown", (e) => {
        last4 = last4.slice(-3) + e.key;

        // Reduce playing time
        if (last4 === "duce") {
            reduce();
        } else if (last4 === "ease") {
            increase();
        } else if (last4 === "rent") {
            setStatusText(JSON.stringify(currentTrack));
        } else if (last4 === "tist") {
            setStatusText(getArtistId());
        }
    });

    /**
     * Imitates clicking the next track button.
     * This gets called when we find a track we should skip.
     */
    function clickNext() {
        const nextButton = player.getElementsByClassName("next-button");
        if (nextButton.length > 0) {
            nextButton[0].click();
        }
    }

    /**
     * Here's our magic function that checks the current status of the song.
     * If the song is thumbed down, then it will be skipped.
     * If the song is associated with a reducer, it has a potential of being skipped.
     * If the song's artist is associated with an artist reducer, it has a potential of being skipped.
     *
     * @return  {Boolean} true if song is skipped.
     */
    function checkSkip(currentTrack) {
        const like = player.getElementsByClassName("like");
        const dislike = player.getElementsByClassName("dislike");
        let liked = false;
        let disliked = false;

        if (like.length > 0) {
            liked = like[0].getAttribute("aria-pressed") === "true";
        }

        if (dislike.length > 0) {
            disliked = dislike[0].getAttribute("aria-pressed") === "true";
        }

        if (disliked) {
            setStatusText(`Skipping ${currentTrack.title} because it is disliked.`);
            clickNext();
            return true;
        }

        // Check if song should be reduced in play
        if (reducers[currentTrack.id]) {
            const value = parseInt(reducers[currentTrack.id].value);
            queryElements(".reducer-track").setValue(value);

            const probability = value / 100;
            if (Math.random() > probability) {
                setStatusText(`Skipping ${currentTrack.title} due to a ${100 - value}% probability of song being skipped.`);
                clickNext();
                return true;
            }
        } else {
            // Check for artist reduction
            const artistId = getArtistId();
            if (reducers[artistId]) {
                const value = parseInt(reducers[artistId].value);
                const probability = value / 100;
                if (Math.random() > probability) {
                    setStatusText(`Skipping ${currentTrack.title} due to a ${100 - value}% probability of artist being skipped.`);
                    clickNext();
                    return true;
                }
            }

            queryElements(".reducer-track").setValue(100);
        }

        return false;
    }


    /**
     * Event for when location changes. Locations are basically homepage,
     * playlist, watch, and artist (channel) pages.
     */
    function onLocationChange({lastUrl, currentUrl}) {
        if (currentUrl.indexOf("channel") > 0) {
            // FInd header actions
            const el = queryElements("#header .actions .buttons");

            const reducerEl = appendReducers(el, "artist");
            const artistId = getArtistId();

            if (artistId && reducers[artistId]) {
                reducerEl.setValue(reducers[artistId].value);
            }
        }
    }

    /**
     * Event for when a track changes.
     */
    function onTrackChange({lastTrack, currentTrack}) {
        const skipped = checkSkip(currentTrack);

        // Use this to test that track information is being updated properly.
        if (!skipped) {
            console.log(currentTrack);
        }
    }


    GM_addStyle(`#reducers-modal td, th { padding: 4px 8px; color: white;}`);
    GM_addStyle(`.paper-button {padding: 6px 16px;color: white;font-size: 14px;background-color: #484848;border:1px solid white;margin-right: 16px}`);
    GM_addStyle(`.paper-button:last-child {margin-right: 0;}`);

    injectStylesheet("https://cdnjs.cloudflare.com/ajax/libs/toastify-js/1.12.0/toastify.css");
    appendReducers(document.getElementById("like-button-renderer"), "track");


    /**
     * Observer for track changing. This was a pain to get right and I have no idea
     * if it's actually correct or not.
     */
    function trackIdObserver(el) {
        this.lastId = null;
        this.lastTrack = getCurrentTrack();

        function waitForTitle() {
            let currentTrack = getCurrentTrack();
            if (currentTrack && currentTrack.title) {
                // So, YouTube Music seems to be slow at updating the title sometimes.
                // If title is the same as last check, wait a second and get the
                // current track title at that time.
                setTimeout(() => {
                    currentTrack = getCurrentTrack();
                    onTrackChange({lastTrack: this.lastTrack, currentTrack});
                    this.lastTrack = currentTrack;
                }, !this.lastTrack || this.lastTrack.title === currentTrack.title ? 500 : 1);
            } else {
                setTimeout(waitForTitle, 10);
            }
        }

        const callback = (mutationList, observer) => {
            const currentTrack = getCurrentTrack();
            if (currentTrack.id !== this.lastId) {
                this.lastId = currentTrack.id;
                waitForTitle();
            }
        }
        const observer = new MutationObserver(callback);
        observer.observe(el, {attributes: true});
    }
    waitForElement(idSelector, trackIdObserver);


    /**
     * Look for changes in the header, which basically indicates a change of page.
     */
    function headerObserver(el) {
        this.lastUrl = "";

        const callback = (mutationList, observer) => {
            for (let mutation of mutationList) {
                if (mutation.addedNodes.length > 0) {
                    onLocationChange({lastUrl: this.lastUrl, currentUrl: window.location.href});
                    this.lastUrl = window.location.href;
                }
            }
        }
        const observer = new MutationObserver(callback);
        observer.observe(el, {childList: true, subTree: true});
        onLocationChange({lastUrl: this.lastUrl, currentUrl: window.location.href});
    }
    headerObserver(document.getElementById("header"));
})();
