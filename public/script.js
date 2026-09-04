/* ============================================================
   INSTADROP - INSTAGRAM DOWNLOADER
   Single API provider
   ============================================================ */

"use strict";

/* ============================================================
   CONFIG
   ============================================================ */

const INSTADROP_API =
    "https://instadrop.rishu-rishad2019.workers.dev/?url=";


/* ============================================================
   BASIC HELPERS
   ============================================================ */

function $(selector, parent = document) {
    return parent.querySelector(selector);
}

function $$(selector, parent = document) {
    return [...parent.querySelectorAll(selector)];
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function isInstagramUrl(url) {
    try {
        const parsed = new URL(url);

        return (
            parsed.hostname === "instagram.com" ||
            parsed.hostname === "www.instagram.com" ||
            parsed.hostname.endsWith(".instagram.com")
        );
    } catch {
        return false;
    }
}

function normalizeInstagramUrl(url) {
    url = String(url || "").trim();

    if (!url) return "";

    if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
    }

    return url;
}

function filenameFromUrl(url, fallback = "instadrop-download") {
    try {
        const parsed = new URL(url);
        const pathname = parsed.pathname || "";
        const last = pathname.split("/").filter(Boolean).pop();

        if (last) {
            return decodeURIComponent(last)
                .replace(/[^\w.-]+/g, "_")
                .slice(0, 120);
        }
    } catch {}

    return fallback;
}

function guessExtension(url, type = "") {
    const value = String(url || "").toLowerCase();

    if (type.includes("video") || value.includes(".mp4")) {
        return ".mp4";
    }

    if (
        type.includes("audio") ||
        value.includes(".mp3") ||
        value.includes(".m4a")
    ) {
        return ".mp3";
    }

    if (
        value.includes(".webp")
    ) {
        return ".webp";
    }

    if (
        value.includes(".png")
    ) {
        return ".png";
    }

    return ".jpg";
}


/* ============================================================
   API
   ============================================================ */

async function callInstadrop(instagramUrl) {
    const url = normalizeInstagramUrl(instagramUrl);

    if (!url) {
        throw new Error("Please enter an Instagram URL.");
    }

    if (!isInstagramUrl(url)) {
        throw new Error("Please enter a valid Instagram URL.");
    }

    const endpoint =
        INSTADROP_API + encodeURIComponent(url);

    const response = await fetch(endpoint, {
        method: "GET",
        headers: {
            "Accept": "application/json, text/plain, */*"
        }
    });

    if (!response.ok) {
        throw new Error(
            `API request failed (${response.status})`
        );
    }

    const contentType =
        response.headers.get("content-type") || "";

    let data;

    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        const text = await response.text();

        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }

    if (
        data &&
        typeof data === "object" &&
        (
            data.error ||
            data.success === false ||
            data.status === false
        )
    ) {
        throw new Error(
            data.message ||
            data.error ||
            "Instadrop could not process this URL."
        );
    }

    return data;
}


/* ============================================================
   OPTIONAL PERCHANCE SUPER FETCH
   ============================================================ */

async function superFetch(url, options = {}) {
    if (
        typeof window !== "undefined" &&
        window.root &&
        typeof window.root.superFetch === "function"
    ) {
        try {
            return await window.root.superFetch(url, options);
        } catch {}
    }

    return fetch(url, options);
}


/* ============================================================
   DATA EXTRACTION
   ============================================================ */

function collectUrls(value, result = [], seen = new Set()) {
    if (value == null) {
        return result;
    }

    if (typeof value === "string") {
        const valueTrimmed = value.trim();

        if (
            /^https?:\/\//i.test(valueTrimmed) &&
            !seen.has(valueTrimmed)
        ) {
            seen.add(valueTrimmed);
            result.push(valueTrimmed);
        }

        return result;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            collectUrls(item, result, seen);
        }

        return result;
    }

    if (typeof value === "object") {
        for (const key of Object.keys(value)) {
            const item = value[key];

            if (
                typeof item === "string" &&
                /^https?:\/\//i.test(item.trim())
            ) {
                collectUrls(item, result, seen);
            } else if (
                typeof item === "object" &&
                item !== null
            ) {
                collectUrls(item, result, seen);
            }
        }
    }

    return result;
}

