let visualizationData;
let scene, camera, renderer, controls;
let globe;
let layers = {
    clouds: new THREE.Group(),
    arrows: new THREE.Group(),
    points: new THREE.Group(),
    sites: new THREE.Group()
};
let currentTimeStep = 0;
let currentFstThreshold = 0.14;
let currentChromosome = 'all';
let colorMode = 'distance';
let arrowColorMode = 'distance';
let pointColorMode = 'fst';

const radius = 5;
const populationColors = d3.scaleOrdinal(d3.schemeCategory10);
const populationGroups = {
    hooded: ['Warsaw, Poland', 'Rimbo, Sweden', 'Uppsala, Sweden'],
    carrion: ['Konstanz, Germany', 'Radolfzell, Germany', 'Sorriba, Spain']
};
const dataUrl = 'https://storage.googleapis.com/crowdat-8zp6gsbxjkr8nnln2dt2/visualization_data.json';

async function loadData() {
    try {
        const loadingDiv = document.createElement('div');
        loadingDiv.style.position = 'absolute';
        loadingDiv.style.top = '50%';
        loadingDiv.style.left = '50%';
        loadingDiv.style.transform = 'translate(-50%, -50%)';
        loadingDiv.style.background = 'rgba(255, 255, 255, 0.9)';
        loadingDiv.style.padding = '20px';
        loadingDiv.style.borderRadius = '5px';
        document.body.appendChild(loadingDiv);

        loadingDiv.textContent = 'Loading data...';
        
        const response = await fetch('https://storage.googleapis.com/crowdat-8zp6gsbxjkr8nnln2dt2/visualization_data.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        let text = await response.text();

        const nanIndex = text.indexOf('NaN');
        if (nanIndex !== -1) {
            console.log("Found NaN at position:", nanIndex);
            console.log("Context:", text.substring(nanIndex - 20, nanIndex + 20));
        }

        text = text.replace(/[^[,\s]NaN[,\s\]]/g, '0');  
        text = text.replace(/\bNaN\b/g, '0');            
        text = text.replace(/\bnan\b/gi, '0');          
        text = text.replace(/\binfinity\b/gi, '"inf"');  
        text = text.replace(/([,$$])(\s*)-?NaN(\s*)(,|$$])/g, '$1$20$3$4'); 

        try {
            visualizationData = JSON.parse(text);
            console.log("Successfully parsed data");
        } catch (parseError) {
            const errorPosition = parseInt(parseError.message.match(/position (\d+)/)?.[1]);
            if (errorPosition) {
                console.error("Error context:", text.substring(errorPosition - 50, errorPosition + 50));
            }
            throw parseError;
        }

        document.body.removeChild(loadingDiv);
        console.log("Data loaded, initializing visualization");
        initVisualization();
        setupEventListeners();
        populateChromosomeSelect();

    } catch (error) {
        console.error('Error loading data:', error);
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.style.position = 'absolute';
        errorMessage.style.top = '50%';
        errorMessage.style.left = '50%';
        errorMessage.style.transform = 'translate(-50%, -50%)';
        errorMessage.style.background = 'rgba(255, 0, 0, 0.1)';
        errorMessage.style.color = 'red';
        errorMessage.style.padding = '20px';
        errorMessage.style.borderRadius = '5px';
        errorMessage.innerHTML = `Error loading visualization data:<br>${error.message}`;
        document.getElementById('container').appendChild(errorMessage);
    }
}

const style = document.createElement('style');
style.textContent = `
    .error-message {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 0, 0, 0.1);
        color: red;
        padding: 20px;
        border-radius: 5px;
        font-family: 'Commissioner', sans-serif;
    }
`;
document.head.appendChild(style);

function initVisualization() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('globe').appendChild(renderer.domElement);

    Object.values(layers).forEach(layer => scene.add(layer));

    createGlobe();
    setupControls();
    setupLighting();
    createLegend();
    updateVisualization();
    
    const resizeEvent = new Event('resize');
    window.dispatchEvent(resizeEvent);
}

function createGlobe() {
    const geometry = new THREE.SphereGeometry(radius, 64, 64);
    const textureLoader = new THREE.TextureLoader();
    
    textureLoader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg', texture => {
        const material = new THREE.MeshPhongMaterial({
            map: texture,
            transparent: true
        });
        globe = new THREE.Mesh(geometry, material);
        scene.add(globe);
    });
}

