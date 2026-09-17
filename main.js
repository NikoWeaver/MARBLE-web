// Media slots: <figure class="slot" data-video="..." data-poster="..." data-speed="...">
// The poster (a still from the paper) or a dark box shows until the clip loads.
// A missing clip leaves a "Video placeholder: <path>" tag so the empty slot is obvious.
(function () {
  "use strict";
  const slots = [...document.querySelectorAll(".slot")];

  slots.forEach((slot) => {
    const frame = slot.querySelector(".media-frame");
    const src = slot.dataset.video;
    const poster = slot.dataset.poster;
    if (poster && !frame.querySelector("img")) {
      const img = document.createElement("img");
      img.src = poster;
      img.alt = "";
      img.decoding = "async";
      img.onerror = () => img.remove();
      frame.prepend(img);
    }
    if (slot.dataset.speed) {
      const badge = document.createElement("span");
      badge.className = "speed-badge";
      badge.textContent = slot.dataset.speed;
      frame.append(badge);
    }
    const tag = document.createElement("span");
    tag.className = "slot-tag";
    tag.textContent = "Video placeholder: " + (src || "(no path set)");
    frame.append(tag);
  });

  function load(slot) {
    if (slot.dataset.loaded || !slot.dataset.video) return;
    slot.dataset.loaded = "1";
    const frame = slot.querySelector(".media-frame");
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    if (slot.dataset.poster) v.poster = slot.dataset.poster;
    v.setAttribute("aria-label", slot.getAttribute("aria-label") || "");
    v.addEventListener("loadeddata", () => {
      slot.classList.add("is-loaded");
      const link = document.createElement("a");
      link.className = "clip-open";
      link.href = slot.dataset.video;
      link.textContent = "Play this clip";
      link.hidden = true;
      frame.after(link);
      if (slot._isInView) {
        v.play().catch(() => { v.controls = true; link.hidden = false; });
      }
    }, { once: true });
    v.addEventListener("error", () => v.remove(), { once: true });
    v.addEventListener("timeupdate", () => {
      const figure = slot.closest("figure");
      if (!figure) return;
      const chips = figure.querySelectorAll(".step-chip");
      if (!chips.length) return;
      const cur = (slot._offset || 0) + v.currentTime;
      let activeChip = null;
      chips.forEach((chip) => {
        const seek = parseFloat(chip.dataset.seek);
        if (!Number.isNaN(seek) && cur >= seek) activeChip = chip;
      });
      chips.forEach((c) => {
        const isCurrent = c === activeChip;
        c.classList.toggle("is-active", isCurrent);
        c.setAttribute("aria-pressed", isCurrent ? "true" : "false");
      });
    });
    // When playing a pre-cut "from-Ns" clip (see step chips below), return to the
    // full looping clip once it ends.
    v.addEventListener("ended", () => {
      if (!slot._offset) return;
      slot._offset = 0;
      v.loop = true;
      v.src = slot.dataset.video;
      v.play().catch(() => {});
    });
    v.src = slot.dataset.video;
    frame.append(v);
    slot._video = v;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const slot = e.target;
      if (e.isIntersecting) {
        slot._isInView = true;
        load(slot);
        const v = slot._video;
        if (v && slot.classList.contains("is-loaded")) v.play().catch(() => {});
      } else {
        slot._isInView = false;
        if (slot._video) slot._video.pause();
      }
    });
  }, { rootMargin: "200px 0px" });
  slots.forEach((s) => io.observe(s));

  // Step chips seek the clip in the same figure.
  document.querySelectorAll(".step-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const figure = chip.closest("figure");
      const slot = figure ? figure.querySelector(".slot") : chip.closest(".slot");
      if (!slot) return;
      if (!slot._video) load(slot);
      const t = parseFloat(chip.dataset.seek);
      if (Number.isNaN(t)) return;
      const v = slot._video;
      if (!v) return;
      slot._pendingSeek = t;
      // anonymous.4open.science ignores HTTP Range requests and sandboxes the page
      // (no fetch to self), so the browser cannot seek. Slots with data-seek-clips
      // ship pre-cut clips named <video>-from-<t>s.mp4 that start at each chip time.
      const canSeek = () => v.seekable.length > 0 && v.seekable.end(v.seekable.length - 1) > 0;
      const playFrom = (src, offset, then) => {
        slot._offset = offset;
        v.loop = offset === 0;
        if (v.getAttribute("src") !== src) {
          v.addEventListener("loadedmetadata", () => { if (then) then(); v.play().catch(() => {}); }, { once: true });
          v.src = src;
        } else {
          if (then) then();
          v.play().catch(() => {});
        }
      };
      const doSeek = () => {
        const target = slot._pendingSeek;
        const base = slot.dataset.video;
        if (canSeek() && !slot._offset) {
          try { v.currentTime = target; } catch (e) {}
          v.play().catch(() => {});
        } else if (slot.dataset.seekClips !== undefined) {
          const src = target > 0 ? base.replace(/\.mp4$/, "-from-" + target + "s.mp4") : base;
          playFrom(src, target, () => { try { v.currentTime = 0; } catch (e) {} });
        } else {
          playFrom(base, 0, () => { try { v.currentTime = target; } catch (e) {} });
        }
      };
      if (v.readyState >= 1) {
        doSeek();
      } else if (!slot._seekingAttached) {
        slot._seekingAttached = true;
        v.addEventListener("loadedmetadata", () => {
          slot._seekingAttached = false;
          doSeek();
        }, { once: true });
      }
      if (figure) {
        figure.querySelectorAll(".step-chip").forEach((c) => {
          const isTarget = c === chip;
          c.classList.toggle("is-active", isTarget);
          c.setAttribute("aria-pressed", isTarget ? "true" : "false");
        });
      }
    });
  });

  // Carousel.
  document.querySelectorAll(".carousel").forEach((c) => {
    const track = c.querySelector(".carousel-track");
    const items = [...track.children];
    const count = c.querySelector(".carousel-count");
    let i = 0;
    const go = (n) => {
      i = (n + items.length) % items.length;
      track.scrollTo({ left: items[i].offsetLeft - track.offsetLeft, behavior: "smooth" });
      update();
    };
    const update = () => { if (count) count.textContent = String(i + 1).padStart(2, "0") + " / " + String(items.length).padStart(2, "0"); };
    c.querySelector("[data-prev]").addEventListener("click", () => go(i - 1));
    c.querySelector("[data-next]").addEventListener("click", () => go(i + 1));
    track.addEventListener("scroll", () => {
      const n = Math.round(track.scrollLeft / track.clientWidth);
      if (n !== i) { i = n; update(); }
    }, { passive: true });
    update();
  });

  // Highlight the nav link for the section in view.
  const links = [...document.querySelectorAll(".nav-links a")];
  const targets = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  const topEl = document.querySelector("#top");
  if (topEl) targets.unshift(topEl);
  const navIo = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      if (e.target.id === "top") {
        links.forEach((a) => a.classList.remove("active"));
      } else {
        links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
      }
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  targets.forEach((t) => navIo.observe(t));

  // Color theme toggle (default light).
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    const updateThemeLabel = (theme) => {
      const isDark = theme === "dark";
      themeToggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
      themeToggle.title = isDark ? "Switch to light theme" : "Switch to dark theme";
    };
    const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
    updateThemeLabel(currentTheme);

    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch (e) {}
      updateThemeLabel(next);
    });
  }
})();
