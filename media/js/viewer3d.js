import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

(function initRobotViewer() {
  const container = document.getElementById("model-viewer-frame");
  const canvas = document.getElementById("robot-canvas");
  const loadingEl = document.getElementById("viewer-loading");
  const btnMotion = document.getElementById("btn-toggle-motion");
  const btnShell = document.getElementById("btn-toggle-shell");
  const btnReset = document.getElementById("btn-reset-cam");

  if (!container || !canvas) return;

  if (!window.WebGLRenderingContext) {
    if (loadingEl) loadingEl.innerHTML = "<p style='color:#e0662b'>WebGL not supported</p>";
    return;
  }

  // --- Scene, Camera, Renderer ---
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    40,
    container.clientWidth / container.clientHeight,
    0.05,
    10
  );
  const initialCamPos = new THREE.Vector3(0.52, 0.38, 0.62);
  const initialTarget = new THREE.Vector3(0, 0, 0);
  camera.position.copy(initialCamPos);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    stencil: false,
    depth: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.setClearColor(0x000000, 0);

  // --- OrbitControls ---
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 0.25;
  controls.maxDistance = 1.6;
  controls.maxPolarAngle = Math.PI * 0.95;
  controls.target.copy(initialTarget);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;

  const hintBadge = container.querySelector(".viewer-hint-badge");
  controls.listenToKeyEvents(canvas);

  let idleTimer = null;
  controls.addEventListener("start", () => {
    controls.autoRotate = false;
    if (idleTimer) clearTimeout(idleTimer);
    if (hintBadge) hintBadge.classList.add("is-hidden");
  });
  controls.addEventListener("end", () => {
    idleTimer = setTimeout(() => {
      controls.autoRotate = true;
    }, 4000);
  });
  setTimeout(() => {
    if (hintBadge) hintBadge.classList.add("is-hidden");
  }, 4000);

  // --- Lighting ---
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xfff8ee, 2.5);
  keyLight.position.set(2.2, 3.8, 2.5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xe8f0ff, 1.2);
  fillLight.position.set(-2.5, -1.0, -2.0);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.9);
  rimLight.position.set(0.0, -3.0, 1.5);
  scene.add(rimLight);

  // --- Materials ---
  const materials = {
    mat_PA_12_Nylon_PA_603_CF_with_EOS_P_3D_Prin: new THREE.MeshStandardMaterial({
      color: 0x222224, roughness: 0.75, metalness: 0.1
    }),
    mat_ABS_White: new THREE.MeshStandardMaterial({
      color: 0xf4f4f3, roughness: 0.75, metalness: 0.0
    }),
    mat_Carbon_Fiber_Plain: new THREE.MeshStandardMaterial({
      color: 0x2d2d30, roughness: 0.4, metalness: 0.3
    }),
    mat_Stainless_Steel_Satin: new THREE.MeshStandardMaterial({
      color: 0xd5d5d8, roughness: 0.3, metalness: 0.85
    }),
    mat_Aluminum_Satin: new THREE.MeshStandardMaterial({
      color: 0xe8e8eb, roughness: 0.35, metalness: 0.75
    }),
    mat_Steel_Satin: new THREE.MeshStandardMaterial({
      color: 0xa5a5aa, roughness: 0.35, metalness: 0.85
    }),
    mat_Plastic_Glossy_Black: new THREE.MeshStandardMaterial({
      color: 0x181818, roughness: 0.2, metalness: 0.1
    }),
    mat_Opaque_229_234_237: new THREE.MeshStandardMaterial({
      color: 0xe2e5ea, roughness: 0.4, metalness: 0.5
    }),
    mat_Opaque_229_234_237_2: new THREE.MeshStandardMaterial({
      color: 0xe2e5ea, roughness: 0.7, metalness: 0.1
    }),
    mat_Rubber_Soft: new THREE.MeshStandardMaterial({
      color: 0x141414, roughness: 0.9, metalness: 0.0
    }),
    mat_ABS_White_2: new THREE.MeshStandardMaterial({
      color: 0xe5e9f0, roughness: 0.92, metalness: 0.0, transparent: true, opacity: 0.36, depthWrite: false
    }),
    mat_Slider_Weight: new THREE.MeshStandardMaterial({
      color: 0xc8cbd2, roughness: 0.28, metalness: 0.9
    }),
    mat_Slider_Carriage: new THREE.MeshStandardMaterial({
      color: 0xe0e2e6, roughness: 0.35, metalness: 0.75
    }),
    mat_Slider_Bearing: new THREE.MeshStandardMaterial({
      color: 0xf2f4f8, roughness: 0.15, metalness: 0.95
    }),
    mat_Slider_Hardware: new THREE.MeshStandardMaterial({
      color: 0xb4b6bc, roughness: 0.4, metalness: 0.8
    }),
    default: new THREE.MeshStandardMaterial({
      color: 0xb0b0b5, roughness: 0.4, metalness: 0.5
    })
  };

  function getMaterial(matName, meshName) {
    if (materials[matName]) return materials[matName];
    if (meshName === "Weight") return materials.mat_Slider_Weight;
    if (meshName === "base") return materials.mat_Slider_Carriage;
    if (meshName.includes("Bearing")) return materials.mat_Slider_Bearing;
    if (meshName.includes("Bolt") || meshName.includes("Pillow")) return materials.mat_Slider_Hardware;
    return materials.default;
  }

  // --- Scene Graph References ---
  const robotRoot = new THREE.Group();
  // Rotate MuJoCo Z-up to Three.js Y-up
  robotRoot.rotation.x = -Math.PI / 2;
  scene.add(robotRoot);

  // Subtle contact shadow plane on ground below robot
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const shadowCtx = shadowCanvas.getContext("2d");
  const shadowGrad = shadowCtx.createRadialGradient(64, 64, 4, 64, 64, 62);
  shadowGrad.addColorStop(0, "rgba(0, 0, 0, 0.25)");
  shadowGrad.addColorStop(0.35, "rgba(0, 0, 0, 0.10)");
  shadowGrad.addColorStop(0.7, "rgba(0, 0, 0, 0.025)");
  shadowGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  shadowCtx.fillStyle = shadowGrad;
  shadowCtx.fillRect(0, 0, 128, 128);

  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowGeo = new THREE.PlaneGeometry(0.52, 0.52);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = -0.2025;
  scene.add(shadowMesh);

  const frameGroup = new THREE.Group();
  const shellGroup = new THREE.Group();
  robotRoot.add(frameGroup);
  robotRoot.add(shellGroup);

  let sliderZGroup = null;
  let sliderYGroup = null;
  let sliderXGroup = null;

  let initialPosZ = new THREE.Vector3();
  let initialPosY = new THREE.Vector3();
  let initialPosX = new THREE.Vector3();

  // Local slide axes in each slider body's local frame
  const localAxisZ = new THREE.Vector3(0, 1, 0);  // Joint 5: axis="... 1 ..."
  const localAxisY = new THREE.Vector3(0, -1, 0); // Joint 6: axis="... -1 ..."
  const localAxisX = new THREE.Vector3(0, 1, 0);  // Joint 7: axis="... 1 ..."

  // Parent-space slide directions (mutually orthogonal: X, Y, Z)
  const slideDirZ = new THREE.Vector3(0, 0, -1);
  const slideDirY = new THREE.Vector3(0, 1, 0);
  const slideDirX = new THREE.Vector3(-1, 0, 0);

  // Motion params
  let motionEnabled = true;
  const stroke = 0.088; // 88 mm amplitude (physical limit is 110 mm)
  const freq = 1.85;    // rad/s
  const clock = new THREE.Clock();
  let simTime = 0;

  // Shell modes: 0: Translucent, 1: Hidden, 2: Opaque
  let shellMode = 0;
  const shellModes = [
    { text: "Shell: Translucent", label: "Shell mode: Translucent. Click to hide" },
    { text: "Shell: Hidden", label: "Shell mode: Hidden. Click to make opaque" },
    { text: "Shell: Opaque", label: "Shell mode: Opaque. Click to make translucent" }
  ];

  function updateShellDisplay() {
    if (shellMode === 0) {
      shellGroup.visible = true;
      materials.mat_ABS_White_2.transparent = true;
      materials.mat_ABS_White_2.opacity = 0.36;
      materials.mat_ABS_White_2.roughness = 0.92;
      materials.mat_ABS_White_2.metalness = 0.0;
      materials.mat_ABS_White_2.depthWrite = false;
      materials.mat_ABS_White_2.needsUpdate = true;
    } else if (shellMode === 1) {
      shellGroup.visible = false;
    } else {
      shellGroup.visible = true;
      materials.mat_ABS_White_2.transparent = false;
      materials.mat_ABS_White_2.opacity = 1.0;
      materials.mat_ABS_White_2.roughness = 0.92;
      materials.mat_ABS_White_2.metalness = 0.0;
      materials.mat_ABS_White_2.depthWrite = true;
      materials.mat_ABS_White_2.needsUpdate = true;
    }
    if (btnShell) {
      const text = btnShell.querySelector(".btn-text");
      if (text) text.textContent = shellModes[shellMode].text;
      btnShell.setAttribute("aria-label", shellModes[shellMode].label);
    }
  }

  // --- Load Assembly & Pristine Original STLs ---
  const stlLoader = new STLLoader();
  const geometryCache = new Map();

  function loadSTL(meshName, filePath) {
    return new Promise((resolve) => {
      stlLoader.load(
        filePath,
        (geo) => {
          geo.computeVertexNormals();
          geometryCache.set(meshName, geo);
          resolve(geo);
        },
        undefined,
        (err) => {
          console.warn(`Failed to load STL: ${filePath}`, err);
          resolve(null);
        }
      );
    });
  }

  function buildBodyHierarchy(bodyData, meshScales) {
    const group = new THREE.Group();
    group.name = bodyData.name;
    group.position.set(bodyData.pos[0], bodyData.pos[1], bodyData.pos[2]);
    group.quaternion.set(bodyData.quat[0], bodyData.quat[1], bodyData.quat[2], bodyData.quat[3]);

    for (const g of bodyData.geoms) {
      const geo = geometryCache.get(g.mesh);
      if (geo) {
        const mat = getMaterial(g.mat, g.mesh);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `${bodyData.name}_${g.mesh}`;
        mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
        mesh.quaternion.set(g.quat[0], g.quat[1], g.quat[2], g.quat[3]);
        const s = meshScales[g.mesh] || [0.001, 0.001, 0.001];
        mesh.scale.set(s[0], s[1], s[2]);
        group.add(mesh);
      }
    }

    for (const child of bodyData.children) {
      group.add(buildBodyHierarchy(child, meshScales));
    }

    return group;
  }

  async function loadAssembly() {
    try {
      const resp = await fetch("media/models/assembly.json");
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      const data = await resp.json();

      const meshEntries = Object.entries(data.mesh_files);
      const totalMeshes = meshEntries.length;
      let loaded = 0;

      // Load all 68 original STLs in parallel batches for maximum loading speed
      const batchSize = 12;
      for (let i = 0; i < totalMeshes; i += batchSize) {
        const batch = meshEntries.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async ([name, file]) => {
            await loadSTL(name, file);
            loaded++;
            if (loadingEl) {
              const span = loadingEl.querySelector("span");
              const pct = Math.round((loaded / totalMeshes) * 100);
              if (span) span.textContent = `Loading CAD Meshes (${pct}%)...`;
            }
          })
        );
      }

      // Build Frame Bodies
      for (const b of data.frame_bodies) {
        frameGroup.add(buildBodyHierarchy(b, data.mesh_scales));
      }

      // Build Shell Bodies
      for (const b of data.shell_bodies) {
        shellGroup.add(buildBodyHierarchy(b, data.mesh_scales));
      }

      // Build 3 Sliders
      if (data.slider_z) {
        sliderZGroup = buildBodyHierarchy(data.slider_z, data.mesh_scales);
        initialPosZ.copy(sliderZGroup.position);
        slideDirZ.copy(localAxisZ).applyQuaternion(sliderZGroup.quaternion).normalize();
        robotRoot.add(sliderZGroup);
      }

      if (data.slider_y) {
        sliderYGroup = buildBodyHierarchy(data.slider_y, data.mesh_scales);
        initialPosY.copy(sliderYGroup.position);
        slideDirY.copy(localAxisY).applyQuaternion(sliderYGroup.quaternion).normalize();
        robotRoot.add(sliderYGroup);
      }

      if (data.slider_x) {
        sliderXGroup = buildBodyHierarchy(data.slider_x, data.mesh_scales);
        initialPosX.copy(sliderXGroup.position);
        slideDirX.copy(localAxisX).applyQuaternion(sliderXGroup.quaternion).normalize();
        robotRoot.add(sliderXGroup);
      }

      updateShellDisplay();

      if (loadingEl) {
        loadingEl.classList.add("is-loaded");
        setTimeout(() => loadingEl.remove(), 350);
      }
    } catch (err) {
      console.error("Failed to load MARBLE assembly:", err);
      if (loadingEl) {
        loadingEl.innerHTML = "<p style='color:#e0662b'>Failed to load robot CAD model</p>";
      }
    }
  }

  loadAssembly();

  // --- UI Controls ---
  if (btnMotion) {
    btnMotion.addEventListener("click", () => {
      motionEnabled = !motionEnabled;
      const text = btnMotion.querySelector(".btn-text");
      const icon = btnMotion.querySelector(".btn-icon");
      if (motionEnabled) {
        text.textContent = "Motion: On";
        icon.textContent = "⏸";
        btnMotion.classList.remove("is-paused");
        btnMotion.setAttribute("aria-pressed", "false");
        btnMotion.setAttribute("aria-label", "Pause slider motion");
      } else {
        text.textContent = "Motion: Paused";
        icon.textContent = "▶";
        btnMotion.classList.add("is-paused");
        btnMotion.setAttribute("aria-pressed", "true");
        btnMotion.setAttribute("aria-label", "Resume slider motion");
      }
    });
  }

  if (btnShell) {
    btnShell.addEventListener("click", () => {
      shellMode = (shellMode + 1) % 3;
      updateShellDisplay();
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      camera.position.copy(initialCamPos);
      controls.target.copy(initialTarget);
      controls.update();
    });
  }

  // --- Resize Handler ---
  function onResize() {
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
  }
  window.addEventListener("resize", onResize, { passive: true });

  // --- Zero-Lag Render Loop with IntersectionObserver ---
  let isVisible = false;
  let reqId = null;

  function animate() {
    if (!isVisible) {
      reqId = null;
      return;
    }
    reqId = requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.1);

    // Continuous sinusoidal oscillation without teleportation on pause/resume
    if (motionEnabled) {
      simTime += delta;
      const t = simTime * freq;

      // Joint 7 (base / Slider X): orthogonal along parent X axis
      const dispX = stroke * Math.sin(t);
      if (sliderXGroup) {
        sliderXGroup.position.copy(initialPosX).addScaledVector(slideDirX, dispX);
      }

      // Joint 6 (base-1 / Slider Y): orthogonal along parent Y axis
      const dispY = stroke * Math.sin(t + (2 * Math.PI) / 3);
      if (sliderYGroup) {
        sliderYGroup.position.copy(initialPosY).addScaledVector(slideDirY, dispY);
      }

      // Joint 5 (base-2 / Slider Z): orthogonal along parent Z axis
      const dispZ = stroke * Math.sin(t + (4 * Math.PI) / 3);
      if (sliderZGroup) {
        sliderZGroup.position.copy(initialPosZ).addScaledVector(slideDirZ, dispZ);
      }
    }

    controls.update();
    renderer.render(scene, camera);
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        isVisible = e.isIntersecting;
        if (isVisible && reqId === null) {
          clock.getDelta(); // flush delta to prevent jump
          animate();
        }
      });
    },
    { rootMargin: "150px 0px" }
  );

  io.observe(container);
})();