function setupControls() {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    camera.position.z = 15;
}

function setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 3, 5);
    scene.add(directionalLight);
}

function latLongToVector3(lat, lon, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
    );
}

function updateClouds(timeStep) {
    layers.clouds.clear();
    if (!document.getElementById('showClouds').checked) return;

    const kdeData = visualizationData.kde_data;
    Object.entries(kdeData).forEach(([sample, timeSeries]) => {
        const timeData = timeSeries[timeStep];
        if (!timeData) return;

        const contourGeometry = new THREE.BufferGeometry();
        const contourMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.5
        });

        const thresholds = d3.range(10).map(i => 
            d3.quantile(timeData.z.flat(), i / 9)
        );

        const contours = d3.contours()
            .size([timeData.x.length, timeData.y.length])
            .thresholds(thresholds)
            (timeData.z.flat());

        contours.forEach(contour => {
            contour.coordinates.forEach(polygon => {
                const points = [];
                polygon.forEach(ring => {
                    ring.forEach(point => {
                        const lon = timeData.x[0] + (point[0] / timeData.x.length) * (timeData.x[timeData.x.length - 1] - timeData.x[0]);
                        const lat = timeData.y[0] + (point[1] / timeData.y.length) * (timeData.y[timeData.y.length - 1] - timeData.y[0]);
                        points.push(latLongToVector3(lat, lon, radius + 0.01));
                    });
                });
                const line = new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints(points),
                    contourMaterial
                );
                layers.clouds.add(line);
            });
        });
    });
}

function updateArrows(timeStep) {
    layers.arrows.clear();
    if (!document.getElementById('showArrows').checked) return;

    const locations = visualizationData.locations;
    const disps = calculateDisplacements(timeStep);

    disps.forEach((disp, i) => {
        const start = latLongToVector3(locations[i][1], locations[i][0], radius);
        const end = latLongToVector3(
            locations[i][1] + disp[1],
            locations[i][0] + disp[0],
            radius
        );

        const direction = end.clone().sub(start);
        const length = direction.length();
        direction.normalize();

        const arrowHelper = new THREE.ArrowHelper(
            direction,
            start,
            length,
            colorMode === 'distance' ? getDistanceColor(i) : getPopulationColor(i),
            length * 0.2,
            length * 0.1
        );
        layers.arrows.add(arrowHelper);
    });
}

function updatePoints(timeStep) {
    layers.points.clear();
    if (!document.getElementById('showPoints').checked) return;

    const filteredData = filterDataByChromosome();
    const geometry = new THREE.SphereGeometry(0.02, 8, 8);

    filteredData.forEach((point, i) => {
        if (point.fst < currentFstThreshold) return;

        const material = new THREE.MeshBasicMaterial({
            color: getPointColor(point, i),
            transparent: true,
            opacity: 0.8
        });

        const position = latLongToVector3(point.lat, point.lon, radius + 0.02);
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.copy(position);
        sphere.userData = { type: 'ancestor', data: point };
        layers.points.add(sphere);
    });
}

function updateSites() {
    layers.sites.clear();
    if (!document.getElementById('showSites').checked) return;

    const geometry = new THREE.SphereGeometry(0.05, 16, 16);
    visualizationData.locations.forEach((loc, i) => {
        const material = new THREE.MeshBasicMaterial({
            color: getPopulationColor(i)
        });

        const position = latLongToVector3(loc[1], loc[0], radius + 0.05);
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.copy(position);
        sphere.userData = { type: 'site', name: visualizationData.site_names[i] };
        layers.sites.add(sphere);
    });
}

function haversine(loc1, loc2) {
    function toRadians(deg) {
        return deg * Math.PI / 180;
    }
    
    const lon1 = toRadians(loc1[0]);
    const lat1 = toRadians(loc1[1]);
    const lon2 = toRadians(loc2[0]);
    const lat2 = toRadians(loc2[1]);

    const dlon = lon2 - lon1;
    const dlat = lat2 - lat1;
    const a = Math.sin(dlat/2)**2 + 
              Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon/2)**2;
    const c = 2 * Math.asin(Math.sqrt(a));
    const r = 6371; 
    return c * r;
}

