// ==UserScript==
// @name         Bypass thumb downed music on YouTube Music
// @namespace    http://tampermonkey.net/
// @version      1
// @description  Automatically skips songs which have been thumbed down or reduced in play.
// @author       theyak
// @homepage     https://github.com/theyak/ytmusic-reducer
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
// TODO: Clicking play on a playlist from homepage doesn't trigger the new track name event
// TODO: Not all track titles seem to be working. Figure that out.

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

const currentTrack = {
    id: null,
    title: null,
    artist: null,
    playing: false,
};

let reducers = {};

/**
 * Display and handle events on reducers.
 * This is triggered by clicking on the percentage probablility of play in the player control.
 */
function displayReducers() {
    const modal = document.createElement("div");
    modal.id = "reducers-modal";
    modal.style.border = "1px solid #383838";
    modal.style.backgroundColor = "#212121";
    modal.style.position = "fixed";
    modal.style.inset = "2vh";
    modal.style.padding = "16px";
    modal.style.fontSize = "16px";
    modal.style.color = "#aaaaaa";
    modal.style.overflowY = "auto";
    modal.style.zIndex = "999999";
    modal.innerHTML = "Hello!";
    const body = document.getElementsByTagName("body")[0];
    body.appendChild(modal);

    let ractive = new Ractive({
        target: modal,
        template: `
<div style="display: flex; justify-content: space-between; width: 100%">
  <div>Reducers</div>
  <div style="cursor: pointer; font-size: 36px" on-click="@.fire("teardown")">&#215;</div>
</div>
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
      `,
        data: {
            reducers: Object.values(reducers),
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
            const reducer = reducers[data.id];
            if (!reducer) {
                return;
            }

            let value = parseInt(reducer.value);
            if (value >= 100) {
                return;
            }

            const keyPath = `reducers[${data.num}].value`;
            value += 25;
            if (value >= 100) {
                value = 100;
                delete reducers[data.id];
            } else {
                reducer.value = value;
            }
            this.set(keyPath, value);
            GM_setValue("reducers", JSON.stringify(reducers));
        },

        decrease: function(context, data) {
            const reducer = reducers[data.id];
            if (!reducer) {
                return;
            }

            let value = parseInt(reducer.value);
            if (value <= 25) {
                return;
            }

            const keyPath = `reducers[${data.num}].value`;
            value -= 25;
            this.set(keyPath, value);

            reducer.value = value;
            GM_setValue("reducers", JSON.stringify(reducers));
        },

        remove: function(context, data) {
            this.splice("reducers", data.num, 1);
            delete reducers[data.id];
            GM_setValue("reducers", JSON.stringify(reducers));
        },

        teardown: function() {
            this.teardown();
            modal.remove();
        }
    });
}


(function() {
    let last4 = "    ";
    let reducedValueEl = null;

    const player = document.getElementsByTagName("ytmusic-player-bar")[0];
    if (!player) {
        console.log("Could not find Youtube player control.");
        return;
    }

    /**
     * Adds the up and down chevrons to the track component.
     */
    function appendReducers() {
        const el = document.getElementById("like-button-renderer");

        const newIcon = document.createElement("div");
        newIcon.style.padding = "8px 0px 8px 16px";
        newIcon.style.outline = "none";

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
        reducedValueEl = document.createElement("div");
        reducedValueEl.style.fontSize = "10px";
        reducedValueEl.style.color = "#aaaaaa";
        reducedValueEl.style.cursor = "pointer";
        reducedValueEl.innerText = "100%";
        reducedValueEl.addEventListener("click", displayReducers);
        wrapper.appendChild(reducedValueEl);

        // Chevron Down
        const down = document.createElement("div");
        down.style.cursor = "pointer";
        down.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 10 24 12" style="fill: #aaaaaa;"><path d="M16.939 7.939 12 12.879l-4.939-4.94-2.122 2.122L12 17.121l7.061-7.06z"></path></svg>`;
        down.addEventListener("click", reduce);
        wrapper.appendChild(down);

        newIcon.appendChild(wrapper);
        el.after(newIcon);
    }

    /**
     * Reduce the probability of playing the current track for future plays.
     */
    function reduce() {
        let value = "100";
        if (reducers[currentTrack.id]) {
            value = reducers[currentTrack.id].value;
        }

        if (value === "75") {
            value = "50";
        } else if (value === "50") {
            value = "25";
        } else if (value !== "25") {
            value = "75";
        }

        reducers[currentTrack.id] = {
            id: currentTrack.id,
            title: currentTrack.title,
            artist: currentTrack.artist,
            value
        };

        GM_setValue("reducers", JSON.stringify(reducers));
        setStatusText(`${currentTrack.title} (${currentTrack.id}) will play ${value}% of the time.`);
        reducedValueEl.innerText = value + "%";
    }

    /**
     * Increase the probability of playing the current track for future plays.
     */
    function increase() {
        if (reducers[currentTrack.id]) {
            let value = reducers[currentTrack.id].value;
            if (value === "25") {
                value = "50";
            } else if (value === "50") {
                value = "75";
            } else {
                value = "100";
                delete reducers[currentTrack.id];
            }
            GM_setValue("reducers", JSON.stringify(reducers));
            setStatusText(`${currentTrack.title} (${currentTrack.id}) will play ${value}% of the time.`);
            reducedValueEl.innerText = value + "%";
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
     *
     * @return  {Boolean} true if song is skipped.
     */
    function checkSkip() {
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
            reducedValueEl.innerText = value + "%";

            const probability = value / 100;
            if (Math.random() > probability) {
                setStatusText(`Skipping ${currentTrack.title} due to a ${100 - value}% probability of song being skipped.`);
                clickNext();
                return true;
            }
        } else {
            reducedValueEl.innerText = "100%";
        }

        return false;
    }

    /**
     * Check for change to title, and if change is found, do processing.
     * I'd prefer to check by ID, since it's possible two songs with the
     * same title get played in a row, but there were timing issues that
     * prevented this from working properly.
     *
     * Problem: Doesn't catch first song if player bar doesn't appear.
     * This can be replication by clicking play on any of the playlists
     * when first loading the page.
     *
     * @param  {Element} Element to observe. Title element in our case.
     */
    function setupMutationObserver(el) {
        // Options for the observer (which mutations to observe)
        const config = { attributes: true, childList: true, subtree: true };

        // Callback function to execute when mutations are observed
        const callback = (mutationList, observer) => {
            const title = getTrackTitle();
            if (title && currentTrack.title !== title) {
                currentTrack.title = title;
                currentTrack.artist = getTrackArtist();

                const id = getTrackId();
                if (id && id !== currentTrack.id) {
                    currentTrack.id = id;
                    const skipped = checkSkip();
                    if (!skipped) {
                        setStatusText(`${currentTrack.title} - ${currentTrack.artist}`);
                    }
                }
            }
        };

        // Create an observer instance linked to the callback function
        const observer = new MutationObserver(callback);

        // Start observing the target node for configured mutations
        observer.observe(el, {childList: true});
    }

    GM_addStyle(`#reducers-modal td, th { padding: 4px 8px; }`);
    injectStylesheet("https://cdnjs.cloudflare.com/ajax/libs/toastify-js/1.12.0/toastify.css");
    appendReducers();
    setupMutationObserver(queryElements(".middle-controls .content-info-wrapper .title"));

    // Load previously saved reducers.
    reducers = GM_getValue("reducers");
    if (!reducers) {
        reducers = {};
    } else {
        reducers = JSON.parse(reducers);
    }
})();
