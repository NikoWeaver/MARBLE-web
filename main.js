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
      const cur = v.currentTime;
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
    // Some hosts (e.g. anonymous.4open.science) ignore HTTP Range requests, so the
    // browser reports nothing seekable and step chips snap back to 0. When that
    // happens, fetch the whole clip once and play it from a Blob URL, which is
    // always seekable, then re-apply any seek the viewer asked for.
    v.addEventListener("loadedmetadata", () => {
      const canSeek = v.seekable.length > 0 && v.seekable.end(v.seekable.length - 1) > 0;
      if (canSeek || slot._blobTried || !window.fetch || !window.URL) return;
      slot._blobTried = true;
      fetch(slot.dataset.video)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then((blob) => {
          const wasPlaying = !v.paused;
          const resumeAt = slot._pendingSeek != null ? slot._pendingSeek : v.currentTime;
          v.src = URL.createObjectURL(blob);
          v.addEventListener("loadedmetadata", () => {
            try { v.currentTime = resumeAt; } catch (e) {}
            if (wasPlaying || slot._pendingSeek != null) v.play().catch(() => {});
          }, { once: true });
        })
        .catch(() => {});
    }, { once: true });
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
      const doSeek = () => {
        try { v.currentTime = slot._pendingSeek; } catch (e) {}
        v.play().catch(() => {});
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
