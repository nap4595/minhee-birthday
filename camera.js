(function () {
  "use strict";

  const livePanel = document.getElementById("camera-live-panel");
  const processingPanel = document.getElementById("camera-processing-panel");
  const processingMessage = document.getElementById("camera-processing-message");
  const resultPanel = document.getElementById("camera-result-panel");
  const cameraFrame = document.querySelector(".camera-frame");
  const photoArea = document.getElementById("camera-photo-area");
  const frameOverlay = document.getElementById("camera-overlay");
  const frameOptions = document.getElementById("frame-options");
  const frameControls = document.getElementById("frame-controls");
  const video = document.getElementById("camera-video");
  const cakeUploadControl = document.getElementById("cake-upload-control");
  const cakePhotoUpload = document.getElementById("cake-photo-upload");
  const cakeUploadPreview = document.getElementById("cake-upload-preview");
  const status = document.getElementById("camera-status");
  const switchButton = document.getElementById("switch-camera");
  const takeButton = document.getElementById("take-photo");
  const retakeButton = document.getElementById("retake-photo");
  const downloadLink = document.getElementById("download-photo");
  const savedPhotoStatus = document.getElementById("saved-photo-status");
  let downloadSequence = 0;
  const capturedImage = document.getElementById("captured-image");
  const captionInput = document.getElementById("photo-caption");
  const cameraWriting = document.querySelector(".camera-writing");
  const resultFrame = document.getElementById("photo-result-frame");
  const cameraTitle = document.getElementById("camera-title");
  const modeTabs = Array.from(document.querySelectorAll("[data-camera-mode]"));
  const galleryPanel = document.getElementById("gallery-panel");
  const galleryGrid = document.getElementById("gallery-grid");
  const galleryCount = document.getElementById("gallery-count");
  const galleryStorageNote = document.getElementById("gallery-storage-note");
  const galleryMore = document.getElementById("gallery-more");
  const memoryDeleteDialog = document.getElementById("memory-delete-dialog");
  const memoryDeleteBackdrop = document.getElementById("memory-delete-backdrop");
  const memoryDeleteCancel = document.getElementById("memory-delete-cancel");
  const memoryDeleteConfirm = document.getElementById("memory-delete-confirm");
  const memoryDeleteStatus = document.getElementById("memory-delete-status");
  const canvas = document.getElementById("photo-canvas");
  const context = canvas.getContext("2d");
  const siteData = window.SITE_DATA || {};
  const availableFrames = Array.isArray(siteData.frames) ? siteData.frames : [];
  const cakeFiles = (Array.isArray(siteData.cakes) ? siteData.cakes : [])
    .slice()
    .sort((first, second) => first.localeCompare(second, "ko", { numeric: true }));
  const galleryExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);
  const packagedGalleryFiles = (Array.isArray(siteData.media) ? siteData.media : [])
    .filter((filename) => galleryExtensions.has(filename.split(".").pop().toLowerCase()));

  const DEFAULT_FRAME_STATE = Object.freeze({ x: 50, y: 32, scale: 72 });
  const GALLERY_BATCH_SIZE = 36;
  const LONG_PRESS_DURATION = 650;
  const CAPTION_FONT = '"Nanum Pen Script", "HY얕은샘물M", "HY엽서M", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  let frameImage = new Image();
  let stream = null;
  let cameraRequestId = 0;
  let captureRequestId = 0;
  let facingMode = "user";
  let captureMode = "cake";
  let cameraUnlocked = false;
  let photoUrl = null;
  let photoBlob = null;
  let savedPhotoId = null;
  let savingPhoto = false;
  let isProcessing = false;
  let uploadedCakeImage = null;
  let uploadedCakeUrl = null;
  let selectedFrame = availableFrames[0] || "";
  let frameState = { ...DEFAULT_FRAME_STATE };
  let dragStart = null;
  let pinchStart = null;
  let galleryShown = 0;
  let pendingDeleteId = null;
  let longPressTimer = null;
  let longPressStart = null;
  let galleryItems = packagedGalleryFiles.map((filename) => ({
    id: `packaged:${filename}`,
    src: window.SITE_ASSETS?.mediaUrl(filename) || assetUrl("img-preview", filename)
  }));
  const activePointers = new Map();
  const savedGalleryReady = window.SITE_MEMORIES
    ? window.SITE_MEMORIES.ready.then(() => {
      galleryItems = [
        ...window.SITE_MEMORIES.list().map((memory) => ({
          id: memory.id,
          src: memory.src,
          saved: true
        })),
        ...galleryItems
      ];
    })
    : Promise.resolve();

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function assetUrl(folder, filename) {
    if (window.SITE_ASSETS && window.SITE_ASSETS.assetUrl) {
      return window.SITE_ASSETS.assetUrl(folder, filename);
    }
    return `${folder}/${filename.split("/").map(encodeURIComponent).join("/")}`;
  }

  function frameUrl(filename) {
    return assetUrl("frame", filename);
  }

  function cakeUrl(filename) {
    return assetUrl("과거생일케이크", filename);
  }

  function frameStorageKey(filename) {
    return `minhee-frame-position:${filename}`;
  }

  function loadFrameState(filename) {
    if (!filename) return { ...DEFAULT_FRAME_STATE };
    try {
      const saved = JSON.parse(localStorage.getItem(frameStorageKey(filename)) || "null");
      if (saved && [saved.x, saved.y, saved.scale].every(Number.isFinite)) {
        return {
          x: clamp(saved.x, 0, 100),
          y: clamp(saved.y, 0, 100),
          scale: clamp(saved.scale, 20, 140)
        };
      }
    } catch (_) {
      // 저장소가 차단되어도 촬영은 계속할 수 있다.
    }
    return { ...DEFAULT_FRAME_STATE };
  }

  function saveFrameState() {
    if (!selectedFrame) return;
    try {
      localStorage.setItem(frameStorageKey(selectedFrame), JSON.stringify(frameState));
    } catch (_) {
      // 프레임 위치 저장은 선택 기능이다.
    }
  }

  function updateFramePosition({ persist = false } = {}) {
    frameOverlay.style.setProperty("--frame-x", `${frameState.x}%`);
    frameOverlay.style.setProperty("--frame-y", `${frameState.y}%`);
    frameOverlay.style.setProperty("--frame-scale", `${frameState.scale}%`);
    if (persist) saveFrameState();
  }

  function updateFrameControls() {
    frameOptions.querySelectorAll(".frame-option").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.frame === selectedFrame));
    });
  }

  function selectFrame(filename) {
    selectedFrame = filename;
    frameState = loadFrameState(filename);
    if (filename) {
      const url = frameUrl(filename);
      frameOverlay.src = url;
      frameOverlay.hidden = captureMode !== "us";
      frameImage = window.SITE_ASSETS?.getImage(url) || new Image();
      if (!frameImage.src) frameImage.src = url;
    } else {
      frameOverlay.removeAttribute("src");
      frameOverlay.hidden = true;
      frameImage = new Image();
    }
    updateFramePosition();
    updateFrameControls();
  }

  function renderFrameOptions() {
    const choices = ["", ...availableFrames];
    if (choices.length === 1) {
      frameOptions.innerHTML = '<span class="frame-empty">frame 폴더에 PNG 또는 WEBP를 넣어 주세요.</span>';
      selectFrame("");
      return;
    }

    choices.forEach((filename) => {
      const button = document.createElement("button");
      button.className = "frame-option";
      button.type = "button";
      button.dataset.frame = filename;
      button.setAttribute("role", "option");
      button.setAttribute("aria-label", filename ? `프레임 ${filename}` : "프레임 없음");
      if (filename) {
        const thumbnail = document.createElement("img");
        thumbnail.src = frameUrl(filename);
        thumbnail.alt = "";
        thumbnail.loading = "eager";
        thumbnail.decoding = "async";
        button.append(thumbnail);
      } else {
        const label = document.createElement("span");
        label.textContent = "없음";
        button.append(label);
      }
      button.addEventListener("click", () => selectFrame(filename));
      frameOptions.append(button);
    });
    selectFrame(selectedFrame);
  }

  function cancelLongPress() {
    if (longPressTimer) window.clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  }

  function openMemoryDeleteDialog(id, trigger) {
    pendingDeleteId = id;
    memoryDeleteDialog.hidden = false;
    memoryDeleteStatus.textContent = "";
    memoryDeleteConfirm.disabled = false;
    memoryDeleteConfirm.textContent = "삭제";
    memoryDeleteDialog.deleteTrigger = trigger;
    document.body.classList.add("memory-delete-open");
    memoryDeleteCancel.focus({ preventScroll: true });
  }

  function closeMemoryDeleteDialog({ restoreFocus = true } = {}) {
    if (memoryDeleteConfirm.disabled) return;
    const trigger = memoryDeleteDialog.deleteTrigger;
    pendingDeleteId = null;
    memoryDeleteDialog.deleteTrigger = null;
    memoryDeleteDialog.hidden = true;
    document.body.classList.remove("memory-delete-open");
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function enableSavedMemoryLongPress(figure, item) {
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.setAttribute("aria-label", "기기에 저장한 사진. 길게 누르면 삭제할 수 있어.");
    figure.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      cancelLongPress();
      longPressStart = { x: event.clientX, y: event.clientY };
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        longPressStart = null;
        navigator.vibrate?.(35);
        openMemoryDeleteDialog(item.id, figure);
      }, LONG_PRESS_DURATION);
    });
    figure.addEventListener("pointermove", (event) => {
      if (!longPressStart) return;
      if (Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 12) {
        cancelLongPress();
      }
    });
    figure.addEventListener("pointerup", cancelLongPress);
    figure.addEventListener("pointercancel", cancelLongPress);
    figure.addEventListener("pointerleave", cancelLongPress);
    figure.addEventListener("contextmenu", (event) => event.preventDefault());
    figure.addEventListener("keydown", (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      event.preventDefault();
      openMemoryDeleteDialog(item.id, figure);
    });
  }

  function updateGalleryMeta() {
    galleryCount.textContent = `${galleryShown} / ${galleryItems.length}`;
    galleryMore.hidden = galleryShown >= galleryItems.length;
    galleryStorageNote.hidden = !galleryItems.some((item) => item.saved);
  }

  function createGalleryFigure(item) {
    const figure = document.createElement("figure");
    if (item.saved) figure.classList.add("is-saved-memory");
    figure.dataset.galleryId = item.id;
    const image = document.createElement("img");
    image.src = item.src;
    image.alt = item.saved ? "이 브라우저에 저장한 사진" : "";
    image.draggable = false;
    image.loading = "lazy";
    image.decoding = "async";
    figure.append(image);
    if (item.saved) enableSavedMemoryLongPress(figure, item);
    return figure;
  }

  async function renderMoreGalleryPhotos() {
    await savedGalleryReady;
    const nextItems = galleryItems.slice(galleryShown, galleryShown + GALLERY_BATCH_SIZE);
    const fragment = document.createDocumentFragment();
    nextItems.forEach((item) => {
      fragment.append(createGalleryFigure(item));
    });
    galleryGrid.append(fragment);
    galleryShown += nextItems.length;
    updateGalleryMeta();
  }

  function clearUploadedCake() {
    if (uploadedCakeUrl) URL.revokeObjectURL(uploadedCakeUrl);
    uploadedCakeUrl = null;
    uploadedCakeImage = null;
    cakeUploadPreview.removeAttribute("src");
    cakeUploadPreview.hidden = true;
    photoArea.classList.remove("has-uploaded-cake");
    cakePhotoUpload.value = "";
    switchButton.textContent = "카메라 전환";
  }

  function showUploadedCake() {
    stopCamera();
    cakeUploadPreview.src = uploadedCakeUrl;
    cakeUploadPreview.hidden = false;
    photoArea.classList.add("has-uploaded-cake");
    switchButton.hidden = false;
    switchButton.disabled = false;
    switchButton.textContent = "카메라 사용";
    takeButton.disabled = false;
    takeButton.textContent = "사진 완성";
    status.hidden = false;
    status.textContent = "올린 케이크 사진으로 완성할 수 있어.";
  }

  function resumeLiveSource() {
    if (captureMode === "cake" && uploadedCakeImage) {
      showUploadedCake();
    } else {
      startCamera();
    }
  }

  function showProcessingScreen(mode) {
    isProcessing = true;
    modeTabs.forEach((tab) => { tab.disabled = true; });
    processingMessage.textContent = mode === "cake"
      ? "과거의 케이크와 오늘의 케이크를 이어 붙이고 있어 :)"
      : "프레임과 문구를 예쁘게 담고 있어 :)";
    livePanel.hidden = true;
    resultPanel.hidden = true;
    galleryPanel.hidden = true;
    processingPanel.hidden = false;
  }

  function hideProcessingScreen() {
    isProcessing = false;
    processingPanel.hidden = true;
    modeTabs.forEach((tab) => { tab.disabled = false; });
  }

  function clearResult() {
    if (photoUrl) {
      URL.revokeObjectURL(photoUrl);
      photoUrl = null;
    }
    photoBlob = null;
    savedPhotoId = null;
    savingPhoto = false;
    capturedImage.removeAttribute("src");
    savedPhotoStatus.textContent = "";
    hideProcessingScreen();
    resultPanel.hidden = true;
    livePanel.hidden = false;
    status.hidden = true;
    status.textContent = "";
    takeButton.textContent = captureMode === "cake" ? "케이크 촬영" : "오늘 촬영";
  }

  function setCaptureMode(mode, { restartFromResult = true } = {}) {
    if (isProcessing) return;
    if (!["cake", "us", "gallery"].includes(mode)) return;
    const previousMode = captureMode;
    const wasShowingResult = !resultPanel.hidden;
    captureMode = mode;
    modeTabs.forEach((tab) => {
      const selected = tab.dataset.cameraMode === mode;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });

    const isGallery = mode === "gallery";
    const isCake = mode === "cake";
    cameraFrame.classList.toggle("is-cake-mode", isCake);
    cameraWriting.hidden = isCake;
    frameControls.hidden = isCake;
    frameOverlay.hidden = isCake || !selectedFrame;
    cakeUploadControl.hidden = !isCake;
    cakeUploadPreview.hidden = !isCake || !uploadedCakeImage;
    photoArea.classList.toggle("has-uploaded-cake", isCake && Boolean(uploadedCakeImage));
    cameraTitle.textContent = isGallery ? "우리의 갤러리" : (isCake ? "생일 케이크 기록" : "우리의 오늘");
    takeButton.textContent = isCake ? "케이크 촬영" : "오늘 촬영";
    resultFrame.classList.toggle("is-cake-strip", isCake);
    document.body.classList.toggle("gallery-active", isGallery);

    if (isGallery) {
      if (wasShowingResult) clearResult();
      stopCamera();
      livePanel.hidden = true;
      resultPanel.hidden = true;
      galleryPanel.hidden = false;
      if (!galleryShown) void renderMoreGalleryPhotos();
      return;
    }

    galleryPanel.hidden = true;
    if (previousMode === "gallery") {
      livePanel.hidden = false;
      resultPanel.hidden = true;
      if (cameraUnlocked) resumeLiveSource();
      return;
    }

    if (!wasShowingResult && previousMode !== mode && cameraUnlocked) {
      if (isCake && uploadedCakeImage) {
        showUploadedCake();
      } else if (!stream) {
        startCamera();
      }
    }

    if (wasShowingResult && restartFromResult) {
      clearResult();
      if (cameraUnlocked) resumeLiveSource();
    }
  }

  async function startCamera() {
    stopCamera();
    cakeUploadPreview.hidden = true;
    photoArea.classList.remove("has-uploaded-cake");
    switchButton.hidden = false;
    switchButton.textContent = "카메라 전환";
    const requestId = ++cameraRequestId;
    takeButton.disabled = true;
    status.hidden = true;
    status.textContent = "";
    cameraFrame.classList.toggle("is-environment", facingMode === "environment");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.hidden = false;
      status.textContent = "이 브라우저에서는 카메라를 사용할 수 없어. Chrome이나 Edge에서 HTTPS 주소로 열어 줘.";
      switchButton.hidden = true;
      return;
    }

    try {
      const requestedStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1440 }
        }
      });
      if (requestId !== cameraRequestId || captureMode === "gallery") {
        requestedStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = requestedStream;
      video.srcObject = stream;
      await video.play();
      if (requestId !== cameraRequestId || captureMode === "gallery") return;
      takeButton.disabled = false;
      status.hidden = true;
      status.textContent = "";
    } catch (error) {
      if (requestId !== cameraRequestId || captureMode === "gallery") return;
      const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
      status.hidden = false;
      status.textContent = denied
        ? "카메라 권한이 필요해. 주소창의 카메라 아이콘에서 허용해 줘."
        : "카메라를 열지 못했어. 다른 앱이 카메라를 사용 중인지 확인해 줘.";
    }
  }

  function stopCamera() {
    cameraRequestId += 1;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
  }

  function coverCrop(sourceWidth, sourceHeight, destinationWidth, destinationHeight) {
    const sourceRatio = sourceWidth / sourceHeight;
    const destinationRatio = destinationWidth / destinationHeight;
    let cropX = 0;
    let cropY = 0;
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;
    if (sourceRatio > destinationRatio) {
      cropWidth = sourceHeight * destinationRatio;
      cropX = (sourceWidth - cropWidth) / 2;
    } else {
      cropHeight = sourceWidth / destinationRatio;
      cropY = (sourceHeight - cropHeight) / 2;
    }
    return { cropX, cropY, cropWidth, cropHeight };
  }

  function drawImageCover(image, x, y, width, height) {
    const crop = coverCrop(image.naturalWidth, image.naturalHeight, width, height);
    context.drawImage(
      image,
      crop.cropX,
      crop.cropY,
      crop.cropWidth,
      crop.cropHeight,
      x,
      y,
      width,
      height
    );
  }

  function drawCurrentCakeCover(x, y, width, height) {
    if (uploadedCakeImage) {
      drawImageCover(uploadedCakeImage, x, y, width, height);
    } else {
      drawVideoCover(x, y, width, height);
    }
  }

  function drawVideoCover(destinationX, destinationY, destinationWidth, destinationHeight) {
    const crop = coverCrop(video.videoWidth, video.videoHeight, destinationWidth, destinationHeight);
    context.save();
    if (facingMode === "user") {
      context.translate(destinationX * 2 + destinationWidth, 0);
      context.scale(-1, 1);
    }
    context.drawImage(
      video,
      crop.cropX,
      crop.cropY,
      crop.cropWidth,
      crop.cropHeight,
      destinationX,
      destinationY,
      destinationWidth,
      destinationHeight
    );
    context.restore();
  }

  function ensureFrameReady() {
    if (!selectedFrame || (frameImage.complete && frameImage.naturalWidth)) return Promise.resolve();
    return new Promise((resolve) => {
      frameImage.addEventListener("load", resolve, { once: true });
      frameImage.addEventListener("error", resolve, { once: true });
    });
  }

  function drawSelectedFrame(x, y, width, height) {
    if (!selectedFrame || !frameImage.naturalWidth) return;
    const overlayWidth = width * frameState.scale / 100;
    const overlayHeight = overlayWidth * frameImage.naturalHeight / frameImage.naturalWidth;
    const centerX = x + width * frameState.x / 100;
    const centerY = y + height * frameState.y / 100;
    context.drawImage(
      frameImage,
      centerX - overlayWidth / 2,
      centerY - overlayHeight / 2,
      overlayWidth,
      overlayHeight
    );
  }

  async function ensureCaptionFontReady() {
    if (!document.fonts || !captionInput.value.trim()) return;
    try {
      await document.fonts.load('54px "Nanum Pen Script"', captionInput.value.trim());
    } catch (_) {
      // 로컬 한글 글꼴 대체재로 계속 촬영한다.
    }
  }

  async function ensureCakeFontReady() {
    if (!document.fonts) return;
    try {
      await document.fonts.load('64px "Nanum Pen Script"', "Happy Birthday 민희 ♥");
    } catch (_) {
      // 인터넷 연결이 없으면 로컬 글꼴로 같은 문구를 그린다.
    }
  }

  function drawPolaroid() {
    canvas.width = 1200;
    canvas.height = 1500;
    const width = canvas.width;
    const margin = 64;
    const photoWidth = width - margin * 2;
    const photoHeight = 1120;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, canvas.height);
    drawVideoCover(margin, margin, photoWidth, photoHeight);

    const softGradient = context.createLinearGradient(0, margin, 0, margin + photoHeight);
    softGradient.addColorStop(0, "rgba(82, 24, 58, 0.03)");
    softGradient.addColorStop(1, "rgba(24, 11, 30, 0.17)");
    context.fillStyle = softGradient;
    context.fillRect(margin, margin, photoWidth, photoHeight);
    drawSelectedFrame(margin, margin, photoWidth, photoHeight);

    context.fillStyle = "#765e67";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const caption = captionInput.value.trim();
    let captionSize = 54;
    do {
      context.font = `400 ${captionSize}px ${CAPTION_FONT}`;
      captionSize -= 2;
    } while (captionSize > 28 && context.measureText(caption).width > width - 180);
    if (caption) context.fillText(caption, width / 2, 1308);
    context.font = `400 40px ${CAPTION_FONT}`;
    context.fillText("20260909", width / 2, 1372);
    context.textAlign = "left";
  }

  async function getCakeImages() {
    if (window.SITE_ASSETS?.ready) await window.SITE_ASSETS.ready;
    return Promise.all(cakeFiles.map((filename) => {
      const url = cakeUrl(filename);
      const cached = window.SITE_ASSETS?.getImage(url);
      if (cached) return cached;
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
    }));
  }

  async function drawCakeStrip() {
    const pastCakes = await getCakeImages();
    await ensureCakeFontReady();
    const stripWidth = 1200;
    const sideMargin = 56;
    const topMargin = 40;
    const yearBandHeight = 116;
    const footerTopGap = 56;
    const footerHeight = 150;
    const bottomMargin = 54;
    const photoSize = stripWidth - sideMargin * 2;
    const photoCount = pastCakes.length + 1;
    const years = [
      ...cakeFiles.map((filename, index) => filename.match(/\d{4}/)?.[0] || String(2024 + index)),
      "2026"
    ];
    canvas.width = stripWidth;
    canvas.height = topMargin
      + (yearBandHeight + photoSize) * photoCount
      + footerTopGap
      + footerHeight
      + bottomMargin;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#765e67";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 42px "Segoe UI", "Apple SD Gothic Neo", sans-serif';

    pastCakes.forEach((image, index) => {
      const sectionY = topMargin + index * (yearBandHeight + photoSize);
      context.fillText(years[index], stripWidth / 2, sectionY + yearBandHeight / 2);
      drawImageCover(image, sideMargin, sectionY + yearBandHeight, photoSize, photoSize);
    });
    const currentSectionY = topMargin + pastCakes.length * (yearBandHeight + photoSize);
    context.fillText(years[years.length - 1], stripWidth / 2, currentSectionY + yearBandHeight / 2);
    const currentPhotoY = currentSectionY + yearBandHeight;
    drawCurrentCakeCover(sideMargin, currentPhotoY, photoSize, photoSize);

    const greetingY = currentPhotoY + photoSize + footerTopGap + footerHeight / 2;
    context.fillStyle = "#8f3155";
    context.font = `400 64px ${CAPTION_FONT}`;
    context.fillText("Happy Birthday 민희 ♥", stripWidth / 2, greetingY);
    context.textAlign = "left";
  }

  async function takePhoto() {
    const hasLiveCamera = Boolean(stream && video.videoWidth);
    if ((captureMode === "cake" && !uploadedCakeImage && !hasLiveCamera)
      || (captureMode === "us" && !hasLiveCamera)) return;
    const processingMode = captureMode;
    const requestId = ++captureRequestId;
    takeButton.disabled = true;
    takeButton.textContent = "처리중…";
    switchButton.disabled = true;
    status.hidden = true;
    status.textContent = "";
    showProcessingScreen(processingMode);

    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 40)));

    try {
      if (processingMode === "cake") {
        await drawCakeStrip();
      } else {
        await ensureFrameReady();
        await ensureCaptionFontReady();
        drawPolaroid();
      }
      if (requestId !== captureRequestId) return;

      canvas.toBlob((blob) => {
        if (requestId !== captureRequestId) return;
        switchButton.disabled = false;
        hideProcessingScreen();
        if (!blob) {
          livePanel.hidden = false;
          status.hidden = false;
          status.textContent = "사진을 만들지 못했어. 한 번 더 촬영해 줘.";
          takeButton.disabled = false;
          takeButton.textContent = processingMode === "cake" ? "케이크 촬영" : "오늘 촬영";
          return;
        }
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        photoBlob = blob;
        savedPhotoId = null;
        savedPhotoStatus.textContent = "";
        photoUrl = URL.createObjectURL(blob);
        capturedImage.src = photoUrl;
        downloadLink.href = photoUrl;
        const isCake = processingMode === "cake";
        downloadLink.dataset.captureMode = isCake ? "cake" : "us";
        downloadLink.download = createDownloadFilename(downloadLink.dataset.captureMode);
        capturedImage.alt = isCake
          ? "2024년, 2025년, 2026년 케이크 사진과 생일 축하 문구를 세로로 이어 붙인 사진"
          : "생일 문구 프레임과 날짜가 들어간 오늘의 우리 사진";
        resultFrame.classList.toggle("is-cake-strip", isCake);
        livePanel.hidden = true;
        resultPanel.hidden = false;
        status.hidden = true;
        status.textContent = "";
        takeButton.textContent = isCake ? "케이크 촬영" : "오늘 촬영";
        stopCamera();
        retakeButton.focus();
      }, "image/png");
    } catch (error) {
      if (requestId !== captureRequestId) return;
      console.error(error);
      switchButton.disabled = false;
      hideProcessingScreen();
      livePanel.hidden = false;
      status.hidden = false;
      status.textContent = "사진 재료를 준비하지 못했어. 페이지를 새로 열고 다시 촬영해 줘.";
      takeButton.disabled = false;
      takeButton.textContent = processingMode === "cake" ? "케이크 촬영" : "오늘 촬영";
    }
  }

  function createDownloadFilename(mode) {
    const now = new Date();
    const pad = (value, length = 2) => String(value).padStart(length, "0");
    const timestamp = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate())
    ].join("") + "-" + [
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds())
    ].join("") + `-${pad(now.getMilliseconds(), 3)}`;
    downloadSequence = (downloadSequence + 1) % 1000;
    const subject = mode === "cake" ? "birthday-cakes" : "birthday-photo";
    return `minhee-${subject}-${timestamp}-${pad(downloadSequence, 3)}.png`;
  }

  downloadLink?.addEventListener("click", async () => {
    downloadLink.download = createDownloadFilename(downloadLink.dataset.captureMode || captureMode);
    if (!photoBlob || savedPhotoId || savingPhoto || !window.SITE_MEMORIES) return;
    const blobToSave = photoBlob;
    savingPhoto = true;
    savedPhotoStatus.textContent = "사진을 갤러리와 배경에 넣는 중…";
    try {
      const memory = await window.SITE_MEMORIES.save(
        blobToSave,
        downloadLink.dataset.captureMode || captureMode
      );
      if (photoBlob === blobToSave) savedPhotoId = memory.id;
      savedPhotoStatus.textContent = memory.persisted
        ? "저장 완료 · 메인 배경에서 사진을 드래그해 옮길 수도 있어."
        : "파일은 저장했고, 이번 화면의 갤러리와 배경에 추가했어.";
    } catch (error) {
      console.error(error);
      savedPhotoStatus.textContent = "파일은 저장했지만 갤러리에는 추가하지 못했어.";
    } finally {
      if (photoBlob === blobToSave) savingPhoto = false;
    }
  });

  function pointerDistance() {
    const [first, second] = Array.from(activePointers.values());
    return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
  }

  photoArea.addEventListener("pointerdown", (event) => {
    if (captureMode !== "us" || !selectedFrame) return;
    event.preventDefault();
    photoArea.setPointerCapture(event.pointerId);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size >= 2) {
      pinchStart = { distance: pointerDistance(), scale: frameState.scale };
      dragStart = null;
      frameOverlay.classList.add("is-dragging");
    } else if (event.target === frameOverlay) {
      frameOverlay.classList.add("is-dragging");
      dragStart = { pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY, ...frameState };
    }
  });

  photoArea.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinchStart && activePointers.size >= 2) {
      const distance = pointerDistance();
      if (pinchStart.distance > 0) {
        frameState.scale = clamp(pinchStart.scale * distance / pinchStart.distance, 20, 140);
        updateFramePosition();
      }
      return;
    }

    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const bounds = photoArea.getBoundingClientRect();
    frameState.x = clamp(dragStart.x + (event.clientX - dragStart.pointerX) / bounds.width * 100, 0, 100);
    frameState.y = clamp(dragStart.y + (event.clientY - dragStart.pointerY) / bounds.height * 100, 0, 100);
    updateFramePosition();
  });

  function finishFrameGesture(event) {
    activePointers.delete(event.pointerId);
    if (pinchStart) {
      if (activePointers.size < 2) {
        pinchStart = null;
        dragStart = null;
        frameOverlay.classList.remove("is-dragging");
        saveFrameState();
      }
      return;
    }
    if (dragStart && dragStart.pointerId === event.pointerId) {
      dragStart = null;
      frameOverlay.classList.remove("is-dragging");
      saveFrameState();
    }
  }

  photoArea.addEventListener("pointerup", finishFrameGesture);
  photoArea.addEventListener("pointercancel", finishFrameGesture);
  takeButton.addEventListener("click", takePhoto);
  cakeUploadControl.addEventListener("click", () => cakePhotoUpload.click());
  switchButton.addEventListener("click", async () => {
    if (captureMode === "cake" && uploadedCakeImage) {
      clearUploadedCake();
      await startCamera();
      return;
    }
    facingMode = facingMode === "user" ? "environment" : "user";
    await startCamera();
  });
  cakePhotoUpload.addEventListener("change", () => {
    const file = cakePhotoUpload.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      status.hidden = false;
      status.textContent = "이미지 파일만 올릴 수 있어.";
      cakePhotoUpload.value = "";
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    const nextImage = new Image();
    nextImage.onload = () => {
      clearUploadedCake();
      uploadedCakeUrl = nextUrl;
      uploadedCakeImage = nextImage;
      showUploadedCake();
    };
    nextImage.onerror = () => {
      URL.revokeObjectURL(nextUrl);
      cakePhotoUpload.value = "";
      status.hidden = false;
      status.textContent = "사진을 읽지 못했어. 다른 이미지로 다시 시도해 줘.";
    };
    nextImage.src = nextUrl;
  });
  retakeButton.addEventListener("click", () => {
    clearResult();
    resumeLiveSource();
  });
  galleryMore.addEventListener("click", () => void renderMoreGalleryPhotos());
  document.addEventListener("memory-saved", async (event) => {
    await savedGalleryReady;
    const memory = event.detail;
    if (!memory || galleryItems.some((item) => item.id === memory.id)) return;
    const item = { id: memory.id, src: memory.src, saved: true };
    galleryItems.unshift(item);
    if (galleryShown > 0) {
      galleryGrid.prepend(createGalleryFigure(item));
      galleryShown += 1;
    }
    updateGalleryMeta();
  });
  document.addEventListener("memory-deleted", async (event) => {
    await savedGalleryReady;
    const id = event.detail?.id;
    const itemIndex = galleryItems.findIndex((item) => item.id === id);
    if (itemIndex < 0) return;
    const wasVisible = itemIndex < galleryShown;
    galleryItems.splice(itemIndex, 1);
    if (wasVisible) {
      Array.from(galleryGrid.children).find((figure) => figure.dataset.galleryId === id)?.remove();
      galleryShown -= 1;
      if (galleryShown < galleryItems.length) {
        galleryGrid.append(createGalleryFigure(galleryItems[galleryShown]));
        galleryShown += 1;
      }
    }
    updateGalleryMeta();
  });
  memoryDeleteBackdrop.addEventListener("click", () => closeMemoryDeleteDialog());
  memoryDeleteCancel.addEventListener("click", () => closeMemoryDeleteDialog());
  memoryDeleteConfirm.addEventListener("click", async () => {
    if (!pendingDeleteId || !window.SITE_MEMORIES) return;
    const id = pendingDeleteId;
    memoryDeleteConfirm.disabled = true;
    memoryDeleteCancel.disabled = true;
    memoryDeleteConfirm.textContent = "삭제 중…";
    memoryDeleteStatus.textContent = "이 사진 하나를 정리하고 있어.";
    try {
      await window.SITE_MEMORIES.delete(id);
      memoryDeleteConfirm.disabled = false;
      memoryDeleteCancel.disabled = false;
      closeMemoryDeleteDialog({ restoreFocus: false });
      modeTabs.find((tab) => tab.dataset.cameraMode === "gallery")?.focus({ preventScroll: true });
    } catch (error) {
      console.error(error);
      memoryDeleteConfirm.disabled = false;
      memoryDeleteCancel.disabled = false;
      memoryDeleteConfirm.textContent = "다시 삭제";
      memoryDeleteStatus.textContent = "삭제하지 못했어. 잠시 뒤 다시 눌러 줘.";
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || memoryDeleteDialog.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeMemoryDeleteDialog();
  }, true);
  modeTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setCaptureMode(tab.dataset.cameraMode));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const nextIndex = event.key === "ArrowRight"
        ? (index + 1) % modeTabs.length
        : (index - 1 + modeTabs.length) % modeTabs.length;
      modeTabs[nextIndex].click();
      modeTabs[nextIndex].focus();
    });
  });
  window.addEventListener("beforeunload", () => {
    stopCamera();
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (uploadedCakeUrl) URL.revokeObjectURL(uploadedCakeUrl);
  });
  document.addEventListener("feature-opened", (event) => {
    cameraUnlocked = false;
    stopCamera();
    hideProcessingScreen();
    if (!resultPanel.hidden) clearResult();
    const requestedMode = event.detail?.mode;
    setCaptureMode(["cake", "us", "gallery"].includes(requestedMode) ? requestedMode : "cake", {
      restartFromResult: false
    });
    cameraUnlocked = true;
    if (captureMode !== "gallery") resumeLiveSource();
  });
  document.addEventListener("feature-closed", () => {
    captureRequestId += 1;
    cameraUnlocked = false;
    stopCamera();
    hideProcessingScreen();
    if (!resultPanel.hidden) clearResult();
    clearUploadedCake();
    galleryPanel.hidden = true;
    livePanel.hidden = false;
    document.body.classList.remove("gallery-active");
  });

  renderFrameOptions();
  setCaptureMode("cake", { restartFromResult: false });
})();
