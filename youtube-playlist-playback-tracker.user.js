// ==UserScript==
// @name         YouTube: playlists playback tracker
// @namespace    https://github.com/rybak
// @homepageURL  https://github.com/rybak/yt-ppt
// @version      9
// @description  This script helps watching playlists. It tracks the last video from a playlist that you've watched on this computer.
// @author       Andrei Rybak
// @license      MIT
// @match        https://www.youtube.com/playlist?list=*
// @match        https://www.youtube.com/watch?*&list=*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.listValues
// @grant        GM.deleteValue
// @grant        GM_addStyle
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
	const STORAGE_KEY_VIDEO_INFO_SUFFIX = "_VIDEO_INFO";

	const OTHER_PLAYLISTS_LIST_ID = "YT_PL_TRACKER_OTHER_VIDEOS_LIST";

	// number of milliseconds to wait, until a video is considered "watched"
	const SAVE_DELAY = 60000;
	// hack to wait for necessary parts of the UI to load, in milliseconds
	const YOUTUBE_UI_LOAD_DELAY = 2000;

	function error(...toLog) {
		console.error("[playlist tracker]", ...toLog);
	}

	function warn(...toLog) {
		console.warn("[playlist tracker]", ...toLog);
	}

	function log(...toLog) {
		console.log("[playlist tracker]", ...toLog);
	}

	function videoStorageKey(id) {
		return STORAGE_KEY_PREFIX + id + STORAGE_KEY_VIDEO_SUFFIX;
	}

	function infoStorageKey(id) {
		return STORAGE_KEY_PREFIX + id + STORAGE_KEY_VIDEO_INFO_SUFFIX;
	}

	async function loadInfo(id) {
		const infoKey = infoStorageKey(id);
		const s = await GM.getValue(infoKey);
		if (!s) {
			return null;
		}
		try {
			return JSON.parse(s);
		} catch (e) {
			error(`Couldn't parse info for ${id} - ${infoKey}.`, e);
			return null;
		}
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

	async function fallbackVideoTitle(videoId) {
		// fallback to finding the video title on the playlist
		let links = document.querySelectorAll("#contents.ytd-playlist-video-list-renderer h3 a");
		if (!links) {
			return videoId;
		}
		for (let i = 0; i < links.length; i++) {
			const link = links[i];
			if (link.href.includes(videoId)) {
				return link.title;
			}
		}
		return videoId;
	}

	function createLink(videoId, listId, date, videoTitle, channelName) {
		const newLink = document.createElement("a");
		newLink.href = videoInPlaylistUrl(videoId, listId);
		newLink.innerText = `"${videoTitle}" from ${channelName} (watched on ${date}).`;
		newLink.style = `color: white;`;
		return newLink;
	}

	async function showStoredVideoLink(listId) {
		log("Showing stored video link...");
		if (!listId) {
			warn("Can't find parameter 'list' in the URL. Aborting.");
			return;
		}
		const maybeInfo = await loadInfo(listId);
		let maybeVideoId = maybeInfo?.id;
		if (!maybeVideoId) {
			maybeVideoId = await GM.getValue(videoStorageKey(listId));
		}
		if (!maybeVideoId) {
			log(`No video stored for list ${listId} yet.`);
			return;
		}
		const videoId = maybeVideoId;
		let dateStr = maybeInfo?.dateStr;
		if (!dateStr) {
			dateStr = await GM.getValue(dateStorageKey(listId));
		}
		log(`Showing stored video ${videoId} from date ${dateStr}. Waiting for ${YOUTUBE_UI_LOAD_DELAY} ms...`);
		async function doShow() { // stupid way of waiting until YouTube UI loads
			const header = document.querySelector(".metadata-buttons-wrapper");
			if (!header) {
				log("UI hasn't loaded yet for showing the video. Retrying...");
				setTimeout(doShow, YOUTUBE_UI_LOAD_DELAY);
				return;
			}
			log("Starting actual HTML edit...");
			let videoTitle = maybeInfo?.title;
			if (!videoTitle) {
				videoTitle = await fallbackVideoTitle(videoId);
			}
			const channelName = maybeInfo?.channelName;
			const newLink = createLink(videoId, listId, dateStr, videoTitle, channelName);
			newLink.id = "YT_PL_TRACKER_LINK";
			log("newLink =", newLink);
			const wrapper = document.createElement("span");
			wrapper.innerText = "Continue watching ";
			wrapper.appendChild(newLink);
			header.appendChild(wrapper);
			log("HTML edit finished.");
		}
		doShow();
	}

	function getVideoTitle() {
		return document.querySelector('meta[name="title"]')?.content;
	}

	function getVideoChannelName() {
		return document.getElementById("channel-name")?.outerText;
	}

	async function storeVideo(listId, videoId) {
		const videoTitle = getVideoTitle();
		const dateStr = dateToString(new Date());
		const channelName = getVideoChannelName();
		const info = {
			'id': videoId,
			'title': videoTitle,
			'dateStr': dateStr,
			'channelName': channelName
		};
		const infoToLog = JSON.stringify(info);
		log(`Storing ${infoToLog} as video for list ${listId}.`);
		await GM.setValue(infoStorageKey(listId), JSON.stringify(info));
		/*
		 * Yes, this is a dumb way of storing data, but I have to keep
		 * storing dates separately for backwards compatibility.
		 */
		await GM.setValue(dateStorageKey(listId), dateStr);
	}

	function removePrefixSuffix(s, pref, suf) {
		return s.slice(pref.length, -suf.length);
	}

	async function forEachStoredVideo(f) {
		const keys = await GM.listValues();
		for (const key of keys) {
			/*
			 * Yes, this is a dumb way of storing data, but I have to keep
			 * checking stored dates for backwards compatibility.
			 */
			if (!key.endsWith(STORAGE_KEY_DATE_SUFFIX)) {
				continue;
			}
			const dateKey = key;
			const dateStr = await GM.getValue(dateKey);
			const listId = removePrefixSuffix(dateKey, STORAGE_KEY_PREFIX, STORAGE_KEY_DATE_SUFFIX);
			const videoKey = videoStorageKey(listId);
			const infoKey = infoStorageKey(listId);
			if (!dateStr) {
				// clean up corrupted data, etc
				GM.deleteValue(dateKey);
				GM.deleteValue(videoKey);
				GM.deleteValue(infoKey);
				continue;
			}
			const info = await loadInfo(listId);
			let videoId = info?.id;
			if (!videoId) {
				videoId = await GM.getValue(videoKey);
			}
			try {
				f(listId, videoId, dateStr, info);
			} catch (e) {
				error(`Could not process ${key}: [${listId}, ${videoId}, ${dateStr}]`, e)
			}
		}
	}

	async function clearOldVideos() {
		const keys = await GM.listValues();
		log("Clearing old videos...");
		const currentYear = new Date().getFullYear();
		forEachStoredVideo(async (listId, videoId, dateStr, info) => {
			const dateKey = dateStorageKey(listId);
			const videoKey = videoStorageKey(listId);
			const year = parseInt(dateStr.slice(0, "YYYY".length));
			log(`Checking ${dateKey} -> ${dateStr} -> ${year} -> ${listId}`);
			if (year < currentYear - 3) {
				const url = videoInPlaylistUrl(videoId, listId);
				log(`Deleting outdated list ${listId} -> ${url} on date ${dateStr}`);
				GM.deleteValue(dateKey);
				GM.deleteValue(videoKey);
			}
		});
	}

	async function showOtherPlaylists(currentListId) {
		const otherPlaylistsList = document.createElement('ul');
		otherPlaylistsList.id = OTHER_PLAYLISTS_LIST_ID;
		let items = [];
		// `await` to make sure that list `items` is populated before sorting
		await forEachStoredVideo(async (listId, videoId, dateStr, info) => {
			if (listId == currentListId) {
				return;
			}
			const infoToLog = JSON.stringify(info);
			log(`Listing ${listId} -> ${infoToLog}`);
			const li = document.createElement('li');
			const videoTitle = info?.title;
			const channelName = info?.channelName;
			const link = createLink(videoId, listId, dateStr, videoTitle ? videoTitle : videoId, channelName);
			li.appendChild(link);
			li.append(" "); // spacer
			const deleteButton = document.createElement('a');
			deleteButton.innerText = "[x]";
			deleteButton.title = "Delete this video";
			deleteButton.style = `color: grey;`;
			deleteButton.href = "#";
			deleteButton.onclick = function(e) {
				e.preventDefault();
				const confirmed = window.confirm(`Are you sure you want to delete video "${videoTitle}" (${videoId}) from YouTube playlist playback tracker?`);
				if (!confirmed) {
					log(`Aborting deletion of "${videoTitle}" (${videoId}).`);
					return;
				}
				log(`Deleting "${videoTitle}" (${videoId}) from tracker...`);
				const dateKey = dateStorageKey(listId);
				const videoKey = videoStorageKey(listId);
				const infoKey = infoStorageKey(listId);
				GM.deleteValue(dateKey);
				GM.deleteValue(videoKey);
				GM.deleteValue(infoKey);
				otherPlaylistsList.removeChild(li);
				log(`Video "${videoTitle}" (${videoId}) was deleted.`);
			};
			li.appendChild(deleteButton);
			items.push({
				"dateStr": dateStr,
				"li": li
			});
		});
		items.sort((a, b) => {
			// reverse order, so most recently viewed is on top
			return a.dateStr < b.dateStr ? 1 : -1;
		});
		function doShow() {
			const playlistHeader = document.querySelector('ytd-playlist-header-renderer .immersive-header-content.style-scope.ytd-playlist-header-renderer');
			if (!playlistHeader) {
				log("UI hasn't loaded yet for showing other playlists. Retrying...");
				setTimeout(doShow, YOUTUBE_UI_LOAD_DELAY);
				return;
			}
			GM_addStyle(`
				#${OTHER_PLAYLISTS_LIST_ID} a {
				  text-decoration: none;
				}
				#${OTHER_PLAYLISTS_LIST_ID} a:hover {
				  text-decoration: underline;
				}
				#${OTHER_PLAYLISTS_LIST_ID} {
				  list-style-type: disclosure-closed;
				  list-style-position: inside;
				}
				#${OTHER_PLAYLISTS_LIST_ID} li {
				  padding: initial;
				}
				#${OTHER_PLAYLISTS_LIST_ID} li::marker {
				  font-size: initial;
				}
			`);
			log("Showing", items.length, "videos");
			for (const item of items) {
				otherPlaylistsList.appendChild(item.li);
			}
			const otherHeader = document.createElement('span');
			otherHeader.style = "font-size: large;";
			otherHeader.innerText = "Other playlists";
			playlistHeader.appendChild(otherHeader);
			playlistHeader.appendChild(otherPlaylistsList);
		}
		doShow();
	}

	log("document.location.pathname =", document.location.pathname);

	const listId = urlParams.get('list');

	if (document.location.pathname == "/playlist") {
		showStoredVideoLink(listId);
		showOtherPlaylists(listId);
		setTimeout(clearOldVideos, SAVE_DELAY);
	}

	const currentVideoId = urlParams.get('v');
	if (document.location.pathname == "/watch" && currentVideoId && listId) {
		// only store a video after it was watched for a minute (for debugging only 2-5 seconds)
		setTimeout(() => {
			storeVideo(listId, currentVideoId);
			clearOldVideos();
		}, SAVE_DELAY);
	}

	log("Waiting for async parts to complete...");
})();
