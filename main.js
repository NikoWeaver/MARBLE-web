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
    v.preload = "metadata";
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
      v.play().catch(() => { v.controls = true; link.hidden = false; });
    }, { once: true });
    v.addEventListener("error", () => v.remove(), { once: true });
    v.src = slot.dataset.video;
    frame.append(v);
    slot._video = v;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const slot = e.target;
      if (e.isIntersecting) {
        load(slot);
        const v = slot._video;
        if (v && slot.classList.contains("is-loaded")) v.play().catch(() => {});
      } else if (slot._video) {
        slot._video.pause();
      }
    });
  }, { rootMargin: "200px 0px" });
  slots.forEach((s) => io.observe(s));

  // Step chips seek the clip in the same figure.
  document.querySelectorAll(".step-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const slot = chip.closest("figure").querySelector(".slot") || chip.closest(".slot");
      const t = parseFloat(chip.dataset.seek);
      if (!slot || !slot._video || Number.isNaN(t)) return;
      slot._video.currentTime = t;
      slot._video.play().catch(() => {});
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
  const navIo = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
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
