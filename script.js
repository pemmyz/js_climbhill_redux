'use strict';

window.addEventListener('load', () => {

    // --- CONFIGURATION ---
    const SETTINGS = {
        graphics: 'modern', 
        cameraZoom: 28,
        dayCycleDuration: 120,
        
        suspension: 'original',
        physicsMode: 'modern',
        physicsHz: 60,
        physicsIter: 8,
    };

    const PHYS_CONST = {
        GRAVITY: -10,
        MAX_FRAME_TIME: 0.1 
    };

    const PHYSICS_PRESETS = {
        modern: { hz: 60, iter: 8 },
        classic: { hz: 60, iter: 4 },
        basic: { hz: 30, iter: 2 }
    };

    const VEHICLE_PARAMS = {
        CHASSIS_MASS: 180,
        WHEEL_MASS: 12, WHEEL_RADIUS: 0.35, WHEEL_FRICTION: 1.6, WHEEL_RESTITUTION: 0.05,
        TRACK_WIDTH: 1.7,
        SUSPENSION_FREQ_HZ: 2.0, SUSPENSION_DAMPING_RATIO: 0.45, SUSPENSION_TRAVEL: 0.35,
        MOTOR_TORQUE: 900, MOTOR_MAX_SPEED: 70, BRAKE_TORQUE: 1800,
        AIR_CONTROL_TORQUE: 1800, AIR_CONTROL_DAMPING: 30
    };

    const TERRAIN = { 
        SEGMENT_LEN: 100, 
        DENSITY: 1.2 
    };

    const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

    // --- GLOBALS ---
    const pl = planck, Vec2 = pl.Vec2;
    let world, vehicle, terrainManager, environment;
    let scene, camera, renderer;
    let gameState = { paused: false, debug: false, gameOver: false, distance: 0, fuel: 100, lastCheckpoint: null, timeOfDay: 0 };

    // --- GRAPHICS ENGINE ---
    function initGraphics() {
        const canvas = document.getElementById('game-canvas');
        
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB);

        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 5, SETTINGS.cameraZoom);

        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        function handleResize() {
            // Update camera and renderer to fill the exact screen dimensions
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            
            // Toggle body class based on actual fullscreen state
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                document.body.classList.add('mobile-mode');
            } else {
                document.body.classList.remove('mobile-mode');
            }
        }

        window.addEventListener('resize', handleResize);
        window.addEventListener('fullscreenchange', handleResize);
        window.addEventListener('webkitfullscreenchange', handleResize);
        
        handleResize(); // Trigger initial sizing
    }

    // --- ENVIRONMENT SYSTEM ---
    class Environment {
        constructor() {
            this.container = new THREE.Group();
            scene.add(this.container);

            this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
            this.container.add(this.hemiLight);

            this.sunLight = new THREE.DirectionalLight(0xffffee, 1.2);
            this.sunLight.castShadow = true;
            this.sunLight.shadow.mapSize.width = 2048; 
            this.sunLight.shadow.mapSize.height = 2048;
            this.sunLight.shadow.camera.near = 0.5;
            this.sunLight.shadow.camera.far = 100;
            const d = 40;
            this.sunLight.shadow.camera.left = -d; this.sunLight.shadow.camera.right = d;
            this.sunLight.shadow.camera.top = d; this.sunLight.shadow.camera.bottom = -d;
            this.container.add(this.sunLight);
            
            this.starField = this.createStars();
            this.container.add(this.starField);
            
            this.moonMesh = new THREE.Mesh(
                new THREE.SphereGeometry(4, 16, 16),
                new THREE.MeshBasicMaterial({ color: 0xffffdd })
            );
            this.container.add(this.moonMesh);

            this.clouds = [];
            this.cloudGroup = new THREE.Group();
            this.createClouds();
            this.container.add(this.cloudGroup);

            this.colors = {
                daySky: new THREE.Color(0x87CEEB),
                noonSky: new THREE.Color(0x4CA1E3),
                sunsetSky: new THREE.Color(0xFD5E53),
                nightSky: new THREE.Color(0x0a0a15),
                daySun: new THREE.Color(0xffffee),
                sunsetSun: new THREE.Color(0xffaa00)
            };
        }

        createStars() {
            const geo = new THREE.BufferGeometry();
            const pos = [];
            for(let i=0; i<1000; i++) {
                pos.push((Math.random()-0.5)*400, (Math.random()-0.5)*200 + 50, (Math.random()-0.5)*100 - 50);
            }
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            const mat = new THREE.PointsMaterial({color: 0xffffff, size: 0.7, transparent: true, opacity: 0});
            return new THREE.Points(geo, mat);
        }

        createClouds() {
            const geo = new THREE.DodecahedronGeometry(1, 0);
            const mat = new THREE.MeshStandardMaterial({ 
                color: 0xffffff, roughness: 0.9, flatShading: true, transparent: true, opacity: 0.8 
            });
            
            for(let i=0; i<15; i++) {
                const mesh = new THREE.Mesh(geo, mat);
                const scale = 2 + Math.random() * 4;
                mesh.scale.set(scale*1.5, scale, scale);
                mesh.position.set(Math.random()*200 - 100, 20 + Math.random()*20, -10 - Math.random()*30);
                mesh.userData = { speed: 0.5 + Math.random() * 2 };
                this.clouds.push(mesh);
                this.cloudGroup.add(mesh);
            }
        }

        update(dt, carPos) {
            
            if (vehicle && vehicle.headlights) {
                const lightsOn = (SETTINGS.graphics === 'modern');
                vehicle.headlights.forEach(l => l.visible = lightsOn);
            }

            if (SETTINGS.graphics === 'basic') {
                renderer.shadowMap.enabled = false;
                this.sunLight.intensity = 0.8; 
                this.sunLight.castShadow = false;
                this.sunLight.position.set(carPos.x + 20, 50, 30);
                this.sunLight.target.position.set(carPos.x, 0, 0);
                this.sunLight.target.updateMatrixWorld();
                
                this.hemiLight.color.setHex(0xffffff);
                this.hemiLight.groundColor.setHex(0xaaaaaa); 
                this.hemiLight.intensity = 0.8; 

                scene.background = new THREE.Color(0x6495ED); 
                scene.fog = null;

                this.starField.visible = false;
                this.cloudGroup.visible = false;
                this.moonMesh.visible = false;
                document.getElementById('time-display').innerText = "--:--";
                return;
            }

            if (SETTINGS.graphics === 'classic') {
                renderer.shadowMap.enabled = true;
                this.sunLight.castShadow = true;
                
                this.sunLight.intensity = 1.2;
                this.sunLight.color.setHex(0xffffee);
                this.sunLight.position.set(carPos.x + 50, 60, 20);
                this.sunLight.target.position.set(carPos.x, 0, 0);
                this.sunLight.target.updateMatrixWorld();

                this.hemiLight.color.setHex(0xffffff);
                this.hemiLight.groundColor.setHex(0x444444);
                this.hemiLight.intensity = 0.6;

                scene.background = this.colors.daySky;
                scene.fog = new THREE.Fog(this.colors.daySky, 30, 90);

                this.starField.visible = false;
                this.cloudGroup.visible = false;
                this.moonMesh.visible = false;
                document.getElementById('time-display').innerText = "12:00";
                return;
            }

            // Modern Mode
            renderer.shadowMap.enabled = true;
            this.sunLight.castShadow = true;
            this.cloudGroup.visible = true;
            this.starField.visible = true;
            this.moonMesh.visible = true;
            this.hemiLight.groundColor.setHex(0x444444);
            this.hemiLight.color.setHex(0xffffff);
            
            gameState.timeOfDay = (gameState.timeOfDay + dt / SETTINGS.dayCycleDuration) % 1;
            
            const t = gameState.timeOfDay;
            const angle = (t * Math.PI * 2) + (Math.PI / 2); 
            const dist = 60;
            
            const sunX = Math.cos(angle) * dist;
            const sunY = Math.sin(angle) * dist;
            
            this.sunLight.position.set(carPos.x + sunX, sunY, 20);
            this.sunLight.target.position.set(carPos.x, 0, 0);
            this.sunLight.target.updateMatrixWorld();

            this.moonMesh.position.set(carPos.x - sunX, -sunY, -30);
            this.moonMesh.lookAt(carPos.x, 0, 0);

            let skyColor = this.colors.daySky.clone();
            let sunInt = 1.2;
            let starOp = 0;

            if (t > 0.2 && t < 0.3) { 
                const k = (t - 0.2) * 10;
                skyColor.lerp(this.colors.sunsetSky, k < 0.5 ? k*2 : (1-k)*2);
                this.sunLight.color.lerp(this.colors.sunsetSun, k);
                sunInt = 1.2 - k;
            } else if (t >= 0.3 && t < 0.7) { 
                skyColor = this.colors.nightSky;
                sunInt = 0; 
                starOp = 1;
                this.sunLight.color.setHex(0xaaaaaa);
                if(t > 0.35 && t < 0.65) sunInt = 0.2; 
            } else if (t >= 0.7 && t < 0.8) { 
                skyColor.lerp(this.colors.sunsetSky, 0.5); 
                sunInt = (t-0.7)*10;
                starOp = 1 - (t-0.7)*10;
            } else {
                this.sunLight.color.setHex(0xffffee);
            }

            scene.background = skyColor;
            scene.fog = new THREE.Fog(skyColor, 20, 100);
            
            this.sunLight.intensity = sunInt;
            this.starField.material.opacity = starOp;
            this.starField.position.x = carPos.x;

            this.clouds.forEach(c => {
                c.position.x += c.userData.speed * dt;
                if (c.position.x > carPos.x + 100) c.position.x -= 200;
                if (c.position.x < carPos.x - 100) c.position.x += 200;
                const cloudBri = t > 0.3 && t < 0.7 ? 0.2 : 1.0;
                c.material.color.setScalar(cloudBri);
            });
            
            const hours = Math.floor(t * 24);
            const mins = Math.floor((t * 24 * 60) % 60);
            document.getElementById('time-display').innerText = `${hours.toString().padStart(2,'0')}:${mins.toString().padStart(2,'0')}`;
        }
    }

    // --- PHYSICS SETUP ---
    function initPhysics() {
        world = pl.World({ gravity: Vec2(0, PHYS_CONST.GRAVITY) });
        world.on('begin-contact', (c) => handleContact(c, true));
        world.on('end-contact', (c) => handleContact(c, false));
    }

    function handleContact(contact, isBeginning) {
        const getData = (fixture) => fixture.getUserData() || fixture.getBody().getUserData();
        const dA = getData(contact.getFixtureA()), dB = getData(contact.getFixtureB());
        if(!dA || !dB) return;
        
        const checkGround = (w, g) => {
            if (w.type === 'wheel' && g.type === 'ground') w.owner.setGrounded(w.wheelId, isBeginning);
        };
        checkGround(dA, dB); checkGround(dB, dA);

        if (isBeginning) {
            const checkCol = (c, item, fix) => {
                if (c.type === 'chassis') {
                    if (item.type === 'checkpoint') {
                        gameState.lastCheckpoint = { pos: vehicle.chassis.getPosition(), angle: vehicle.chassis.getAngle() };
                        removeBodyAndMesh(fix.getBody());
                    }
                    if (item.type === 'fuel') {
                        gameState.fuel = Math.min(100, gameState.fuel + 50);
                        removeBodyAndMesh(fix.getBody());
                    }
                }
            };
            checkCol(dA, dB, contact.getFixtureB());
            checkCol(dB, dA, contact.getFixtureA());
        }
    }

    function removeBodyAndMesh(body) {
        if (body.getUserData() && body.getUserData().mesh) scene.remove(body.getUserData().mesh);
        world.destroyBody(body);
    }

    // --- INPUT & UI ---
    const input = {
        throttle: 0, brake: 0, pitch: 0, keys: new Set(),
        init() {
            const panels = {
                help: document.getElementById('help-panel'),
                options: document.getElementById('options-panel'),
                gameover: document.getElementById('game-over-panel')
            };
            const toggle = (id) => {
                Object.values(panels).forEach(p => p.classList.add('hidden'));
                if(id) panels[id].classList.remove('hidden');
            };

            document.getElementById('help-toggle-button').onclick = () => toggle('help');
            document.getElementById('close-help-btn').onclick = () => toggle(null);
            document.getElementById('restart-btn').onclick = () => this.handleReset();

            // Options Logic: Open = Pause+Lift, Close = Unpause(Drop)
            const openOptions = () => {
                if(!panels.options.classList.contains('hidden')) return; // Already open
                
                gameState.paused = true;
                if(vehicle) {
                    const pos = vehicle.chassis.getPosition();
                    // Lift 5 meters (approx 4 car heights)
                    vehicle.reset(Vec2(pos.x, pos.y + 5));
                }
                toggle('options');
            };

            const closeOptions = () => {
                toggle(null);
                gameState.paused = false;
            };

            document.getElementById('options-toggle-button').onclick = openOptions;
            document.getElementById('close-options-btn').onclick = closeOptions;

            document.getElementById('graphics-select').addEventListener('change', (e) => {
                SETTINGS.graphics = e.target.value;
                terrainManager.refreshGraphics();
            });

            const zSlider = document.getElementById('zoom-slider');
            zSlider.oninput = (e) => {
                SETTINGS.cameraZoom = parseFloat(e.target.value);
                document.getElementById('zoom-display').innerText = SETTINGS.cameraZoom;
            };

            // Physics Handlers
            const physModeSelect = document.getElementById('physics-mode-select');
            const suspSelect = document.getElementById('suspension-select');
            const widthSlider = document.getElementById('track-width-slider');
            const widthDisp = document.getElementById('track-width-display');
            const hzSlider = document.getElementById('phys-hz-slider');
            const iterSlider = document.getElementById('phys-iter-slider');
            const hzDisp = document.getElementById('phys-hz-display');
            const iterDisp = document.getElementById('phys-iter-display');

            suspSelect.addEventListener('change', (e) => {
                SETTINGS.suspension = e.target.value;
            });

            // Handle Wheelbase Slider
            widthSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                widthDisp.innerText = val.toFixed(1);
                VEHICLE_PARAMS.TRACK_WIDTH = val;

                if (vehicle) {
                    const pos = vehicle.chassis.getPosition().clone();
                    const linVel = vehicle.chassis.getLinearVelocity().clone();
                    const angle = vehicle.chassis.getAngle(); 
                    const angVel = vehicle.chassis.getAngularVelocity();

                    vehicle.destroy();

                    vehicle = createVehicle(pos, angle);
                    
                    vehicle.chassis.setLinearVelocity(linVel);
                    vehicle.chassis.setAngularVelocity(angVel);
                    
                    vehicle.rear.setLinearVelocity(linVel);
                    vehicle.front.setLinearVelocity(linVel);
                }
            });

            const applyPhysPreset = (mode) => {
                if(mode === 'custom') return;
                const p = PHYSICS_PRESETS[mode];
                SETTINGS.physicsHz = p.hz;
                SETTINGS.physicsIter = p.iter;
                
                hzSlider.value = p.hz;
                iterSlider.value = p.iter;
                hzDisp.innerText = p.hz;
                iterDisp.innerText = p.iter;
            };

            physModeSelect.addEventListener('change', (e) => {
                applyPhysPreset(e.target.value);
            });

            const onManualPhysChange = () => {
                physModeSelect.value = 'custom';
                SETTINGS.physicsHz = parseInt(hzSlider.value);
                SETTINGS.physicsIter = parseInt(iterSlider.value);
                hzDisp.innerText = SETTINGS.physicsHz;
                iterDisp.innerText = SETTINGS.physicsIter;
            };

            hzSlider.addEventListener('input', onManualPhysChange);
            iterSlider.addEventListener('input', onManualPhysChange);

            window.addEventListener('keydown', e => this.keys.add(e.code));
            window.addEventListener('keyup', e => {
                this.keys.delete(e.code);
                if (e.code === 'KeyR') this.handleReset();
                if (e.code === 'Space') gameState.paused = !gameState.paused;
                if (e.code === 'KeyD') { gameState.debug = !gameState.debug; }
                if (e.code === 'KeyH') toggle('help');
                if (e.code === 'KeyO') {
                    if(panels.options.classList.contains('hidden')) {
                        openOptions();
                    } else {
                        closeOptions();
                    }
                }
            });

            // Fullscreen trigger setup
            const mobileBtn = document.getElementById('mobile-btn');
            if (mobileBtn) {
                mobileBtn.addEventListener('click', () => {
                    const el = document.documentElement;
                    if (el.requestFullscreen) el.requestFullscreen();
                    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
                });
            }

            // Hardened touch handlers to strictly prevent scrolling/zooming
            const touchBtn = (id, setter) => {
                const el = document.getElementById(id);
                const h = (s) => (e) => { 
                    if(e.cancelable) e.preventDefault(); 
                    setter(s); 
                };
                if(el) { 
                    el.addEventListener('touchstart', h(1), { passive: false });
                    el.addEventListener('touchend', h(0), { passive: false });
                    el.addEventListener('touchcancel', h(0), { passive: false });
                    
                    // Mouse fallbacks
                    el.addEventListener('mousedown', h(1));
                    el.addEventListener('mouseup', h(0));
                    el.addEventListener('mouseleave', (e) => { if (e.buttons === 1) h(0)(e); });
                }
            };
            
            touchBtn('throttle-btn', v => this.throttle = v);
            touchBtn('brake-btn', v => this.brake = v);
            touchBtn('tilt-forward-btn', v => this.pitch = v);
            touchBtn('tilt-backward-btn', v => this.pitch = -v);
        },
        update() {
            this.throttle = this.keys.has('ArrowUp') ? 1 : (document.getElementById('throttle-btn')?.matches(':active')?1:0);
            this.brake = this.keys.has('ArrowDown') ? 1 : (document.getElementById('brake-btn')?.matches(':active')?1:0);
            this.pitch = (this.keys.has('ArrowRight')?1:0) - (this.keys.has('ArrowLeft')?1:0);
        },
        handleReset() {
            if (gameState.lastCheckpoint) {
                vehicle.reset(gameState.lastCheckpoint.pos);
                gameState.fuel = Math.max(50, gameState.fuel);
            } else {
                vehicle.reset(Vec2(0, 5));
                gameState.fuel = 100;
                gameState.distance = 0;
                gameState.timeOfDay = 0;
            }
            gameState.gameOver = false;
            document.getElementById('game-over-panel').classList.add('hidden');
        }
    };

    // --- TERRAIN & VEGETATION ---
    function createTerrainManager() {
        let segments = [], lastGenX = -TERRAIN.SEGMENT_LEN;
        let lastChk = 0, lastFuel = 0;
        
        const seed = Math.random() * 1000;
        const A1 = 0.8, F1 = 0.4, A2 = 0.3, F2 = 1.2;
        const heightFn = x => A1 * Math.sin(F1 * x + seed) + A2 * Math.sin(F2 * x + seed + 100);

        const createGrass = (pathPoints) => {
            const count = 100;
            const geo = new THREE.PlaneGeometry(0.5, 0.8);
            geo.translate(0, 0.4, 0); 
            const mat = new THREE.MeshStandardMaterial({ color: 0x4caf50, side: THREE.DoubleSide, transparent: true });
            const mesh = new THREE.InstancedMesh(geo, mat, count);
            const dummy = new THREE.Object3D();

            for (let i = 0; i < count; i++) {
                const idx = Math.floor(Math.random() * (pathPoints.length - 1));
                const p1 = pathPoints[idx], p2 = pathPoints[idx+1];
                const alpha = Math.random();
                const x = p1.x + (p2.x - p1.x) * alpha;
                const y = p1.y + (p2.y - p1.y) * alpha;
                
                dummy.position.set(x, y, (Math.random()-0.5) * 5); 
                dummy.rotation.y = Math.random() * Math.PI;
                dummy.scale.setScalar(0.8 + Math.random() * 0.5);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
            }
            mesh.receiveShadow = true;
            return mesh;
        };

        const generateSegment = (startX) => {
            const points = [], vPoints = [], topPath = [];
            let lastY = heightFn(startX);
            
            points.push(Vec2(startX, lastY));
            vPoints.push(new THREE.Vector2(startX, lastY));
            topPath.push({x: startX, y: lastY});

            for (let x = startX + TERRAIN.DENSITY; x <= startX + TERRAIN.SEGMENT_LEN; x += TERRAIN.DENSITY) {
                let y = heightFn(x);
                const slope = (y - lastY) / TERRAIN.DENSITY;
                if (Math.abs(slope) > 0.8) y = lastY + Math.sign(slope) * 0.8 * TERRAIN.DENSITY;
                
                points.push(Vec2(x, y));
                vPoints.push(new THREE.Vector2(x, y));
                topPath.push({x: x, y: y});
                lastY = y;
            }
            
            const body = world.createBody(Vec2.zero());
            body.createFixture(pl.Chain(points, false), { friction: 0.9, userData: { type: 'ground' } });
            
            vPoints.push(new THREE.Vector2(vPoints[vPoints.length-1].x, -30));
            vPoints.push(new THREE.Vector2(startX, -30));
            const shape = new THREE.Shape(vPoints);
            const geo = new THREE.ExtrudeGeometry(shape, { depth: 20, bevelEnabled: false });
            geo.translate(0, 0, -10);
            const mat = new THREE.MeshStandardMaterial({ color: 0x3d2e1e, roughness: 0.9 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.receiveShadow = true;
            scene.add(mesh);

            const grass = createGrass(topPath);
            grass.visible = (SETTINGS.graphics === 'modern');
            scene.add(grass);

            body.setUserData({ mesh, grass, type: 'ground' });
            segments.push({ body, endX: startX + TERRAIN.SEGMENT_LEN, grass });
            lastGenX = startX + TERRAIN.SEGMENT_LEN;

            for(let i=1; i<topPath.length-1; i++) {
                if(topPath[i].x > lastChk + 150) { createItem(topPath[i].x, topPath[i].y+1.5, 'checkpoint'); lastChk=topPath[i].x; }
                else if(topPath[i].x > lastFuel + 200) { createItem(topPath[i].x, topPath[i].y+1.5, 'fuel'); lastFuel=topPath[i].x; }
            }
        };

        function createItem(x, y, type) {
            const body = world.createBody({ type: 'static', position: Vec2(x, y) });
            body.createFixture(pl.Box(0.5, 0.5), { isSensor: true, userData: { type } });
            
            const mat = type === 'checkpoint' 
                ? new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 0.5 }) 
                : new THREE.MeshStandardMaterial({ color: 0xff0000 });
            
            const geo = type === 'checkpoint' ? new THREE.CylinderGeometry(0.2, 0.2, 3, 8) : new THREE.BoxGeometry(0.8, 0.8, 0.8);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, y, 0);
            mesh.userData = { originalY: y, floatOffset: Math.random() * 10 };
            
            scene.add(mesh);
            body.setUserData({ mesh, type });
        }

        return {
            init() { generateSegment(-TERRAIN.SEGMENT_LEN); generateSegment(0); },
            update(camX) {
                if (camX > lastGenX - 200) generateSegment(lastGenX);
                if (segments.length > 0 && camX > segments[0].endX + 150) {
                    const s = segments.shift();
                    scene.remove(s.body.getUserData().mesh);
                    if(s.grass) scene.remove(s.grass);
                    world.destroyBody(s.body);
                }
            },
            refreshGraphics() {
                const isModern = SETTINGS.graphics === 'modern';
                segments.forEach(s => { if(s.grass) s.grass.visible = isModern; });
            }
        };
    }

    // --- VEHICLE FACTORY ---
    function createVehicle(pos, angle = 0) {
        const vp = VEHICLE_PARAMS;

        const chassis = world.createDynamicBody({ position: pos, angularDamping: 0.1 });
        const density = vp.CHASSIS_MASS / 3.0; 
        
        // Original Compact Body Dimensions
        const vertices = [
            Vec2(-1.2, -0.3), // Rear Bumper Bottom
            Vec2(1.3, -0.3),  // Front Bumper Bottom
            Vec2(1.3, 0.2),   // Hood Front
            Vec2(0.6, 0.4),   // Hood/Windshield
            Vec2(-0.8, 0.4),  // Roof/Rear Window
            Vec2(-1.2, 0.2)   // Trunk Top
        ];
        
        chassis.createFixture(pl.Polygon(vertices), { density, filterGroupIndex: -1 });
        chassis.setUserData({ type: 'chassis' });

        // IMPORTANT: Set angle immediately before creating wheels so calculating world points works correctly
        chassis.setAngle(angle);

        // --- Visuals (Red Car with Wheel Wells) ---
        const chassisGroup = new THREE.Group();

        const carShape = new THREE.Shape();
        // Visuals always drawn with standard track width to keep body consistent
        const drawRW = -1.7/2; 
        const drawFW = 1.7/2;  
        
        // Start bottom rear bumper
        carShape.moveTo(-1.3, -0.3); 
        
        // Rear Wheel Well
        carShape.lineTo(drawRW - 0.55, -0.3); 
        carShape.lineTo(drawRW - 0.35, -0.05); // Angle Up
        carShape.lineTo(drawRW + 0.35, -0.05); // Flat Top
        carShape.lineTo(drawRW + 0.55, -0.3);  // Angle Down
        
        // Side skirt
        carShape.lineTo(drawFW - 0.55, -0.3);
        
        // Front Wheel Well
        carShape.lineTo(drawFW - 0.55, -0.3);
        carShape.lineTo(drawFW - 0.35, -0.05);
        carShape.lineTo(drawFW + 0.35, -0.05);
        carShape.lineTo(drawFW + 0.55, -0.3);
        
        // Front bumper
        carShape.lineTo(1.4, -0.3);
        carShape.lineTo(1.4, 0.1); 
        
        // Hood
        carShape.lineTo(0.7, 0.25);
        // Windshield
        carShape.lineTo(0.3, 0.6);
        // Roof
        carShape.lineTo(-0.7, 0.6);
        // Rear Window
        carShape.lineTo(-1.1, 0.3);
        // Trunk
        carShape.lineTo(-1.3, 0.3);
        // Back down
        carShape.lineTo(-1.3, -0.3);

        const extrudeSettings = { 
            depth: 1.0, 
            bevelEnabled: true, 
            bevelSegments: 0, 
            steps: 1,         
            bevelSize: 0.05, 
            bevelThickness: 0.05 
        };

        const carGeo = new THREE.ExtrudeGeometry(carShape, extrudeSettings);

        // Center the geometry on the Z axis
        carGeo.translate(0, 0, -0.5);

        const carMat = new THREE.MeshStandardMaterial({ 
            color: 0xcc0000, 
            roughness: 0.3, 
            metalness: 0.5 
        });
        
        const carMesh = new THREE.Mesh(carGeo, carMat);
        carMesh.castShadow = true;

        const windowMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 });
        const cabinGeo = new THREE.BoxGeometry(1.2, 0.35, 0.95);
        const cabin = new THREE.Mesh(cabinGeo, windowMat);
        cabin.position.set(-0.2, 0.4, 0);
        
        // Reverted Light positions
        const lightL = new THREE.PointLight(0xffffaa, 1, 10); lightL.position.set(1.4, 0, 0.3); chassisGroup.add(lightL);
        const lightR = new THREE.PointLight(0xffffaa, 1, 10); lightR.position.set(1.4, 0, -0.3); chassisGroup.add(lightR);
        
        const hlGeo = new THREE.BoxGeometry(0.1, 0.1, 0.2);
        const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
        const hlL = new THREE.Mesh(hlGeo, hlMat); hlL.position.copy(lightL.position);
        const hlR = new THREE.Mesh(hlGeo, hlMat); hlR.position.copy(lightR.position);

        chassisGroup.add(carMesh, cabin, hlL, hlR);
        scene.add(chassisGroup);
        chassis.setUserData({ mesh: chassisGroup, type: 'chassis' });

        const makeWheel = (xOffset, label) => {
            const wheelBody = world.createDynamicBody({ position: chassis.getWorldPoint(Vec2(xOffset, -1)), angularDamping: 0.1 });
            wheelBody.createFixture(pl.Circle(vp.WHEEL_RADIUS), { density: vp.WHEEL_MASS, friction: vp.WHEEL_FRICTION, restitution: 0, filterGroupIndex: -1, userData: { type: 'wheel', wheelId: label, owner: null } });
            
            // Keeps the vertical constraint
            const joint = world.createJoint(pl.WheelJoint({
                motorSpeed: 0, enableMotor: false, maxMotorTorque: 0,
                frequencyHz: vp.SUSPENSION_FREQ_HZ, dampingRatio: vp.SUSPENSION_DAMPING_RATIO,
                collideConnected: false 
            }, chassis, wheelBody, chassis.getWorldPoint(Vec2(xOffset, -1)), chassis.getWorldVector(Vec2(0, 1))));

            const wGeo = new THREE.CylinderGeometry(vp.WHEEL_RADIUS, vp.WHEEL_RADIUS, 0.4, 16);
            wGeo.rotateX(Math.PI / 2);
            const wMesh = new THREE.Mesh(wGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
            
            const rim = new THREE.Mesh(new THREE.BoxGeometry(vp.WHEEL_RADIUS*1.5, 0.1, 0.45), new THREE.MeshStandardMaterial({color: 0x888888}));
            wMesh.add(rim);
            wMesh.castShadow = true;
            scene.add(wMesh);
            wheelBody.setUserData({ mesh: wMesh });

            return { body: wheelBody, joint: joint, mesh: wMesh };
        };

        const rear = makeWheel(-vp.TRACK_WIDTH/2, 'rear');
        const front = makeWheel(vp.TRACK_WIDTH/2, 'front');

        const obj = {
            chassis, rear: rear.body, front: front.body, rJoint: rear.joint, fJoint: front.joint,
            headlights: [lightL, lightR],
            grounded: { rear: 0, front: 0 },
            setGrounded(id, val) { this.grounded[id] += val ? 1 : -1; },
            destroy() {
                // Helper to remove visuals and physics
                scene.remove(this.chassis.getUserData().mesh);
                scene.remove(this.rear.getUserData().mesh);
                scene.remove(this.front.getUserData().mesh);
                world.destroyBody(this.chassis);
                world.destroyBody(this.rear);
                world.destroyBody(this.front);
            },
            reset(pos) {
                this.chassis.setPosition(pos); this.chassis.setAngle(0); this.chassis.setLinearVelocity(Vec2(0,0)); this.chassis.setAngularVelocity(0);
                const rPos = chassis.getWorldPoint(Vec2(-vp.TRACK_WIDTH/2, -1));
                const fPos = chassis.getWorldPoint(Vec2(vp.TRACK_WIDTH/2, -1));
                this.rear.setPosition(rPos); this.rear.setLinearVelocity(Vec2(0,0)); this.rear.setAngularVelocity(0);
                this.front.setPosition(fPos); this.front.setLinearVelocity(Vec2(0,0)); this.front.setAngularVelocity(0);
            },
            update(dt, input) {
                if (input.throttle) {
                    this.rJoint.enableMotor(true);
                    this.rJoint.setMotorSpeed(-input.throttle * vp.MOTOR_MAX_SPEED);
                    this.rJoint.setMaxMotorTorque(vp.MOTOR_TORQUE);
                } else {
                    this.rJoint.enableMotor(false);
                    if (this.grounded.rear > 0) this.rear.applyTorque(-this.rear.getAngularVelocity() * 10, true);
                }
                if (input.brake) {
                    this.rear.applyTorque(clamp(-this.rear.getAngularVelocity()*120, -vp.BRAKE_TORQUE, vp.BRAKE_TORQUE), true);
                    this.front.applyTorque(clamp(-this.front.getAngularVelocity()*120, -vp.BRAKE_TORQUE, vp.BRAKE_TORQUE), true);
                }
                let t = -input.pitch * vp.AIR_CONTROL_TORQUE;
                t -= this.chassis.getAngularVelocity() * vp.AIR_CONTROL_DAMPING;
                this.chassis.applyTorque(t, true);

                // --- PROGRESSIVE SUSPENSION LOGIC ---
                if (SETTINGS.suspension === 'modern') {
                    const joints = [this.rJoint, this.fJoint];
                    for(let i=0; i<joints.length; i++) {
                        const joint = joints[i];
                        const translation = joint.getJointTranslation();
                        
                        if (translation > 0) {
                            const stiffFactor = 6000; 
                            const forceMag = stiffFactor * Math.pow(translation, 3);
                            
                            const anchor = joint.getAnchorA();
                            const force = Vec2(0, forceMag);
                            
                            const angle = this.chassis.getAngle();
                            const rotForce = pl.Rot.mul(pl.Rot(angle), force);

                            this.chassis.applyForce(rotForce, anchor, true);
                        }
                    }
                }
            }
        };
        
        rear.body.getFixtureList().getUserData().owner = obj;
        front.body.getFixtureList().getUserData().owner = obj;
        return obj;
    }

    // --- MAIN LOOP ---
    let lastTime = 0, accumulator = 0;
    let lastUIUpdate = 0;

    function gameLoop(time) {
        requestAnimationFrame(gameLoop);
        
        let dt = (time - lastTime) / 1000;
        lastTime = time;

        if (dt > PHYS_CONST.MAX_FRAME_TIME) dt = PHYS_CONST.MAX_FRAME_TIME;

        if (!gameState.paused) {
            input.update();
            const physicsStepSize = 1 / SETTINGS.physicsHz;
            accumulator += dt;
            const maxSteps = 5; 
            let steps = 0;

            while (accumulator >= physicsStepSize && steps < maxSteps) {
                vehicle.update(physicsStepSize, input);
                world.step(physicsStepSize, SETTINGS.physicsIter, SETTINGS.physicsIter);
                accumulator -= physicsStepSize;
                steps++;
            }
            if(accumulator > physicsStepSize) accumulator = 0;

            if (!gameState.gameOver && !gameState.debug) {
                gameState.fuel -= (0.5 + Math.abs(input.throttle) * 2) * dt; 
                if (gameState.fuel <= 0) { 
                    gameState.fuel = 0; 
                    if(Math.abs(vehicle.chassis.getLinearVelocity().x) < 0.5) gameState.gameOver = true; 
                }
            }

            for (let b = world.getBodyList(); b; b = b.getNext()) {
                const ud = b.getUserData();
                if (ud && ud.mesh) {
                    const p = b.getPosition();
                    const a = b.getAngle();
                    ud.mesh.position.set(p.x, p.y, 0);
                    ud.mesh.rotation.z = a;
                    
                    if(ud.type === 'fuel' || ud.type === 'checkpoint') {
                        ud.mesh.rotation.y += dt;
                        ud.mesh.position.y = ud.originalY + Math.sin(time/500 + ud.mesh.userData.floatOffset) * 0.2;
                    }
                }
            }
            
            const cp = vehicle.chassis.getPosition();
            camera.position.x = cp.x + 8;
            camera.position.y = cp.y + 5;
            camera.position.z = SETTINGS.cameraZoom;
            camera.lookAt(cp.x + 6, cp.y, 0);

            terrainManager.update(cp.x);
            environment.update(dt, cp);

            // Update UI every 100ms
            if(time - lastUIUpdate > 100) {
                lastUIUpdate = time;

                document.getElementById('speed-value').innerText = Math.floor(vehicle.chassis.getLinearVelocity().length() * 3.6);
                
                // RPM: rad/s * 9.55
                document.getElementById('rpm-value').innerText = Math.floor(Math.abs(vehicle.rear.getAngularVelocity()) * 9.55);
                
                // Torque: Input throttle * max
                const torque = input.throttle ? input.throttle * VEHICLE_PARAMS.MOTOR_TORQUE : 0;
                document.getElementById('torque-value').innerText = Math.floor(torque);
                
                // Angle and Slope
                const angleRad = vehicle.chassis.getAngle();
                const angleDeg = (angleRad * 180 / Math.PI) % 360;
                document.getElementById('angle-value').innerText = angleDeg.toFixed(1);
                
                // Slope %, cap at reasonable view for UI (e.g., extreme angles make tan huge)
                let slopeVal = Math.tan(angleRad) * 100;
                if(Math.abs(slopeVal) > 999) slopeVal = 999 * Math.sign(slopeVal); 
                document.getElementById('slope-value').innerText = slopeVal.toFixed(1);

                document.getElementById('fuel-value').innerText = Math.floor(gameState.fuel);
                
                gameState.distance = Math.max(gameState.distance, cp.x);
                document.getElementById('distance-value').innerText = Math.floor(gameState.distance);
                
                document.getElementById('phys-debug').innerText = `${SETTINGS.physicsHz}Hz/${SETTINGS.physicsIter}it`;
                
                if (gameState.gameOver) document.getElementById('game-over-panel').classList.remove('hidden');
            }
        }
        
        renderer.render(scene, camera);
    }

    initGraphics();
    environment = new Environment();
    initPhysics();
    input.init();
    vehicle = createVehicle(Vec2(0, 5));
    terrainManager = createTerrainManager();
    terrainManager.init();
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
});
