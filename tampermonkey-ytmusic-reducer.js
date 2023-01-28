// ==UserScript==
// @name         Bypass thumb downed music on YouTube Music and set probabilities of track/artist playing
// @namespace    http://tampermonkey.net/
// @version      1
// @description  Automatically skips songs which have been thumbed down or reduced in play.
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
// https://github.com/web-scrobbler/web-scrobbler.

// TODO: Can we somehow get reducer value into playlist?
// TODO: Not all track titles seem to be working. Figure that out.

const skipInterval = 25;
const dislikedPlayProbability = 0;

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
    const el = getElement(selector);
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
    const element = getElement(selectors);

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
function getElement(selectors) {
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
 * A not so strong hashing function, but good enough for our purposes.
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
    const artist = getElement(artistSelectors);
    if (artist) {
        return artist.innerText.trim();
    }
    return null;
}

/**
 * Get the track name of the currently playing track
 */
const getTrackTitle = () => {
    const track = getElement(trackSelector);
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
 * @return {String|Boolean} Artist ID, returning false if no artist found.
 */
const getArtistId = () => {
    if (window.location.href.indexOf("channel") > 0) {
        const urlParts = window.location.href.split("/");
        return urlParts[urlParts.length - 1];
    }

    const byline = getElement(".middle-controls .byline");
    if (!byline) {
        return false;
    }

    // It's most likely the first A tag, but we'll check 'em all.
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
        const el = getElement("#header .title");
        if (el) {
            return el.innerText.trim();
        }
    }

    return getTrackArtist();
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
};

let reducers = {};
let manager = null; // The reducer manager window

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
    background.style.zIndex = 9999999 + this.displayCount;
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
 * Import and merge an exported file in to the reducer list
 *
 * @param  {Event} e
 */
const fileImport = (e) => {
    if (!manager) {
        setStatusText("Reducer Manager not open");
        return;
    }

    const file = document.getElementById("fileupload").files[0];

    let reader = new FileReader();

    // Closure to capture the file information.
    reader.onload = (function(theFile) {
        return function(e) {
            if (!manager) {
                setStatusText("Reducer Manager not open");
                return;
            }

            const currentReducers = {};
            for (let reducer of manager.get("reducers")) {
                currentReducers[reducer.id] = reducer;
            }

            const data = e.target.result;
            let obj = {};
            try {
                obj = JSON.parse(data);
            } catch (ex) {
                setStatusText("Invalid import file. Not valid JSON.");
                return;
            }

            if (!Array.isArray(obj)) {
                setStatusText("Invalid JSON object. Must be array of objects");
                return;
            }

            for (let reducer of obj) {
                if (typeof reducer !== 'object') {
                    setStatusText("Invalid JSON object. Must be array of objects");
                    return;
                }

                if (!reducer.id || !reducer.title || !reducer.artist || !reducer.value) {
                    setStatusText("Invalid JSON object. Error with row " + JSON.stringify(reducer));
                    return;
                }

                currentReducers[reducer.id] = reducer;
            }

            manager.set("reducers", Object.values(currentReducers));
        };
    })(file);

    // Read in the image file as a data URL.
    reader.readAsText(file);
}

/**
 * Display and handle events on reducers.
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

    manager = new Ractive({
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
        <button class="paper-button" role="button" on-click="@.fire('merge')">Import/Merge</button>
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

    manager.on({
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

        merge: function() {
            const html = `
                <input id="fileupload" type="file" name="fileupload" />
            `;
            const buttons = [{
                label: "Upload",
                onClick: fileImport,
            }, {
                label: "Cancel"
            }];

            YTMModal(html, {buttons});
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
            manager = null;
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
            manager = null;
        }
    });
}

/**
 * Creates a percentage control to increase or decrease a value.
 *
 * @param {Object} min: 25, max: 100, skip: 25, value: 100
 */
function createReducer(type, opts = {}) {
    let valueEl = null;

    opts = {
        min: 25,
        max: 100,
        skip: 25,
        value: 100,
        ...opts
    }

    const getValue = () => control.value;
    const setValue = (val) => {
        control.value = parseInt(val);
        valueEl.innerText = control.value + "%";
    }

    const control = document.createElement("div");
    control.style.padding = "8px 0px 8px 16px";
    control.style.outline = "none";
    control.style.userSelect = "none";
    control.type = type;
    control.className = `reducer-control reducer-${type}`;
    control.value = opts.value;

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
    value.innerText = control.value + "%";
    wrapper.appendChild(value);
    valueEl = value;

    // Chevron Down
    const down = document.createElement("div");
    down.style.cursor = "pointer";
    down.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 10 24 12" style="fill: #aaaaaa;"><path d="M16.939 7.939 12 12.879l-4.939-4.94-2.122 2.122L12 17.121l7.061-7.06z"></path></svg>`;
    down.addEventListener("click", decrease);
    wrapper.appendChild(down);
    control.appendChild(wrapper);

    control.setValue = (val) => setValue(val);
    control.getValue = () => control.value;

    return control;

    /**
     * Reduce value. Triggered by clicking the down chevron.
     */
    function decrease() {
        const previous = getValue();
        const value = Math.max(getValue() - opts.skip, opts.min);
        if (value < previous) {
            onChange(value, previous);
        }
    }

    /**
     * Increase value. Triggered by clicking the up chevron.
     */
    function increase() {
        const previous = getValue();
        const value = Math.min(getValue() + opts.skip, opts.max);
        if (value > previous) {
            onChange(value, previous);
        }
    }

    /**
     * If a change has occurred from a decrease or increase of value,
     * Set the display and throw change event.
     */
    function onChange(value, previous) {
        setValue(value);
        control.dispatchEvent(new CustomEvent("change", {
            detail: {
                previous,
                value
            }
        }));
    }
}