function findMediaItems(data) {
    const items = [];
    const seen = new Set();

    function add(url, type = "image", extra = {}) {
        if (!url || typeof url !== "string") {
            return;
        }

        if (!/^https?:\/\//i.test(url)) {
            return;
        }

        if (seen.has(url)) {
            return;
        }

        seen.add(url);

        items.push({
            url,
            type,
            ...extra
        });
    }

    function walk(value) {
        if (!value) return;

        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }

        if (typeof value !== "object") {
            return;
        }

        const possibleUrlKeys = [
            "url",
            "download_url",
            "downloadUrl",
            "media_url",
            "mediaUrl",
            "src",
            "source",
            "video_url",
            "videoUrl",
            "image_url",
            "imageUrl",
            "thumbnail",
            "thumbnail_url",
            "thumbnailUrl",
            "display_url",
            "displayUrl",
            "display_src",
            "displaySrc"
        ];

        let detected = false;

        for (const key of possibleUrlKeys) {
            const candidate = value[key];

            if (
                typeof candidate === "string" &&
                /^https?:\/\//i.test(candidate.trim())
            ) {
                const lowerKey = key.toLowerCase();

                let type = "image";

                if (
                    lowerKey.includes("video") ||
                    lowerKey.includes("mp4")
                ) {
                    type = "video";
                }

                if (
                    lowerKey.includes("audio")
                ) {
                    type = "audio";
                }

                add(candidate, type, value);

                detected = true;
            }
        }

        if (
            typeof value.type === "string" ||
            typeof value.media_type === "string" ||
            typeof value.mediaType === "string"
        ) {
            const typeValue = String(
                value.type ||
                value.media_type ||
                value.mediaType ||
                ""
            ).toLowerCase();

            const candidate =
                value.url ||
                value.download_url ||
                value.downloadUrl ||
                value.media_url ||
                value.mediaUrl;

            if (
                candidate &&
                typeof candidate === "string"
            ) {
                if (
                    typeValue.includes("video")
                ) {
                    add(candidate, "video", value);
                } else if (
                    typeValue.includes("audio")
                ) {
                    add(candidate, "audio", value);
                } else {
                    add(candidate, "image", value);
                }

                detected = true;
            }
        }

        for (const key of Object.keys(value)) {
            const child = value[key];

            if (
                child &&
                typeof child === "object"
            ) {
                walk(child);
            }
        }
    }

    walk(data);

    return items;
}


/* ============================================================
   RESULT NORMALIZATION
   ============================================================ */

function normalizeResult(data) {
    const media = findMediaItems(data);

    let profile = null;

    if (data && typeof data === "object") {
        profile =
            data.profile ||
            data.user ||
            data.author ||
            data.owner ||
            null;
    }

    const text =
        data?.caption ||
        data?.description ||
        data?.title ||
        data?.message ||
        "";

    return {
        raw: data,
        media,
        profile,
        text
    };
}


/* ============================================================
   DOWNLOAD
   ============================================================ */

async function downloadMedia(url, filename = "") {
    if (!url) {
        throw new Error("Download URL is missing.");
    }

    const extension = guessExtension(url);

    if (!filename) {
        filename =
            filenameFromUrl(url, "instadrop") +
            extension;
    }

    if (!filename.includes(".")) {
        filename += extension;
    }

    /*
     * First try direct browser download.
     */
    try {
        const response = await fetch(url);

        if (response.ok) {
            const blob = await response.blob();

            const blobUrl =
                URL.createObjectURL(blob);

            const a =
                document.createElement("a");

            a.href = blobUrl;
            a.download = filename;
            a.style.display = "none";

            document.body.appendChild(a);
            a.click();
            a.remove();

            setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
            }, 5000);

            return true;
        }
    } catch {}

    /*
     * Fallback to normal link.
     */
    const a =
        document.createElement("a");

    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    document.body.appendChild(a);
    a.click();
    a.remove();

    return true;
}


/* ============================================================
   DOWNLOAD ALL
   ============================================================ */

