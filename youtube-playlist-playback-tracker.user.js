// ==UserScript==
// @name         YouTube: playlists playback tracker
// @namespace    http://tampermonkey.net/
// @version      2
// @description  This script helps watch playlists. It tracks the last video from a playlist that you've watched on this computer.
// @author       Andrei Rybak
// @license      MIT
// @match        https://www.youtube.com/playlist?list=*
// @match        https://www.youtube.com/watch?*&list=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.listValues
// @grant        GM.deleteValue
// ==/UserScript==

/*
 * Copyright (c) 2023 Andrei Rybak
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

(async function() {
	'use strict';

	const urlParams = new URLSearchParams(document.location.search);

	// never change -- used as part of IDs in storage in user's browser
	const STORAGE_KEY_PREFIX = "YT_PL_TRACKER_";
	const STORAGE_KEY_VIDEO_SUFFIX = "_VIDEO";
	const STORAGE_KEY_DATE_SUFFIX = "_DATE";

	// number of milliseconds to wait, until a video is considered "watched"
	const SAVE_DELAY = 60000;
	// hack to wait for necessary parts of the UI to load, in milliseconds
	const YOUTUBE_UI_LOAD_DELAY = 6000;

	function warn(...toLog) {
		console.warn("[playlist tracker]", ...toLog);
	}

	function log(...toLog) {
		console.log("[playlist tracker]", ...toLog);
	}

	function videoStorageKey(id) {
		return STORAGE_KEY_PREFIX + id + STORAGE_KEY_VIDEO_SUFFIX;
	}

	function dateStorageKey(id) {
		return STORAGE_KEY_PREFIX + id + STORAGE_KEY_DATE_SUFFIX;
	}

	function dateToString(d) {
		return d.toISOString().slice(0, "YYYY-MM-DD".length);
	}

	function videoInPlaylistUrl(videoId, listId) {
		return `https://www.youtube.com/watch?v=${videoId}&list=${listId}`;
	}

	function createVideoTitle(videoId) {
		let links = document.querySelectorAll("#contents.ytd-playlist-video-list-renderer h3 a");
		for (let i = 0; i < links.length; i++) {
			const link = links[i];
			if (link.href.includes(videoId)) {
				return link.title;
			}
		}
		// fallback is needed, because as of 2023-02-04 YouTube only loads 100 videos
		// into the playlist controls, unless the user scrolls through it
		return videoId;
	}

	function createLink(videoId, listId, date) {
		const newLink = document.createElement("a");
		newLink.id = 'YT_PL_TRACKER_LINK';
		newLink.href = videoInPlaylistUrl(videoId, listId);
		const videoTitle = createVideoTitle(videoId);
		newLink.innerText = `Continue watching "${videoTitle}" from ${date}.`;
		newLink.style = `color: white;`;
		return newLink;
	}


	async function displaySavedVideoIndex(listId) {
		log("Displaying saved video index...");
		if (!listId) {
			warn("Can't find parameter 'list' in the URL. Aborting.");
			return;
		}
		const maybeVideoId = await GM.getValue(videoStorageKey(listId));
		if (!maybeVideoId) {
			log(`No video stored for list ${listId} yet.`);
			return;
		}
		const date = await GM.getValue(dateStorageKey(listId));
		log(`Showing stored video ${maybeVideoId} from date ${date}. Waiting for ${YOUTUBE_UI_LOAD_DELAY} ms...`);
		setTimeout(() => { // stupid way of waiting until YouTube UI loads
			log("Starting actual HTML edit...");
			const header = document.querySelector(".metadata-buttons-wrapper");
			const newLink = createLink(maybeVideoId, listId, date);
			log("newLink =", newLink);
			header.appendChild(newLink);
			log("HTML edit finished.");
		}, YOUTUBE_UI_LOAD_DELAY);
	}

	async function storeVideo(listId, videoId) {
		log(`Storing ${videoId} as video for list ${listId}.`);
		await GM.setValue(videoStorageKey(listId), videoId);
		await storeDate(listId);
	}

	async function storeDate(listId) {
		const dateStr = dateToString(new Date());
		await GM.setValue(dateStorageKey(listId), dateStr);
	}

	function removePrefixSuffix(s, pref, suf) {
		return s.slice(pref.length, -suf.length);
	}

	async function clearOldVideos() {
		const keys = await GM.listValues();
		log("Clearing old videos...");
		const currentYear = new Date().getFullYear();
		for (const key of keys) {
			if (!key.endsWith(STORAGE_KEY_DATE_SUFFIX)) {
				continue;
			}
			const dateKey = key;
			const dateStr = await GM.getValue(dateKey);
			const listId = removePrefixSuffix(dateKey, STORAGE_KEY_PREFIX, STORAGE_KEY_DATE_SUFFIX);
			const videoKey = videoStorageKey(listId);
			if (!dateStr) {
				// clean up corrupted data, etc
				GM.deleteValue(dateKey);
				GM.deleteValue(videoKey);
				continue;
			}
			const year = parseInt(dateStr.slice(0, "YYYY".length));
			log(`Checking ${dateKey} -> ${dateStr} -> ${year} -> ${listId}`);
			if (year < currentYear - 1) {
				const videoId = await GM.getValue(videoKey);
				const url = videoInPlaylistUrl(videoId, listId);
				log(`Deleting outdated list ${listId} -> ${url} on date ${dateStr}`);
				GM.deleteValue(dateKey);
				GM.deleteValue(videoKey);
			}
		}
	}

	log("document.location.pathname =", document.location.pathname);

	const listId = urlParams.get('list');

	if (document.location.pathname == "/playlist") {
		displaySavedVideoIndex(listId);
		setTimeout(clearOldVideos, SAVE_DELAY);
	}

	const videoId = urlParams.get('v');
	if (document.location.pathname == "/watch" && videoId && listId) {
		// only store a video after it was watched for a minute (for debugging only 2-5 seconds)
		setTimeout(() => {
			storeVideo(listId, videoId);
			clearOldVideos();
		}, SAVE_DELAY);
	}

	log("Done");
})();