(function() {
    GM_addStyle(`#reducers-modal td, th { padding: 4px 8px; color: white; }`);
    GM_addStyle(`#reducers-modal th { user-select: none; }`);
    GM_addStyle(`.paper-button {padding: 6px 16px; color: white;font-size: 14px; background-color: #484848; border:1px solid white; margin-right: 16px; }`);
    GM_addStyle(`.paper-button:last-child {margin-right: 0; }`);

    injectStylesheet("https://cdnjs.cloudflare.com/ajax/libs/toastify-js/1.12.0/toastify.css");

    let last4 = "    ";

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
     * Stuff for testing.
     * Please ignore.
     */
    document.addEventListener("keydown", (e) => {
        last4 = last4.slice(-3) + e.key;

        if (last4 === "rent") {
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
    function checkSkip(track) {
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

        if (disliked && Math.random() > dislikedPlayProbability) {
            setStatusText(`Skipping ${track.title} because it is disliked.`);
            clickNext();
            return true;
        }

        // Check if song should be reduced in play
        if (reducers[track.id]) {
            const value = parseInt(reducers[track.id].value);
            const probability = value / 100;
            if (Math.random() > probability) {
                setStatusText(`Skipping ${track.title} due to a ${100 - value}% probability of song being skipped.`);
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
                    setStatusText(`Skipping ${track.title} due to a ${100 - value}% probability of artist being skipped.`);
                    clickNext();
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Event for when location changes. Locations are basically homepage,
     * playlist, watch, and artist (channel) pages.
     */
    function onLocationChange({lastUrl, currentUrl}) {
        if (currentUrl.indexOf("channel") > 0) {
            // Find header actions
            const el = document.querySelector("#header .actions .buttons");

            const reducer = createReducer("artist", {min: 0, max: 100, skip: skipInterval, value: 100});
            const artistId = getArtistId();
            const artist = getArtist();
            el.after(reducer);

            if (artistId && reducers[artistId]) {
                reducer.setValue(reducers[artistId].value);
            }

            reducer.addEventListener("change", (e) => {
                const value = e.target.value;
                reducers[artistId] = {
                    id: artistId,
                    title: "*",
                    artist,
                    value,
                }

                if (value >= 100) {
                    delete reducers[artistId];
                }

                GM_setValue("reducers", JSON.stringify(reducers));
                setStatusText(`${artist} will play ${value}% of the time.`);
            });
        }
    }

    /**
     * Event for when a track changes.
     */
    function onTrackChange({lastTrack, track}) {
        const skipped = checkSkip(track);

        const value = reducers[track.id] && reducers[track.id].value;
        if (!skipped) {
            if (reducers[track.id] && reducers[track.id].value) {
                playerReducer.setValue(reducers[track.id].value);
            } else {
                playerReducer.setValue(100);
            }
        }
    }

    // Add the player probability control to the track dock.
    const playerReducer = createReducer("track", {max: 100, min: 25, value: 100, skip: skipInterval});
    playerReducer.addEventListener("change", (e) => {
        const value = e.target.value;

        const track = getCurrentTrack();
        reducers[track.id] = {
            id: track.id,
            title: track.title,
            artist: track.artist,
            value
        };

        if (value >= 100) {
            delete reducers[track.id];
        }

        GM_setValue("reducers", JSON.stringify(reducers));
        setStatusText(`${track.title} (${track.id}) will play ${value}% of the time.`);
    });
    document.getElementById("like-button-renderer").after(playerReducer);

    // Add the icon to display the probability manager
    const rightContent = getElement("ytmusic-nav-bar .right-content");
    if (rightContent) {
        const div = document.createElement("div");
        div.style.marginRight = "8px";
        div.style.padding = "8px";
        div.style.cursor = "pointer";
        div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="fill: #cccccc"><path d="M11.445 21.832a1 1 0 0 0 1.11 0l9-6A.998.998 0 0 0 21.8 14.4l-9-12c-.377-.504-1.223-.504-1.6 0l-9 12a1 1 0 0 0 .245 1.432l9 6zM13 19.131V6l6.565 8.754L13 19.131zM11 6v13.131l-6.565-4.377L11 6z"></path></svg>`;
        div.addEventListener("click", displayReducers);
        rightContent.prepend(div);

        // Not really related to this script, but why do they hide the history button? Show it!
        getElement(".history-button").removeAttribute("hidden");
    }

    /**
     * Observer for track changing. This was a pain to get right and I have no idea
     * if it's actually correct or not.
     */
    function trackIdObserver(el) {
        this.lastId = null;
        this.lastTrack = getCurrentTrack();

        function waitForTitle() {
            let track = getCurrentTrack();
            if (track && track.title) {
                // So, YouTube Music seems to be slow at updating the title sometimes.
                // If title is the same as last check, wait a second and get the
                // current track title at that time.
                setTimeout(() => {
                    track = getCurrentTrack();
                    onTrackChange({lastTrack: this.lastTrack, track});
                    this.lastTrack = track;
                }, !this.lastTrack || this.lastTrack.title === track.title ? 500 : 1);
            } else {
                setTimeout(waitForTitle, 10);
            }
        }

        const callback = (mutationList, observer) => {
            const track = getCurrentTrack();
            if (track.id !== this.lastId) {
                this.lastId = track.id;
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