function calculateDisplacements(timeStep) {
    const disps = [];
    const locations = visualizationData.locations;
    const anc_locs = visualizationData.anc_locs;

    for (let sample = 0; sample < locations.length; sample++) {
        const locs = anc_locs.map(arr => arr[sample][timeStep]);
    
        const mean_loc = [
            d3.mean(locs, d => d[2]),
            d3.mean(locs, d => d[3])
        ];
 
        const disp = [
            mean_loc[0] - locations[sample][0],
            mean_loc[1] - locations[sample][1]
        ];
        
        disps.push(disp);
    }

    const dists = disps.map((disp, i) => {
        const loc1 = locations[i];
        const loc2 = [loc1[0] + disp[0], loc1[1] + disp[1]];
        return haversine(loc1, loc2);
    });

    const maxDist = Math.max(...dists);
    const relative_dists = dists.map(d => d / maxDist);

    visualizationData.distances = dists;
    visualizationData.relative_distances = relative_dists;

    return disps;
}

function getDistanceColor(index) {
    return d3.interpolateViridis(visualizationData.relative_distances[index]);
}

function getPopulationColor(index) {
    return populationColors(visualizationData.population_ixs[index]);
}

function getPointColor(point, index) {
    if (pointColorMode === 'fst') {
        return d3.interpolateViridis(point.fst);
    }
    return getPopulationColor(index);
}

function filterDataByChromosome() {
    const data = [];
    const anc_locs = visualizationData.anc_locs;
    const chr_labels = visualizationData.chr_labels;
    
    for (let i = 0; i < anc_locs.length; i++) {
        if (currentChromosome !== 'all' && chr_labels[i] !== currentChromosome) continue;
        
        const locs = anc_locs[i];
        data.push({
            lon: locs[2],
            lat: locs[3],
            fst: visualizationData.fst_values[i],
            chr: chr_labels[i]
        });
    }
    return data;
}

function setupEventListeners() {
    const timeSlider = document.getElementById('timeSlider');
    timeSlider.addEventListener('input', (e) => {
        currentTimeStep = parseInt(e.target.value);
        document.getElementById('timeValue').textContent = 
            Math.round(visualizationData.ancestor_times[currentTimeStep]);
        updateVisualization();
    });

    const showArrows = document.getElementById('showArrows');
    const arrowControls = document.getElementById('arrowControls');
    showArrows.addEventListener('change', (e) => {
        arrowControls.classList.toggle('active', e.target.checked);
        updateVisualization();
    });

    const arrowColorSelect = document.getElementById('arrowColorMode');
    arrowColorSelect.addEventListener('change', (e) => {
        arrowColorMode = e.target.value;
        updateVisualization();
    });

    const showPoints = document.getElementById('showPoints');
    const pointControls = document.getElementById('pointControls');
    showPoints.addEventListener('change', (e) => {
        pointControls.classList.toggle('active', e.target.checked);
        updateVisualization();
    });

    const pointColorSelect = document.getElementById('pointColorMode');
    const fstControls = document.getElementById('fstControls');
    pointColorSelect.addEventListener('change', (e) => {
        pointColorMode = e.target.value;
        fstControls.classList.toggle('active', e.target.value === 'fst');
        updateVisualization();
    });

    const fstSlider = document.getElementById('fstSlider');
    fstSlider.addEventListener('input', (e) => {
        currentFstThreshold = parseFloat(e.target.value);
        document.getElementById('fstValue').textContent = 
            currentFstThreshold.toFixed(2);
        updateVisualization();
    });

    document.getElementById('chromosomeSelect').addEventListener('change', (e) => {
        currentChromosome = e.target.value;
        updateVisualization();
    });

    ['Clouds', 'Sites'].forEach(layer => {
        document.getElementById(`show${layer}`).addEventListener('change', updateVisualization);
    });

    renderer.domElement.addEventListener('mousemove', handleMouseMove);
}

