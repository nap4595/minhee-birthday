(function () {
  "use strict";

  const data = window.SITE_DATA || { media: [], frames: [], cakes: [] };
  const photoStage = document.getElementById("photo-stage");
  const music = document.getElementById("background-music");
  const musicToggle = document.getElementById("music-toggle");
  const musicToggleLabel = document.getElementById("music-toggle-label");
  const fullscreenToggle = document.getElementById("fullscreen-toggle");
  const fullscreenToggleLabel = document.getElementById("fullscreen-toggle-label");
  const relationshipDays = document.getElementById("relationship-days");
  const anniversaryGate = document.getElementById("anniversary-gate");
  const anniversaryForm = document.getElementById("anniversary-form");
  const dayAnswer = document.getElementById("day-answer");
  const gateSubmit = document.getElementById("gate-submit");
  const gateMessage = document.getElementById("gate-message");
  const gateLoadingMessage = document.getElementById("gate-loading-message");
  const gateProgressBar = document.getElementById("gate-progress-bar");
  const mainPage = document.getElementById("main-page");
  const homeView = document.getElementById("home-view");
  const presentationToggle = document.getElementById("presentation-toggle");
  const openFeaturesButton = document.getElementById("open-features");
  const featureMenu = document.getElementById("feature-menu");
  const dismissFeatureMenuButton = document.getElementById("dismiss-feature-menu");
  const closeFeatureMenuButton = document.getElementById("close-feature-menu");
  const featureChoices = Array.from(document.querySelectorAll("[data-open-feature]"));
  const featureWorkspace = document.getElementById("feature-workspace");
  const backToMainButton = document.getElementById("back-to-main");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);
  const videoExtensions = new Set(["mp4", "webm", "mov", "m4v"]);
  const cachedImages = new Map();
  const resolvedMediaUrls = new Map();
  const objectUrls = [];
  const MEMORY_DATABASE = "minhee-birthday-memories";
  const MEMORY_STORE = "photos";
  let savedMemories = [];
  let backgroundItems = [];
  let backgroundCards = [];
  let backgroundCursor = 0;
  const persistentMemoryCards = new Map();
  let musicWasManuallyPaused = false;
  let assetsReady = false;
  let rotationTimer = null;
  let menuCloseTimer = null;
  const firstDay = Date.UTC(2024, 7, 29);
  const now = new Date();
  const currentDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const relationshipDayCount = Math.floor((currentDay - firstDay) / 86400000) + 1;

  function fullscreenElement() {
    return document.fullscreenElement;
  }

  function updateFullscreenButton() {
    if (!fullscreenToggle) return;
    const isFullscreen = Boolean(fullscreenElement());
    fullscreenToggle.setAttribute("aria-pressed", String(isFullscreen));
    fullscreenToggle.setAttribute("aria-label", isFullscreen ? "전체 화면 나가기" : "전체 화면으로 보기");
    fullscreenToggle.classList.toggle("is-fullscreen", isFullscreen);
    if (fullscreenToggleLabel) fullscreenToggleLabel.textContent = isFullscreen ? "나가기" : "전체 화면";
  }

  async function toggleFullscreen() {
    try {
      if (fullscreenElement()) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.warn("전체 화면을 전환하지 못했습니다.", error);
    } finally {
      updateFullscreenButton();
    }
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededValue(seed, offset) {
    const value = Math.sin(seed * 0.0001 + offset * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  }

  function extensionOf(filename) {
    return filename.split(".").pop().toLowerCase();
  }

  function assetUrl(folder, filename) {
    return `${folder}/${filename.split("/").map(encodeURIComponent).join("/")}`;
  }

  function mediaUrl(filename) {
    return assetUrl("img-preview", filename);
  }

  function openMemoryDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("이 브라우저에서는 사진 보관함을 사용할 수 없습니다."));
        return;
      }
      const request = window.indexedDB.open(MEMORY_DATABASE, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(MEMORY_STORE)) {
          const store = database.createObjectStore(MEMORY_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("사진 보관함을 열지 못했습니다."));
    });
  }

  const memoryDatabase = openMemoryDatabase();

  async function readSavedMemories() {
    const database = await memoryDatabase;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MEMORY_STORE, "readonly");
      const request = transaction.objectStore(MEMORY_STORE).getAll();
      request.onsuccess = () => {
        resolve((request.result || []).sort((first, second) => second.createdAt - first.createdAt));
      };
      request.onerror = () => reject(request.error || new Error("저장된 사진을 읽지 못했습니다."));
    });
  }

  async function persistMemory(record) {
    const database = await memoryDatabase;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MEMORY_STORE, "readwrite");
      transaction.objectStore(MEMORY_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("사진을 보관하지 못했습니다."));
      transaction.onabort = () => reject(transaction.error || new Error("사진 보관이 중단되었습니다."));
    });
  }

  async function removePersistedMemory(id) {
    const database = await memoryDatabase;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MEMORY_STORE, "readwrite");
      transaction.objectStore(MEMORY_STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("사진을 삭제하지 못했습니다."));
      transaction.onabort = () => reject(transaction.error || new Error("사진 삭제가 중단되었습니다."));
    });
  }

  function memoryView(record) {
    let url = resolvedMediaUrls.get(record.id);
    if (!url) {
      url = URL.createObjectURL(record.blob);
      objectUrls.push(url);
      resolvedMediaUrls.set(record.id, url);
    }
    return {
      id: record.id,
      src: url,
      mode: record.mode,
      createdAt: record.createdAt
    };
  }

  const memoriesReady = readSavedMemories()
    .then((records) => {
      savedMemories = records;
      return records.map(memoryView);
    })
    .catch((error) => {
      console.warn("저장된 사진을 불러오지 못했습니다.", error);
      return [];
    });

  function validMedia(files) {
    return files.filter((file) => {
      const extension = extensionOf(file);
      return imageExtensions.has(extension) || videoExtensions.has(extension);
    });
  }

  function addFallbackMemories() {
    const positions = [
      ["3%", "8%", "15vw", "-8deg"],
      ["77%", "3%", "18vw", "7deg"],
      ["1%", "66%", "17vw", "5deg"],
      ["80%", "73%", "14vw", "-6deg"]
    ];
    positions.forEach(([x, y, size, rotation], index) => {
      const card = document.createElement("div");
      card.className = "memory-placeholder";
      card.style.setProperty("--x", x);
      card.style.setProperty("--y", y);
      card.style.setProperty("--size", size);
      card.style.setProperty("--rotation", rotation);
      card.style.setProperty("--scale", String(0.9 + index * 0.03));
      card.style.setProperty("--duration", `${17 + index * 3}s`);
      card.style.setProperty("--delay", `${index * -2.4}s`);
      photoStage.append(card);
    });
  }

  function createMediaVisual(filename) {
    const isVideo = videoExtensions.has(extensionOf(filename));
    const media = document.createElement(isVideo ? "video" : "img");
    media.className = "media-visual";
    media.src = resolvedMediaUrls.get(filename) || mediaUrl(filename);
    media.setAttribute("aria-hidden", "true");
    if (isVideo) {
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.preload = "auto";
      if (!reduceMotion) media.play().catch(() => {});
    } else {
      media.alt = "";
      media.loading = "eager";
      media.decoding = "sync";
    }
    return media;
  }

  function replaceCardMedia(card, filename) {
    const next = createMediaVisual(filename);
    next.classList.add("is-active");
    card.replaceChildren(next);
  }

  function startBackgroundPlayback(files) {
    backgroundItems = validMedia(files);
    if (!backgroundItems.length) {
      addFallbackMemories();
      return;
    }

    const isMobile = window.innerWidth <= 720;
    const isPortrait = window.innerHeight > window.innerWidth;
    const targetCount = isMobile ? 24 : 28;
    const slotCount = Math.min(targetCount, backgroundItems.length);

    // Determine grid columns and rows to distribute photos across the screen
    let cols, rows;
    if (isMobile) {
      cols = isPortrait ? 3 : 6;
      rows = Math.ceil(slotCount / cols);
    } else {
      cols = isPortrait ? 4 : 7;
      rows = Math.ceil(slotCount / cols);
    }

    const cellWidth = 100 / cols;
    const cellHeight = 100 / rows;

    // Create and shuffle cell indices so the distribution is randomized yet uniformly spread
    const cellIndices = Array.from({ length: cols * rows }, (_, i) => i);
    for (let i = cellIndices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(seededValue(42 + i * 17, 1) * (i + 1));
      const temp = cellIndices[i];
      cellIndices[i] = cellIndices[j];
      cellIndices[j] = temp;
    }

    const cards = [];
    for (let index = 0; index < slotCount; index += 1) {
      const filename = backgroundItems[index];
      const seed = hashText(`${filename}-${index}`);
      const card = document.createElement("div");
      card.className = "media-card";

      const cellIndex = cellIndices[index % cellIndices.length];
      const col = cellIndex % cols;
      const row = Math.floor(cellIndex / cols);

      // Center of this cell
      const cellCenterX = (col + 0.5) * cellWidth;
      const cellCenterY = (row + 0.5) * cellHeight;

      // Card size (increased by ~25%)
      const size = isMobile
        ? 7.0 + seededValue(seed, 3) * 2.2 // 7.0rem ~ 9.2rem
        : 10.6 + seededValue(seed, 3) * 4.4; // 10.6rem ~ 15.0rem

      const scale = 0.90 + seededValue(seed, 5) * 0.18;

      // Approximate card dimensions in percentage for centering
      const approxCardWidthPct = isMobile ? 30 * scale : 13.8 * scale;
      const approxCardHeightPct = isMobile ? 12 * scale : 11.2 * scale;

      // Bounded jitter so adjacent photos scatter naturally without heavily overlapping
      const jitterX = (seededValue(seed, 1) - 0.5) * (cellWidth * 0.38);
      const jitterY = (seededValue(seed, 2) - 0.5) * (cellHeight * 0.38);

      const rawX = cellCenterX - (approxCardWidthPct / 2) + jitterX;
      const rawY = cellCenterY - (approxCardHeightPct / 2) + jitterY;

      const x = Math.max(-2, Math.min(96 - approxCardWidthPct, rawX));
      const y = Math.max(-2, Math.min(97 - approxCardHeightPct, rawY));

      const rotation = -11 + seededValue(seed, 4) * 22;
      const opacity = 0.45 + seededValue(seed, 6) * 0.22;
      const duration = 15 + seededValue(seed, 7) * 14;

      card.style.setProperty("--x", `${x.toFixed(2)}%`);
      card.style.setProperty("--y", `${y.toFixed(2)}%`);
      card.style.setProperty("--size", `${size.toFixed(2)}rem`);
      card.style.setProperty("--rotation", `${rotation.toFixed(1)}deg`);
      card.style.setProperty("--scale", scale.toFixed(3));
      card.style.setProperty("--opacity", opacity.toFixed(3));
      card.style.setProperty("--duration", `${duration.toFixed(1)}s`);
      card.style.setProperty("--delay", `${(-seededValue(seed, 8) * duration).toFixed(1)}s`);
      card.style.setProperty("--ratio", seededValue(seed, 9) > 0.65 ? "3 / 4" : "4 / 3");
      const visual = createMediaVisual(filename);
      visual.classList.add("is-active");
      card.append(visual);
      photoStage.append(card);
      cards.push(card);
    }
    backgroundCards = cards;
    backgroundCursor = slotCount;

    if (backgroundItems.length <= slotCount) return;
    const fadeDuration = reduceMotion ? 0 : 1800;
    const visibleDuration = 3000;

    function changeBackgroundSet() {
      photoStage.classList.add("is-changing");
      rotationTimer = window.setTimeout(() => {
        cards.forEach((card, index) => {
          replaceCardMedia(card, backgroundItems[(backgroundCursor + index) % backgroundItems.length]);
        });
        backgroundCursor = (backgroundCursor + slotCount) % backgroundItems.length;
        void photoStage.offsetWidth;
        photoStage.classList.remove("is-changing");
        rotationTimer = window.setTimeout(changeBackgroundSet, visibleDuration + fadeDuration);
      }, fadeDuration);
    }

    rotationTimer = window.setTimeout(changeBackgroundSet, visibleDuration);
  }

  function addPersistentMemoryCard(filename, index = persistentMemoryCards.size, mode = "us") {
    if (persistentMemoryCards.has(filename)) return;
    const seed = hashText(`${filename}-saved-memory`);
    const isMobile = window.innerWidth <= 720;
    const isCake = mode === "cake";
    const card = document.createElement("div");
    card.className = "media-card saved-memory-card";
    card.classList.toggle("is-cake-memory", isCake);
    card.dataset.memoryId = filename;
    card.style.setProperty("--x", `${(4 + seededValue(seed, 1) * (isMobile ? (isCake ? 74 : 68) : 78)).toFixed(2)}%`);
    card.style.setProperty("--y", `${(3 + seededValue(seed, 2) * (isCake ? 48 : 74)).toFixed(2)}%`);
    card.style.setProperty("--size", `${(isCake
      ? (isMobile ? 5.6 + seededValue(seed, 3) * 1.3 : 7.5 + seededValue(seed, 3) * 2)
      : (isMobile ? 7.2 + seededValue(seed, 3) * 2 : 11 + seededValue(seed, 3) * 3.5)
    ).toFixed(2)}rem`);
    card.style.setProperty("--rotation", `${(-8 + seededValue(seed, 4) * 16).toFixed(1)}deg`);
    card.style.setProperty("--scale", (0.94 + seededValue(seed, 5) * 0.12).toFixed(3));
    card.style.setProperty("--opacity", (0.7 + seededValue(seed, 6) * 0.14).toFixed(3));
    card.style.setProperty("--duration", `${(18 + seededValue(seed, 7) * 12).toFixed(1)}s`);
    card.style.setProperty("--delay", `${(-seededValue(seed, 8) * 12).toFixed(1)}s`);
    card.style.setProperty("--ratio", isCake
      ? "1200 / 3912"
      : (seededValue(seed, 9) > 0.45 ? "3 / 4" : "4 / 3"));
    card.style.zIndex = String(10 + index);
    const visual = createMediaVisual(filename);
    visual.classList.add("is-active");
    card.append(visual);
    photoStage.append(card);
    persistentMemoryCards.set(filename, card);
  }

  function preloadImage(url) {
    if (cachedImages.has(url)) return Promise.resolve(cachedImages.get(url));
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "low";
      image.onload = async () => {
        try {
          if (image.decode) await image.decode();
        } catch (_) {
          // load 이벤트가 발생했다면 브라우저 캐시에는 안전하게 들어온 상태다.
        }
        cachedImages.set(url, image);
        resolve(image);
      };
      image.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${url}`));
      image.src = url;
    });
  }

  async function preloadMedia(filename) {
    const extension = extensionOf(filename);
    const preferredUrl = mediaUrl(filename);
    if (imageExtensions.has(extension)) {
      await preloadImage(preferredUrl);
      resolvedMediaUrls.set(filename, preferredUrl);
      return;
    }

    const response = await fetch(preferredUrl);
    if (!response.ok) throw new Error(`영상을 불러오지 못했습니다: ${preferredUrl}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    objectUrls.push(objectUrl);
    resolvedMediaUrls.set(filename, objectUrl);
  }

  async function preloadMusic() {
    if (!music) return;
    const source = music.getAttribute("src");
    if (!source) return;
    const response = await fetch(source);
    if (!response.ok) throw new Error("배경 음악을 불러오지 못했습니다.");
    const objectUrl = URL.createObjectURL(await response.blob());
    objectUrls.push(objectUrl);
    await new Promise((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("배경 음악을 준비하지 못했습니다."));
      };
      const cleanup = () => {
        music.removeEventListener("loadeddata", onReady);
        music.removeEventListener("error", onError);
      };
      music.addEventListener("loadeddata", onReady, { once: true });
      music.addEventListener("error", onError, { once: true });
      music.src = objectUrl;
      music.load();
      if (music.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onReady();
    });
  }

  async function preloadFonts() {
    if (!document.fonts) return;
    try {
      await document.fonts.load('54px "Nanum Pen Script"', "happy birthday");
      await document.fonts.ready;
    } catch (_) {
      // 인터넷 연결이 없으면 시스템 글꼴로 같은 레이아웃을 유지한다.
    }
  }

  function setLoadingProgress(completed, total) {
    const percentage = total ? Math.round(completed / total * 100) : 100;
    if (gateProgressBar) gateProgressBar.style.width = `${percentage}%`;
    if (gateLoadingMessage) {
      gateLoadingMessage.textContent = completed < total
        ? `우리의 추억을 불러오는 중… ${completed}/${total}`
        : `모든 추억 준비 완료 · ${total}개`;
    }
  }

  async function preloadAllAssets() {
    const packagedMediaFiles = validMedia(Array.isArray(data.media) ? data.media : []);
    const savedMemoryViews = await memoriesReady;
    const frameFiles = Array.isArray(data.frames) ? data.frames : [];
    const cakeFiles = Array.isArray(data.cakes) ? data.cakes : [];
    const tasks = [
      () => preloadMusic(),
      () => preloadFonts(),
      ...packagedMediaFiles.map((filename) => () => preloadMedia(filename)),
      ...frameFiles.map((filename) => () => preloadImage(assetUrl("frame", filename))),
      ...cakeFiles.map((filename) => () => preloadImage(assetUrl("과거생일케이크", filename)))
    ];
    let completed = 0;
    let failures = 0;
    setLoadingProgress(0, tasks.length);

    for (let index = 0; index < tasks.length; index += 8) {
      const batch = tasks.slice(index, index + 8).map(async (task) => {
        try {
          await task();
        } catch (error) {
          failures += 1;
          console.warn(error);
        } finally {
          completed += 1;
          setLoadingProgress(completed, tasks.length);
        }
      });
      await Promise.all(batch);
    }

    startBackgroundPlayback(packagedMediaFiles);
    savedMemoryViews.slice().reverse().forEach((memory, index) => {
      addPersistentMemoryCard(memory.id, index, memory.mode);
    });
    assetsReady = true;
    document.body.classList.remove("assets-loading");
    document.body.classList.add("assets-ready");
    if (gateSubmit) {
      gateSubmit.disabled = false;
      gateSubmit.textContent = "확인";
    }
    if (failures && gateLoadingMessage) {
      gateLoadingMessage.textContent = `준비 완료 · 불러오지 못한 파일 ${failures}개`;
    }
    document.dispatchEvent(new CustomEvent("site-assets-ready"));
  }

  function updateMusicButton() {
    if (!music || !musicToggle || !musicToggleLabel) return;
    const isPlaying = !music.paused;
    musicToggle.setAttribute("aria-pressed", String(isPlaying));
    musicToggle.classList.toggle("is-playing", isPlaying);
    musicToggleLabel.textContent = isPlaying ? "음악 끄기" : "음악 켜기";
  }

  async function playMusic() {
    if (!music || !assetsReady) return false;
    try {
      await music.play();
      return true;
    } catch (_) {
      updateMusicButton();
      return false;
    }
  }

  async function toggleMusic() {
    if (!music) return;
    if (music.paused) {
      musicWasManuallyPaused = false;
      await playMusic();
    } else {
      musicWasManuallyPaused = true;
      music.pause();
    }
    updateMusicButton();
  }

  function updateRelationshipDays() {
    if (!relationshipDays) return;
    relationshipDays.textContent = `D+${relationshipDayCount}`;
  }

  function togglePresentationControls() {
    const controlsAreHidden = document.body.classList.toggle("presentation-controls-hidden");
    presentationToggle?.setAttribute("aria-pressed", String(controlsAreHidden));
    presentationToggle?.setAttribute(
      "aria-label",
      controlsAreHidden ? "화면의 버튼 다시 보이기" : "화면의 버튼 숨기기"
    );
  }

  function openFeatureMenu() {
    if (!featureMenu || document.body.classList.contains("feature-menu-open")) return;
    if (menuCloseTimer) window.clearTimeout(menuCloseTimer);
    featureMenu.hidden = false;
    openFeaturesButton?.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      document.body.classList.add("feature-menu-open");
      featureChoices[0]?.focus({ preventScroll: true });
    });
  }

  function closeFeatureMenu({ restoreFocus = true, immediate = false } = {}) {
    if (!featureMenu || featureMenu.hidden) return;
    document.body.classList.remove("feature-menu-open");
    openFeaturesButton?.setAttribute("aria-expanded", "false");
    if (menuCloseTimer) window.clearTimeout(menuCloseTimer);
    if (immediate || reduceMotion) {
      featureMenu.hidden = true;
    } else {
      menuCloseTimer = window.setTimeout(() => {
        featureMenu.hidden = true;
      }, 420);
    }
    if (restoreFocus) openFeaturesButton?.focus({ preventScroll: true });
  }

  function openFeature(mode) {
    closeFeatureMenu({ restoreFocus: false, immediate: true });
    homeView.hidden = true;
    featureWorkspace.hidden = false;
    backToMainButton.hidden = false;
    document.body.classList.remove("main-active");
    document.body.classList.add("feature-active");
    document.dispatchEvent(new CustomEvent("feature-opened", { detail: { mode } }));
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    window.setTimeout(() => {
      document.querySelector(`[data-camera-mode="${mode}"]`)?.focus({ preventScroll: true });
    }, reduceMotion ? 0 : 180);
  }

  function returnToMain() {
    document.dispatchEvent(new CustomEvent("feature-closed"));
    featureWorkspace.hidden = true;
    backToMainButton.hidden = true;
    homeView.hidden = false;
    document.body.classList.remove("feature-active", "gallery-active");
    document.body.classList.add("main-active");
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    openFeaturesButton?.focus({ preventScroll: true });
  }

  function unlockCamera(event) {
    event.preventDefault();
    if (!assetsReady) {
      gateMessage.textContent = "추억을 모두 불러온 뒤 시작할 수 있어.";
      return;
    }
    if (!dayAnswer || Number(dayAnswer.value) !== relationshipDayCount) {
      gateMessage.textContent = "조금만 더 생각해 봐 :)";
      anniversaryForm.classList.remove("is-wrong");
      void anniversaryForm.offsetWidth;
      anniversaryForm.classList.add("is-wrong");
      dayAnswer?.select();
      return;
    }

    gateMessage.textContent = "";
    anniversaryForm.classList.remove("is-wrong");
    musicToggle.disabled = false;
    musicWasManuallyPaused = false;
    playMusic();
    document.body.classList.remove("gate-locked");
    document.body.classList.add("gate-opening", "main-active");
    mainPage?.removeAttribute("inert");

    window.setTimeout(() => {
      anniversaryGate.hidden = true;
      anniversaryGate.setAttribute("aria-hidden", "true");
      document.body.classList.remove("gate-opening");
      openFeaturesButton?.focus({ preventScroll: true });
    }, reduceMotion ? 50 : 760);
  }

  async function saveMemory(blob, mode) {
    await memoriesReady;
    const uniquePart = window.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const record = {
      id: `saved-${uniquePart}.png`,
      blob,
      mode: mode === "cake" ? "cake" : "us",
      createdAt: Date.now()
    };
    let persisted = true;
    try {
      await persistMemory(record);
    } catch (error) {
      persisted = false;
      console.warn("사진을 이 브라우저에 계속 보관하지 못했습니다.", error);
    }
    record.persisted = persisted;
    savedMemories.unshift(record);
    const view = memoryView(record);
    addPersistentMemoryCard(record.id, persistentMemoryCards.size, record.mode);
    document.dispatchEvent(new CustomEvent("memory-saved", { detail: view }));
    return { ...view, persisted };
  }

  async function deleteMemory(id) {
    await memoriesReady;
    const recordIndex = savedMemories.findIndex((memory) => memory.id === id);
    if (recordIndex < 0) return false;
    const record = savedMemories[recordIndex];
    if (record.persisted !== false) await removePersistedMemory(id);
    savedMemories.splice(recordIndex, 1);
    persistentMemoryCards.get(id)?.remove();
    persistentMemoryCards.delete(id);
    document.dispatchEvent(new CustomEvent("memory-deleted", { detail: { id } }));
    const url = resolvedMediaUrls.get(id);
    if (url) {
      queueMicrotask(() => {
        URL.revokeObjectURL(url);
        resolvedMediaUrls.delete(id);
        const urlIndex = objectUrls.indexOf(url);
        if (urlIndex >= 0) objectUrls.splice(urlIndex, 1);
      });
    }
    return true;
  }

  const readyPromise = preloadAllAssets();
  window.SITE_ASSETS = {
    ready: readyPromise,
    getImage: (url) => cachedImages.get(url) || null,
    assetUrl,
    mediaUrl: (filename) => resolvedMediaUrls.get(filename) || mediaUrl(filename)
  };
  window.SITE_MEMORIES = {
    ready: memoriesReady,
    list: () => savedMemories.map(memoryView),
    save: saveMemory,
    delete: deleteMemory
  };

  updateRelationshipDays();
  anniversaryForm?.addEventListener("submit", unlockCamera);
  dayAnswer?.addEventListener("input", () => {
    dayAnswer.value = dayAnswer.value.replace(/\D/g, "").slice(0, 5);
    gateMessage.textContent = "";
  });
  window.setTimeout(() => dayAnswer?.focus({ preventScroll: true }), 300);

  if (music) {
    music.volume = 0.55;
    music.addEventListener("play", updateMusicButton);
    music.addEventListener("pause", updateMusicButton);
    music.addEventListener("error", updateMusicButton);
  }
  musicToggle?.addEventListener("click", toggleMusic);
  if (fullscreenToggle) {
    const fullscreenSupported = Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
    fullscreenToggle.hidden = !fullscreenSupported;
    if (!fullscreenToggle.hidden) {
      fullscreenToggle.addEventListener("click", toggleFullscreen);
    }
    if (fullscreenSupported) {
      document.addEventListener("fullscreenchange", updateFullscreenButton);
      updateFullscreenButton();
    }
  }
  updateMusicButton();
  presentationToggle?.addEventListener("click", togglePresentationControls);
  openFeaturesButton?.addEventListener("click", openFeatureMenu);
  dismissFeatureMenuButton?.addEventListener("click", () => closeFeatureMenu());
  closeFeatureMenuButton?.addEventListener("click", () => closeFeatureMenu());
  featureChoices.forEach((choice) => {
    choice.addEventListener("click", () => openFeature(choice.dataset.openFeature));
  });
  backToMainButton?.addEventListener("click", returnToMain);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (fullscreenElement()) return;
    if (document.body.classList.contains("feature-menu-open")) {
      closeFeatureMenu();
    } else if (document.body.classList.contains("feature-active")) {
      returnToMain();
    }
  });

  document.addEventListener("visibilitychange", () => {
    document.querySelectorAll(".photo-stage video").forEach((video) => {
      if (document.hidden) video.pause();
      else if (!reduceMotion) video.play().catch(() => {});
    });
  });

  window.addEventListener("beforeunload", () => {
    if (rotationTimer) window.clearTimeout(rotationTimer);
    if (menuCloseTimer) window.clearTimeout(menuCloseTimer);
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  });
})();