async function downloadAllMedia(media) {
    if (!Array.isArray(media) || !media.length) {
        throw new Error("No downloadable media found.");
    }

    for (let i = 0; i < media.length; i++) {
        const item = media[i];

        const extension =
            guessExtension(
                item.url,
                item.type
            );

        const filename =
            `instadrop-${i + 1}${extension}`;

        try {
            await downloadMedia(
                item.url,
                filename
            );
        } catch (error) {
            console.warn(
                "Download failed:",
                item.url,
                error
            );
        }

        /*
         * Small delay prevents browsers from blocking
         * multiple downloads.
         */
        await new Promise(resolve =>
            setTimeout(resolve, 300)
        );
    }
}


/* ============================================================
   UI
   ============================================================ */

function createElement(tag, className = "", html = "") {
    const element =
        document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (html) {
        element.innerHTML = html;
    }

    return element;
}

function getMainInput() {
    return (
        $("#instagram-url") ||
        $("#url") ||
        $("#input-url") ||
        $('input[type="url"]') ||
        $('input[placeholder*="instagram" i]')
    );
}

function getResultsContainer() {
    return (
        $("#results") ||
        $("#result") ||
        $("#output") ||
        $("#downloads") ||
        $("#media-results")
    );
}

function showMessage(message, type = "info") {
    let box =
        $("#instadrop-message");

    if (!box) {
        box =
            createElement(
                "div",
                "instadrop-message"
            );

        box.id =
            "instadrop-message";

        const container =
            getResultsContainer() ||
            document.body;

        container.prepend(box);
    }

    box.textContent =
        message;

    box.dataset.type =
        type;

    box.style.display =
        "block";
}

function hideMessage() {
    const box =
        $("#instadrop-message");

    if (box) {
        box.style.display =
            "none";
    }
}


/* ============================================================
   RESULT RENDERER
   ============================================================ */

function renderResults(result) {
    const container =
        getResultsContainer();

    if (!container) {
        console.log(
            "Instadrop result:",
            result
        );
        return;
    }

    container.innerHTML = "";

    const media =
        result.media || [];

    if (!media.length) {
        const pre =
            createElement("pre");

        pre.textContent =
            JSON.stringify(
                result.raw,
                null,
                2
            );

        container.appendChild(pre);

        return;
    }

    const grid =
        createElement(
            "div",
            "instadrop-media-grid"
        );

    media.forEach((item, index) => {
        const card =
            createElement(
                "div",
                "instadrop-media-card"
            );

        let preview;

        if (item.type === "video") {
            preview =
                createElement("video");

            preview.src =
                item.url;

            preview.controls = true;
            preview.preload = "metadata";
        } else {
            preview =
                createElement("img");

            preview.src =
                item.url;

            preview.alt =
                `Instagram media ${index + 1}`;

            preview.loading =
                "lazy";
        }

        preview.className =
            "instadrop-preview";

        const downloadButton =
            createElement(
                "button",
                "instadrop-download",
                "Download"
            );

        downloadButton.type =
            "button";

        downloadButton.addEventListener(
            "click",
            async () => {
                try {
                    downloadButton.disabled =
                        true;

                    downloadButton.textContent =
                        "Downloading...";

                    const extension =
                        guessExtension(
                            item.url,
                            item.type
                        );

                    await downloadMedia(
                        item.url,
                        `instadrop-${index + 1}${extension}`
                    );

                    downloadButton.textContent =
                        "Downloaded";
                } catch (error) {
                    console.error(error);

                    downloadButton.disabled =
                        false;

                    downloadButton.textContent =
                        "Download";

                    showMessage(
                        error.message ||
                        "Download failed.",
                        "error"
                    );
                }
            }
        );

        card.appendChild(preview);
        card.appendChild(downloadButton);
        grid.appendChild(card);
    });

    container.appendChild(grid);

    if (media.length > 1) {
        const allButton =
            createElement(
                "button",
                "instadrop-download-all",
                "Download All"
            );

        allButton.type =
            "button";

        allButton.addEventListener(
            "click",
            async () => {
                try {
                    allButton.disabled =
                        true;

                    allButton.textContent =
                        "Downloading...";

                    await downloadAllMedia(
                        media
                    );

                    allButton.textContent =
                        "Downloaded";
                } catch (error) {
                    allButton.disabled =
                        false;

                    allButton.textContent =
                        "Download All";

                    showMessage(
                        error.message ||
                        "Download failed.",
                        "error"
                    );
                }
            }
        );

        container.appendChild(
            allButton
        );
    }

    if (result.profile) {
        renderProfileInfo(
            result.profile,
            container
        );
    }

    if (result.text) {
        const caption =
            createElement(
                "div",
                "instadrop-caption"
            );

        caption.textContent =
            result.text;

        container.appendChild(
            caption
        );
    }
}