function handleMouseMove(event) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(scene.children, true);
    const tooltip = document.getElementById('tooltip');

    if (intersects.length > 0) {
        const object = intersects[0].object;
        if (object.userData.type) {
            tooltip.style.display = 'block';
            tooltip.style.left = event.clientX + 10 + 'px';
            tooltip.style.top = event.clientY + 10 + 'px';

            if (object.userData.type === 'site') {
                tooltip.textContent = object.userData.name;
            } else if (object.userData.type === 'ancestor') {
                tooltip.textContent = `FST: ${object.userData.data.fst.toFixed(3)}
                    Chr: ${object.userData.data.chr}`;
            }
        } else {
            tooltip.style.display = 'none';
        }
    } else {
        tooltip.style.display = 'none';
    }
}

function populateChromosomeSelect() {
    const select = document.getElementById('chromosomeSelect');
    const uniqueChrs = [...new Set(visualizationData.chr_labels)];
    
    uniqueChrs.forEach(chr => {
        const option = document.createElement('option');
        option.value = chr;
        option.textContent = chr;
        select.appendChild(option);
    });
}

function createLegend() {
    const hoodedContainer = document.getElementById('hooded-populations');
    const carrionContainer = document.getElementById('carrion-populations');
    
    hoodedContainer.innerHTML = '';
    carrionContainer.innerHTML = '';

    if (colorMode === 'distance') {
        const gradientContainer = document.createElement('div');
        gradientContainer.style.width = '100%';
        
        const gradient = document.createElement('div');
        gradient.style.background = 'linear-gradient(to right, ' + 
            d3.range(0, 1, 0.1).map(v => d3.interpolateViridis(v)).join(',') + ')';
        gradient.style.height = '20px';
        gradient.style.marginTop = '5px';
        
        const labels = document.createElement('div');
        labels.style.display = 'flex';
        labels.style.justifyContent = 'space-between';
        labels.innerHTML = '<span>0</span><span>Max Distance</span>';
        
        gradientContainer.appendChild(gradient);
        gradientContainer.appendChild(labels);
        hoodedContainer.appendChild(gradientContainer);
    } else {
        visualizationData.site_names.forEach((site, i) => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.marginTop = '5px';

            const color = document.createElement('div');
            color.style.width = '20px';
            color.style.height = '20px';
            color.style.backgroundColor = getPopulationColor(i);
            color.style.marginRight = '10px';

            const label = document.createElement('span');
            label.textContent = site;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.style.marginLeft = '10px';
            checkbox.addEventListener('change', (e) => {
                updatePopulationVisibility(site, e.target.checked);
                updateCrowIcons();
            });

            item.appendChild(color);
            item.appendChild(label);
            item.appendChild(checkbox);

            if (populationGroups.hooded.includes(site)) {
                hoodedContainer.appendChild(item);
            } else {
                carrionContainer.appendChild(item);
            }
        });
    }
    updateCrowIcons();
}

function updateCrowIcons() {
    const hoodedCrow = document.getElementById('hooded-crow');
    const carrionCrow = document.getElementById('carrion-crow');
    
    const anyHoodedVisible = populationGroups.hooded.some(site => 
        isPopulationVisible(site));
    const anyCarrionVisible = populationGroups.carrion.some(site => 
        isPopulationVisible(site));

    hoodedCrow.classList.toggle('active', anyHoodedVisible);
    carrionCrow.classList.toggle('active', anyCarrionVisible);
}

function isPopulationVisible(site) {
    const index = visualizationData.site_names.indexOf(site);
    return layers.sites.children[index]?.visible ?? false;
}

function updatePopulationVisibility(site, visible) {
    const index = visualizationData.site_names.indexOf(site);
    if (index !== -1) {
        if (layers.sites.children[index]) {
            layers.sites.children[index].visible = visible;
        }
        
        if (layers.arrows.children[index]) {
            layers.arrows.children[index].visible = visible;
        }
        
        updateVisualization();
    }
}

function updateVisualization() {
    updateClouds(currentTimeStep);
    updateArrows(currentTimeStep);
    updatePoints(currentTimeStep);
    updateSites();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    const legendContainer = document.getElementById('legend-container');
    if (legendContainer) {
        const containerWidth = legendContainer.offsetWidth;
        const crowIcons = document.getElementsByClassName('crow-icon');
        Array.from(crowIcons).forEach(icon => {
            const maxHeight = Math.min(50, containerWidth * 0.1); 
            icon.style.maxHeight = `${maxHeight}px`;
        });
    }
});

loadData();