/* ============================================================
   PROFILE INFO
   ============================================================ */

function renderProfileInfo(profile, container) {
    if (!profile) return;

    const section =
        createElement(
            "div",
            "instadrop-profile"
        );

    const username =
        profile.username ||
        profile.userName ||
        profile.handle ||
        "";

    const fullName =
        profile.full_name ||
        profile.fullName ||
        profile.name ||
        "";

    const bio =
        profile.biography ||
        profile.bio ||
        "";

    const followers =
        profile.followers ||
        profile.follower_count ||
        profile.followers_count ||
        "";

    const following =
        profile.following ||
        profile.following_count ||
        "";

    const posts =
        profile.posts ||
        profile.media_count ||
        profile.post_count ||
        "";

    const image =
        profile.profile_pic_url ||
        profile.profile_picture ||
        profile.profilePic ||
        profile.avatar ||
        profile.image ||
        "";

    if (image) {
        const img =
            createElement("img");

        img.src =
            image;

        img.alt =
            username || "Profile";

        img.className =
            "instadrop-profile-image";

        section.appendChild(
            img
        );
    }

    if (username || fullName) {
        const title =
            createElement(
                "h3"
            );

        title.textContent =
            fullName
                ? `${fullName}${username ? ` (@${username})` : ""}`
                : `@${username}`;

        section.appendChild(
            title
        );
    }

    if (bio) {
        const bioElement =
            createElement(
                "p"
            );

        bioElement.textContent =
            bio;

        section.appendChild(
            bioElement
        );
    }

    const stats = [];

    if (followers !== "") {
        stats.push(
            `Followers: ${followers}`
        );
    }

    if (following !== "") {
        stats.push(
            `Following: ${following}`
        );
    }

    if (posts !== "") {
        stats.push(
            `Posts: ${posts}`
        );
    }

    if (stats.length) {
        const statsElement =
            createElement(
                "div",
                "instadrop-profile-stats"
            );

        statsElement.textContent =
            stats.join(" • ");

        section.appendChild(
            statsElement
        );
    }

    container.appendChild(
        section
    );
}


/* ============================================================
   MAIN PROCESSOR
   ============================================================ */

async function processInstagramUrl(url) {
    hideMessage();

    const normalized =
        normalizeInstagramUrl(url);

    if (!normalized) {
        throw new Error(
            "Please enter an Instagram URL."
        );
    }

    if (!isInstagramUrl(normalized)) {
        throw new Error(
            "Please enter a valid Instagram URL."
        );
    }

    showMessage(
        "Processing with Instadrop...",
        "loading"
    );

    const data =
        await callInstadrop(
            normalized
        );

    const result =
        normalizeResult(data);

    renderResults(result);

    showMessage(
        result.media.length
            ? `${result.media.length} media item(s) found.`
            : "Information received from Instadrop.",
        "success"
    );

    return result;
}


/* ============================================================
   FORM HANDLING
   ============================================================ */

function findSubmitButton() {
    return (
        $("#download-btn") ||
        $("#downloadButton") ||
        $("#submit") ||
        $("#search-btn") ||
        $("#searchButton") ||
        $("button[type='submit']")
    );
}

function setupForm() {
    const input =
        getMainInput();

    if (!input) {
        return;
    }

    let form =
        input.closest("form");

    const button =
        findSubmitButton();

    async function submit() {
        const url =
            input.value.trim();

        if (!url) {
            showMessage(
                "Please enter an Instagram URL.",
                "error"
            );
            return;
        }

        if (button) {
            button.disabled =
                true;

            button.dataset.oldText =
                button.textContent;

            button.textContent =
                "Processing...";
        }

        try {
            await processInstagramUrl(
                url
            );
        } catch (error) {
            console.error(
                "Instadrop error:",
                error
            );

            showMessage(
                error.message ||
                "Something went wrong.",
                "error"
            );
        } finally {
            if (button) {
                button.disabled =
                    false;

                button.textContent =
                    button.dataset.oldText ||
                    "Download";
            }
        }
    }

    if (form) {
        form.addEventListener(
            "submit",
            event => {
                event.preventDefault();
                submit();
            }
        );
    } else if (button) {
        button.addEventListener(
            "click",
            event => {
                event.preventDefault();
                submit();
            }
        );
    }

    input.addEventListener(
        "keydown",
        event => {
            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {
                event.preventDefault();
                submit();
            }
        }
    );
}


/* ============================================================
   CLIPBOARD / PASTE SUPPORT
   ============================================================ */

function setupPasteSupport() {
    const input =
        getMainInput();

    if (!input) return;

    input.addEventListener(
        "paste",
        () => {
            setTimeout(() => {
                input.value =
                    input.value.trim();
            }, 0);
        }
    );
}


/* ============================================================
   CLEAR BUTTON
   ============================================================ */

function setupClearButton() {
    const buttons =
        $$(
            "#clear, #clear-btn, #clearButton, .clear-button"
        );

    const input =
        getMainInput();

    buttons.forEach(button => {
        button.addEventListener(
            "click",
            () => {
                if (input) {
                    input.value = "";
                    input.focus();
                }

                const container =
                    getResultsContainer();

                if (container) {
                    container.innerHTML =
                        "";
                }

                hideMessage();
            }
        );
    });
}


/* ============================================================
   COPY BUTTON SUPPORT
   ============================================================ */

function setupCopyButtons() {
    document.addEventListener(
        "click",
        async event => {
            const button =
                event.target.closest(
                    "[data-copy]"
                );

            if (!button) return;

            const value =
                button.dataset.copy;

            if (!value) return;

            try {
                await navigator.clipboard.writeText(
                    value
                );

                const old =
                    button.textContent;

                button.textContent =
                    "Copied";

                setTimeout(() => {
                    button.textContent =
                        old;
                }, 1500);
            } catch {
                showMessage(
                    "Could not copy.",
                    "error"
                );
            }
        }
    );
}


/* ============================================================
   API HELPER FUNCTIONS
   ============================================================ */

/*
 * These functions all use the SAME Instadrop API.
 * There are no separate APIs for post/reel/story/profile/etc.
 */

async function getInstagramPost(url) {
    return callInstadrop(url);
}

async function getInstagramReel(url) {
    return callInstadrop(url);
}

async function getInstagramCarousel(url) {
    return callInstadrop(url);
}

async function getInstagramStory(url) {
    return callInstadrop(url);
}

async function getInstagramHighlight(url) {
    return callInstadrop(url);
}

async function getInstagramProfile(url) {
    return callInstadrop(url);
}

async function getInstagramProfileInfo(url) {
    return callInstadrop(url);
}

async function getInstagramInfo(url) {
    return callInstadrop(url);
}


/* ============================================================
   PUBLIC API
   ============================================================ */

window.InstaDrop = {
    api: INSTADROP_API,

    request: callInstadrop,

    process: processInstagramUrl,

    post: getInstagramPost,
    reel: getInstagramReel,
    carousel: getInstagramCarousel,
    story: getInstagramStory,
    highlight: getInstagramHighlight,

    profile: getInstagramProfile,
    profileInfo: getInstagramProfileInfo,
    info: getInstagramInfo,

    download: downloadMedia,
    downloadAll: downloadAllMedia,

    normalize: normalizeResult,
    media: findMediaItems
};


/* ============================================================
   INITIALIZATION
   ============================================================ */

function initInstadrop() {
    setupForm();
    setupPasteSupport();
    setupClearButton();
    setupCopyButtons();

    console.log(
        "Instadrop initialized."
    );

    console.log(
        "API:",
        INSTADROP_API
    );
}

if (
    document.readyState === "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        initInstadrop
    );
} else {
    initInstadrop();
}
